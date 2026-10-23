"""Settings -> Acid: the acid baths (add, rename, change defaults and
chemical-change limits, retire). Behind the PIN.

No bath delete: a retired bath (active = false) leaves the acid screen but
past batches keep pointing at it.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from admin_auth import require_admin
from db import get_packhouse_session
from models import Bath

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_admin)])


class BathIn(SQLModel):
    name: str
    default_dip_minutes: int = 5
    default_dry_minutes: int = 30
    default_crates: int = 24
    change_days: float = 3.5
    change_crates: int = 500
    active: bool = True
    sort: Optional[int] = None


def _check(body: BathIn) -> None:
    if not body.name.strip():
        raise HTTPException(422, "A bath needs a name")
    if not (1 <= body.default_dip_minutes <= 600 and 1 <= body.default_dry_minutes <= 600 and body.default_crates >= 1):
        raise HTTPException(422, "Minutes and crates must be positive")
    if not (body.change_days > 0 and body.change_crates >= 1):
        raise HTTPException(422, "The chemical-change days and crates must be positive")


@router.get("/baths")
def all_baths(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Bath).order_by(Bath.sort, Bath.id)).all()


@router.post("/baths")
def add_bath(body: BathIn, session: Session = Depends(get_packhouse_session)):
    _check(body)
    last = session.exec(select(Bath).order_by(Bath.sort.desc())).first()
    bath = Bath(**body.model_dump(exclude={"sort"}), sort=(last.sort + 1) if last else 0)
    bath.name = bath.name.strip()
    session.add(bath)
    session.commit()
    session.refresh(bath)
    return bath


@router.put("/baths/{bath_id}")
def update_bath(bath_id: int, body: BathIn, session: Session = Depends(get_packhouse_session)):
    _check(body)
    bath = session.get(Bath, bath_id)
    if bath is None:
        raise HTTPException(404, "No such bath")
    for key, value in body.model_dump(exclude={"sort"}).items():
        setattr(bath, key, value)
    bath.name = bath.name.strip()
    if body.sort is not None:
        bath.sort = body.sort
    session.add(bath)
    session.commit()
    session.refresh(bath)
    return bath
