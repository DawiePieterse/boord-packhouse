"""Juice bins, weighed on a phone.

The pallets' technique (routers/consignment.py): each bin is made on the phone
with its own uuid, queued in IndexedDB and sent here until it lands, an
idempotent upsert where the latest copy replaces the fields the phone owns. A
bin (or a crate, numbered on its own) is weighed empty in the morning and full later in the day, so it is saved
twice; who first saved it and the season are set once, on first arrival. A
full bin goes on a delivery note (routers/delivery_note.py) to the juice buyer.
"""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, SQLModel, select

from db import get_packhouse_session
from models import JuiceBin
from routers.sulfur import _iso, _now, _utc_naive
from timeutil import to_local

router = APIRouter(prefix="/api/juice", tags=["juice"])

# Bins newer than this are sent to the phones; older ones are history.
LISTED = timedelta(days=90)


# What a juice container is, and its name on the screens and the note.
CONTAINERS = {"bin": "bin", "crate": "crate"}


class BinIn(SQLModel):
    uuid: str
    container: str = "bin"
    bin_no: int
    weighed_at: datetime
    empty_kg: Optional[float] = None
    full_kg: Optional[float] = None
    made_by: str = ""
    made_by_name: str = ""
    changed_by: str = ""
    changed_by_name: str = ""
    removed: bool = False


class SyncIn(SQLModel):
    device: str = ""
    bins: List[BinIn] = []


def _bin_problem(rec: BinIn, session: Session) -> Optional[str]:
    if not rec.uuid or len(rec.uuid) > 64:
        return "bad uuid"
    if rec.removed:
        return None
    if rec.container not in CONTAINERS:
        return "a juice container is a bin or a crate"
    if rec.bin_no < 1:
        return f"the {rec.container} number is a whole number from 1"
    if rec.empty_kg is None and rec.full_kg is None:
        return f"a {rec.container} needs its empty or full weight"
    if any(kg is not None and not 0 < kg < 5000 for kg in (rec.empty_kg, rec.full_kg)):
        return "a weight is more than 0 kg"
    if rec.empty_kg is not None and rec.full_kg is not None and rec.full_kg <= rec.empty_kg:
        return "the full weight is more than the empty weight"
    # Unique in the season (the farm-local year it was weighed) among the bins,
    # or the crates; one taken off frees its number.
    season = to_local(_utc_naive(rec.weighed_at)).year
    twin = session.exec(select(JuiceBin).where(JuiceBin.bin_year == season, JuiceBin.bin_no == rec.bin_no,
                                               JuiceBin.container == rec.container,
                                               JuiceBin.uuid != rec.uuid, JuiceBin.removed == False)).first()  # noqa: E712
    if twin is not None:
        return f"{rec.container} {rec.bin_no} is already used this season"
    return None


def bin_out(b: JuiceBin) -> dict:
    o = b.model_dump()
    for key in ("weighed_at", "synced_at"):
        o[key] = _iso(o[key])
    return o


@router.post("/sync")
def sync(body: SyncIn, session: Session = Depends(get_packhouse_session)):
    now = _now()
    synced, rejected = [], []
    for rec in body.bins:
        problem = _bin_problem(rec, session)
        if problem:
            rejected.append({"uuid": rec.uuid, "error": problem})
            continue
        row = session.get(JuiceBin, rec.uuid)
        if row is None:
            weighed = _utc_naive(rec.weighed_at)
            row = JuiceBin(uuid=rec.uuid, container=rec.container, bin_no=rec.bin_no, weighed_at=weighed, bin_year=to_local(weighed).year,
                           device=body.device, synced_at=now, made_by=rec.made_by, made_by_name=rec.made_by_name)
        row.removed, row.changed_by, row.changed_by_name = rec.removed, rec.changed_by, rec.changed_by_name
        if not rec.removed:
            row.bin_no, row.empty_kg, row.full_kg = rec.bin_no, rec.empty_kg, rec.full_kg
        session.add(row)
        session.flush()  # the next bin in this pass sees this one's number
        synced.append(rec.uuid)
    session.commit()
    return {"server_now": _iso(now), "synced": synced, "rejected": rejected}


@router.get("/state")
def state(session: Session = Depends(get_packhouse_session)):
    """The recent bins, newest first. Removed ones are sent too, so a phone
    holding its own copy of one learns it went."""
    now = _now()
    bins = session.exec(select(JuiceBin).where(JuiceBin.weighed_at >= now - LISTED)
                        .order_by(JuiceBin.weighed_at.desc())).all()
    return {"server_now": _iso(now), "bins": [bin_out(b) for b in bins]}
