"""Settings -> Consignment: the packs (name and real carton weight) and the
markets the consignment screen offers. Behind the PIN.

No delete: a retired pack or market (active = false) leaves the screen, but
pallets and consignments keep the name and weight they copied.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from admin_auth import require_admin
from db import get_packhouse_session
from models import Market, Packaging

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_admin)])


class PackagingIn(SQLModel):
    name: str
    carton_kg: float
    active: bool = True


class MarketIn(SQLModel):
    name: str
    active: bool = True


def _save(session: Session, model, row_id: Optional[int], body: SQLModel):
    if not body.name.strip():
        raise HTTPException(422, "A name is needed")
    if isinstance(body, PackagingIn) and not 0 < body.carton_kg <= 100:
        raise HTTPException(422, "The carton weight must be a positive number of kg")
    if row_id is None:
        last = session.exec(select(model).order_by(model.sort.desc())).first()
        row = model(**body.model_dump(), sort=(last.sort + 1) if last else 0)
    else:
        row = session.get(model, row_id)
        if row is None:
            raise HTTPException(404, "Not found")
        for key, value in body.model_dump().items():
            setattr(row, key, value)
    row.name = row.name.strip()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/packaging")
def all_packaging(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Packaging).order_by(Packaging.sort, Packaging.id)).all()


@router.post("/packaging")
def add_packaging(body: PackagingIn, session: Session = Depends(get_packhouse_session)):
    return _save(session, Packaging, None, body)


@router.put("/packaging/{row_id}")
def update_packaging(row_id: int, body: PackagingIn, session: Session = Depends(get_packhouse_session)):
    return _save(session, Packaging, row_id, body)


@router.get("/markets")
def all_markets(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Market).order_by(Market.sort, Market.id)).all()


@router.post("/markets")
def add_market(body: MarketIn, session: Session = Depends(get_packhouse_session)):
    return _save(session, Market, None, body)


@router.put("/markets/{row_id}")
def update_market(row_id: int, body: MarketIn, session: Session = Depends(get_packhouse_session)):
    return _save(session, Market, row_id, body)
