"""What the floor tablets cache so they keep working with no Wi-Fi: Boord's
workers (for the badge scan), the fruit sources received lately, and the
active tents and acid baths. Open endpoints - the floor screens have no login."""
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

import boord
from db import get_packhouse_session
from models import Bath, SulfurRun, Tent

router = APIRouter(prefix="/api", tags=["floor"])


@router.get("/workers")
def list_workers():
    return boord.workers()


@router.get("/fruit-sources")
def list_fruit_sources():
    return boord.fruit_sources()


@router.get("/tents")
def list_tents(session: Session = Depends(get_packhouse_session)):
    """The active tents. last_grams is what the tent's latest run used: the
    operator's own change to the dose is the next batch's starting number."""
    out = []
    for t in session.exec(select(Tent).where(Tent.active == True).order_by(Tent.sort, Tent.id)).all():  # noqa: E712
        last = session.exec(select(SulfurRun.grams).where(SulfurRun.tent_id == t.id)
                            .order_by(SulfurRun.started_at.desc())).first()
        out.append({**t.model_dump(), "last_grams": last})
    return out


@router.get("/baths")
def list_baths(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Bath).where(Bath.active == True).order_by(Bath.sort, Bath.id)).all()  # noqa: E712
