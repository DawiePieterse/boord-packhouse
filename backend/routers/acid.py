"""Acid bath batches, chemical changes and concentration checks.

The same technique as the sulfur runs (routers/sulfur.py): every record is
made on a tablet with its own uuid, queued in IndexedDB and sent here until
it lands. Sync is an idempotent upsert by uuid. A batch moves one way only,
dipping -> drying -> done: the first dip_ended_at and ended_at the server
sees stand. Changes and checks are never edited once in.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, SQLModel, or_, select

from db import get_packhouse_session
from models import AcidBatch, Bath, BathCheck, ChemicalChange
from routers.sulfur import RECENT, _iso, _now, _utc_naive

router = APIRouter(prefix="/api/acid", tags=["acid"])

ROUTES = ("export", "local")


class BatchIn(SQLModel):
    uuid: str
    bath_id: int
    bath_name: str = ""
    route: str = "export"
    sulfur_run_uuid: Optional[str] = None
    crates: int
    dip_minutes: int
    dry_minutes: int
    block_id: Optional[str] = None
    block_name: str = ""
    variety: str = ""
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    started_at: datetime
    started_by: str = ""
    started_by_name: str = ""
    dip_ended_at: Optional[datetime] = None
    dip_ended_by: str = ""
    dip_ended_by_name: str = ""
    ended_at: Optional[datetime] = None
    ended_by: str = ""
    ended_by_name: str = ""


class ChangeIn(SQLModel):
    uuid: str
    bath_id: int
    bath_name: str = ""
    changed_at: datetime
    crates_since: int = 0
    by: str = ""
    by_name: str = ""


class CheckIn(SQLModel):
    uuid: str
    bath_id: int
    bath_name: str = ""
    checked_at: datetime
    value: float
    note: str = ""
    by: str = ""
    by_name: str = ""


class SyncIn(SQLModel):
    device: str = ""
    batches: List[BatchIn] = []
    changes: List[ChangeIn] = []
    checks: List[CheckIn] = []


def _problem(rec, session: Session) -> Optional[str]:
    if not rec.uuid or len(rec.uuid) > 64:
        return "bad uuid"
    if session.get(Bath, rec.bath_id) is None:
        return "unknown bath"
    if isinstance(rec, BatchIn):
        if rec.route not in ROUTES:
            return "route must be export or local"
        if not (rec.crates >= 1 and 1 <= rec.dip_minutes <= 600 and 1 <= rec.dry_minutes <= 600):
            return "crates and minutes must be positive"
        if (rec.block_id is None) == (rec.supplier_id is None):
            return "a batch needs exactly one of a block or a supplier"
        if rec.ended_at is not None and rec.dip_ended_at is None:
            return "a batch is taken out of the bath before it is done"
    return None


def out(row) -> dict:
    o = row.model_dump()
    for key, value in o.items():
        if isinstance(value, datetime):
            o[key] = _iso(value)
    return o


def _times(rec, *keys) -> dict:
    return {k: _utc_naive(getattr(rec, k)) for k in keys}


@router.post("/sync")
def sync(body: SyncIn, session: Session = Depends(get_packhouse_session)):
    now = _now()
    synced, rejected = [], []
    kinds = ((AcidBatch, body.batches, ("started_at", "dip_ended_at", "ended_at")),
             (ChemicalChange, body.changes, ("changed_at",)),
             (BathCheck, body.checks, ("checked_at",)))
    for model, records, time_keys in kinds:
        for rec in records:
            problem = _problem(rec, session)
            if problem:
                rejected.append({"uuid": rec.uuid, "error": problem})
                continue
            times = _times(rec, *time_keys)
            existing = session.get(model, rec.uuid)
            if existing is None:
                session.add(model(**rec.model_dump(exclude=set(time_keys)), **times,
                                  device=body.device, synced_at=now))
            elif model is AcidBatch:
                # One way: a stage, once ended, stays ended as first sent.
                if existing.dip_ended_at is None and times["dip_ended_at"] is not None:
                    existing.dip_ended_at = times["dip_ended_at"]
                    existing.dip_ended_by, existing.dip_ended_by_name = rec.dip_ended_by, rec.dip_ended_by_name
                if existing.ended_at is None and times["ended_at"] is not None:
                    existing.ended_at = times["ended_at"]
                    existing.ended_by, existing.ended_by_name = rec.ended_by, rec.ended_by_name
                session.add(existing)
            synced.append(rec.uuid)
    session.commit()
    return {"server_now": _iso(now), "synced": synced, "rejected": rejected}


@router.get("/state")
def state(session: Session = Depends(get_packhouse_session)):
    """What the acid screen needs per active bath: its latest chemical change
    and concentration check, and every batch since that change (or still
    going, or from the last RECENT) - the tablet adds up bath health from
    these and its own unsent records."""
    now = _now()
    batches, changes, checks = [], [], []
    for bath in session.exec(select(Bath).where(Bath.active == True)).all():  # noqa: E712
        change = session.exec(select(ChemicalChange).where(ChemicalChange.bath_id == bath.id)
                              .order_by(ChemicalChange.changed_at.desc())).first()
        check = session.exec(select(BathCheck).where(BathCheck.bath_id == bath.id)
                             .order_by(BathCheck.checked_at.desc())).first()
        q = select(AcidBatch).where(AcidBatch.bath_id == bath.id)
        # ponytail: a bath with no change ever logged sends its whole history;
        # bounded from the first Chemicals changed on.
        if change is not None:
            since = min(now - RECENT, change.changed_at)
            q = q.where(or_(AcidBatch.ended_at == None, AcidBatch.started_at >= since))  # noqa: E711
        batches += session.exec(q.order_by(AcidBatch.started_at)).all()
        changes += [change] if change else []
        checks += [check] if check else []
    return {"server_now": _iso(now), "batches": [out(b) for b in batches],
            "changes": [out(c) for c in changes], "checks": [out(c) for c in checks]}
