"""Settings -> Tents: add, rename, change defaults, retire. Behind the PIN.

No delete: a retired tent (active = false) leaves the sulfur screen but past
runs keep pointing at it.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from admin_auth import require_admin
from db import get_packhouse_session
from models import Tent

router = APIRouter(prefix="/api/settings/tents", tags=["settings"], dependencies=[Depends(require_admin)])


class TentIn(SQLModel):
    name: str
    default_grams: float = 425.0
    default_minutes: int = 60
    default_crates: int = 24
    active: bool = True
    sort: Optional[int] = None


def _check(body: TentIn) -> None:
    if not body.name.strip():
        raise HTTPException(422, "A tent needs a name")
    if not (body.default_grams > 0 and 1 <= body.default_minutes <= 600 and body.default_crates >= 1):
        raise HTTPException(422, "Grams, minutes and crates must be positive")


@router.get("")
def all_tents(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Tent).order_by(Tent.sort, Tent.id)).all()


@router.post("")
def add_tent(body: TentIn, session: Session = Depends(get_packhouse_session)):
    _check(body)
    last = session.exec(select(Tent).order_by(Tent.sort.desc())).first()
    tent = Tent(**body.model_dump(exclude={"sort"}), sort=(last.sort + 1) if last else 0)
    tent.name = tent.name.strip()
    session.add(tent)
    session.commit()
    session.refresh(tent)
    return tent


@router.put("/{tent_id}")
def update_tent(tent_id: int, body: TentIn, session: Session = Depends(get_packhouse_session)):
    _check(body)
    tent = session.get(Tent, tent_id)
    if tent is None:
        raise HTTPException(404, "No such tent")
    for key, value in body.model_dump(exclude={"sort"}).items():
        setattr(tent, key, value)
    tent.name = tent.name.strip()
    if body.sort is not None:
        tent.sort = body.sort
    session.add(tent)
    session.commit()
    session.refresh(tent)
    return tent
