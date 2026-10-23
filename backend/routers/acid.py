"""Acid bath batches, chemical changes and concentration checks.

The same technique as the sulfur runs (routers/sulfur.py): every record is
made on a tablet with its own uuid, queued in IndexedDB and sent here until
it lands. Sync is an idempotent upsert by uuid. A batch moves one way only,
dipping -> drying -> done: the first dip_ended_at and ended_at the server
sees stand. Changes and checks are never edited once in.
"""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, SQLModel, func, or_, select

from db import get_packhouse_session
from models import AcidBatch, Bath, BathCheck, ChemicalChange
from routers.sulfur import RECENT, _iso, _now, _utc_naive, advance

router = APIRouter(prefix="/api/acid", tags=["acid"])

ROUTES = ("export", "local")
# A tablet keeps its own sulfur runs for 3 days (idb.js PRUNE_AFTER_DAYS) and
# offers any finished one not yet dipped. /state names every run dipped in
# this window - a day more than the tablets keep - so a run dipped on another
# tablet, or in a bath since retired, is never offered twice.
USED_RUNS_WINDOW = timedelta(days=4)


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


@router.post("/sync")
def sync(body: SyncIn, session: Session = Depends(get_packhouse_session)):
    now = _now()
    synced, rejected = [], []
    # Each kind: its model, its records, and the time fields a batch moves
    # through after it starts (changes and checks are never edited once in).
    kinds = ((AcidBatch, body.batches, ("dip_ended_at", "ended_at")),
             (ChemicalChange, body.changes, ()),
             (BathCheck, body.checks, ()))
    for model, records, stages in kinds:
        for rec in records:
            problem = _problem(rec, session)
            if problem:
                rejected.append({"uuid": rec.uuid, "error": problem})
                continue
            row = session.get(model, rec.uuid)
            if row is None:
                fields = rec.model_dump(exclude=set(stages))
                for key, value in fields.items():
                    if isinstance(value, datetime):
                        fields[key] = _utc_naive(value)
                row = model(**fields, device=body.device, synced_at=now)
            advance(row, rec, stages)
            session.add(row)
            synced.append(rec.uuid)
    session.commit()
    return {"server_now": _iso(now), "synced": synced, "rejected": rejected}


@router.get("/state")
def state(session: Session = Depends(get_packhouse_session)):
    """What the acid screen needs: per active bath, its latest chemical change
    and concentration check and the crates through it since that change
    (`health`, added up here so no tablet needs the bath's history); the
    batches still going or from the last RECENT; and every sulfur run dipped
    lately (`used_runs`). The tablet adds its own unsent records on top.

    Bounded on purpose: a bath with no change ever logged once sent every
    batch it had had, and the tablets re-read that list every second."""
    now = _now()
    changes, checks, health = [], [], []
    active = select(Bath.id).where(Bath.active == True)  # noqa: E712
    for bath in session.exec(select(Bath).where(Bath.active == True)).all():  # noqa: E712
        change = session.exec(select(ChemicalChange).where(ChemicalChange.bath_id == bath.id)
                              .order_by(ChemicalChange.changed_at.desc())).first()
        check = session.exec(select(BathCheck).where(BathCheck.bath_id == bath.id)
                             .order_by(BathCheck.checked_at.desc())).first()
        q = select(func.coalesce(func.sum(AcidBatch.crates), 0)).where(AcidBatch.bath_id == bath.id)
        if change is not None:
            q = q.where(AcidBatch.started_at >= change.changed_at)
        health.append({"bath_id": bath.id, "crates": session.exec(q).one(),
                       "change_uuid": change.uuid if change else None})
        changes += [change] if change else []
        checks += [check] if check else []
    batches = session.exec(select(AcidBatch).where(
        AcidBatch.bath_id.in_(active),
        or_(AcidBatch.ended_at == None, AcidBatch.started_at >= now - RECENT))  # noqa: E711
        .order_by(AcidBatch.started_at)).all()
    used = session.exec(select(AcidBatch.sulfur_run_uuid).distinct().where(
        AcidBatch.sulfur_run_uuid != None, AcidBatch.started_at >= now - USED_RUNS_WINDOW)).all()  # noqa: E711
    return {"server_now": _iso(now), "batches": [out(b) for b in batches],
            "changes": [out(c) for c in changes], "checks": [out(c) for c in checks],
            "health": health, "used_runs": sorted(used)}
