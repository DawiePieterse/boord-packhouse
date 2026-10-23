"""Sulfur tent runs.

The tablet is the write-ahead log: a run is made on the tablet with its own
uuid and start time, queued in IndexedDB, and sent here until it lands, so a
Wi-Fi dropout never loses or delays one. Sync is therefore an idempotent
upsert by uuid, and ending a run is one-way: the first ended_at the server
sees stands, and a tablet re-sending an older copy cannot reopen it.

Every response carries server_now, so each tablet can correct its own clock
(frontend/sync.js) - start times are tablet times, and a tablet that is five
minutes out would otherwise skew every timer on every other tablet.
"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, SQLModel, or_, select

from db import get_packhouse_session
from models import SulfurRun, SulfurSettings, Tent
from routers.weather import farm_weather

router = APIRouter(prefix="/api/sulfur", tags=["sulfur"])

# Weather is only stamped onto a run that arrives this soon after its start;
# a run that sat on an offline tablet gets none rather than the wrong reading.
WEATHER_FRESH = timedelta(minutes=10)
# Finished runs stay in GET /runs this long, for the screen's recent list.
RECENT = timedelta(hours=24)


def _utc_naive(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def advance(row, rec, stages) -> None:
    """Move a synced record's stages forward, one way, for both modules: each
    stage the row has not ended yet takes the tablet's time and its
    `<stage>_by` names; one already ended stays as first sent. `stages` are
    the time fields in order (a run's ended_at; a batch's dip_ended_at then
    ended_at), each after `started_at`.

    No stage ends before the one before it. Two tablets' clocks are only
    corrected to the server's to within a request, and an offline one not at
    all, so a run ended on another tablet can arrive a little "before" it
    started. Refusing it would leave it going on the server for ever;
    clamping keeps the record and loses only the skew."""
    if not stages:
        return
    floor = row.started_at
    for key in stages:
        when = _utc_naive(getattr(rec, key))
        if getattr(row, key) is None and when is not None:
            by = key.replace("_at", "_by")
            setattr(row, key, max(when, floor))
            setattr(row, by, getattr(rec, by))
            setattr(row, by + "_name", getattr(rec, by + "_name"))
        floor = getattr(row, key) or floor


class RunIn(SQLModel):
    uuid: str
    tent_id: int
    tent_name: str = ""
    grams: float
    minutes: int
    crates: int
    block_id: Optional[str] = None
    block_name: str = ""
    variety: str = ""
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    started_at: datetime
    started_by: str = ""
    started_by_name: str = ""
    ended_at: Optional[datetime] = None
    ended_by: str = ""
    ended_by_name: str = ""
    suggested_minutes: Optional[int] = None
    fruit_kg: Optional[float] = None
    suggestion_temp: Optional[float] = None
    suggestion_humidity: Optional[float] = None
    estimated_ppm: Optional[float] = None


class SyncIn(SQLModel):
    device: str = ""
    runs: List[RunIn] = []


def _problem(run: RunIn, session: Session) -> Optional[str]:
    if not run.uuid or len(run.uuid) > 64:
        return "bad uuid"
    if session.get(Tent, run.tent_id) is None:
        return "unknown tent"
    if not (run.grams > 0 and 1 <= run.minutes <= 600 and run.crates >= 1):
        return "grams, minutes and crates must be positive"
    if (run.block_id is None) == (run.supplier_id is None):
        return "a run needs exactly one of a block or a supplier"
    return None


def run_out(r: SulfurRun) -> dict:
    out = r.model_dump()
    for key in ("started_at", "ended_at", "synced_at"):
        out[key] = _iso(out[key])
    return out


@router.post("/sync")
def sync(body: SyncIn, session: Session = Depends(get_packhouse_session)):
    now = _now()
    synced, rejected = [], []
    weather = None  # fetched at most once per batch, and only if needed
    for run in body.runs:
        problem = _problem(run, session)
        if problem:
            rejected.append({"uuid": run.uuid, "error": problem})
            continue
        row = session.get(SulfurRun, run.uuid)
        if row is None:
            row = SulfurRun(**run.model_dump(exclude={"started_at", "ended_at"}),
                            started_at=_utc_naive(run.started_at),
                            device=body.device, synced_at=now)
            if abs(now - row.started_at) <= WEATHER_FRESH:
                if weather is None:
                    weather = farm_weather(timeout=3)
                row.weather_temp = weather.get("temp")
                row.weather_humidity = weather.get("humidity")
        advance(row, run, ("ended_at",))
        session.add(row)
        synced.append(run.uuid)
    session.commit()
    return {"server_now": _iso(now), "synced": synced, "rejected": rejected}


@router.get("/settings")
def get_settings(session: Session = Depends(get_packhouse_session)):
    """The suggested-time numbers. Open: every tablet caches them, so the
    suggestion still works with no Wi-Fi. Changed in Settings (tents.py)."""
    return session.get(SulfurSettings, 1)


@router.get("/runs")
def list_runs(session: Session = Depends(get_packhouse_session)):
    """Every run still going, plus those finished in the last RECENT."""
    now = _now()
    rows = session.exec(select(SulfurRun).where(or_(
        SulfurRun.ended_at == None, SulfurRun.started_at >= now - RECENT))  # noqa: E711
        .order_by(SulfurRun.started_at)).all()
    return {"server_now": _iso(now), "runs": [run_out(r) for r in rows]}
