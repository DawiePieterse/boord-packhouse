"""Settings -> Delivery Note: the transporters and receivers the note offers,
and the cooled-to temperature a new note starts with. Behind the PIN.

The packs' rules (consignment_settings.py): a retired one (active = false)
leaves the screen, notes keep what they copied, and delete is only for one no
live note uses.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, func, select

from admin_auth import require_admin
from db import get_packhouse_session
from models import DeliveryNote, DeliveryNoteSettings, Receiver, Transporter
from routers.consignment_settings import _save

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_admin)])


class TransporterIn(SQLModel):
    name: str
    active: bool = True


class ReceiverIn(SQLModel):
    name: str
    market: str = ""
    city: str = ""
    active: bool = True


class DeliverySettingsIn(SQLModel):
    cooled_to: float
    last_no: Optional[int] = None
    target_receiver: str = ""
    eu_target_receiver: str = ""


def _delete(session: Session, model, column, row_id: int):
    row = session.get(model, row_id)
    if row is None:
        raise HTTPException(404, "Not found")
    if session.exec(select(DeliveryNote).where(column == row_id, DeliveryNote.removed == False)).first():  # noqa: E712
        raise HTTPException(409, "It is on a delivery note - untick In use instead")
    session.delete(row)
    session.commit()
    return {"ok": True}


@router.get("/transporters")
def all_transporters(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Transporter).order_by(func.lower(Transporter.name), Transporter.id)).all()


@router.post("/transporters")
def add_transporter(body: TransporterIn, session: Session = Depends(get_packhouse_session)):
    return _save(session, Transporter, None, body)


@router.put("/transporters/{row_id}")
def update_transporter(row_id: int, body: TransporterIn, session: Session = Depends(get_packhouse_session)):
    return _save(session, Transporter, row_id, body)


@router.delete("/transporters/{row_id}")
def delete_transporter(row_id: int, session: Session = Depends(get_packhouse_session)):
    return _delete(session, Transporter, DeliveryNote.transporter_id, row_id)


@router.get("/receivers")
def all_receivers(session: Session = Depends(get_packhouse_session)):
    return session.exec(select(Receiver).order_by(func.lower(Receiver.name), Receiver.id)).all()


@router.post("/receivers")
def add_receiver(body: ReceiverIn, session: Session = Depends(get_packhouse_session)):
    body.market, body.city = body.market.strip(), body.city.strip()
    return _save(session, Receiver, None, body)


@router.put("/receivers/{row_id}")
def update_receiver(row_id: int, body: ReceiverIn, session: Session = Depends(get_packhouse_session)):
    body.market, body.city = body.market.strip(), body.city.strip()
    return _save(session, Receiver, row_id, body)


@router.delete("/receivers/{row_id}")
def delete_receiver(row_id: int, session: Session = Depends(get_packhouse_session)):
    return _delete(session, Receiver, DeliveryNote.receiver_id, row_id)


@router.put("/deliverynote")
def save_delivery_settings(body: DeliverySettingsIn, session: Session = Depends(get_packhouse_session)):
    if not -5 <= body.cooled_to <= 30:
        raise HTTPException(422, "The temperature must be between -5 and 30 °C")
    if body.last_no is not None and body.last_no < 1:
        raise HTTPException(422, "The last note number is a whole number from 1")
    row = session.get(DeliveryNoteSettings, 1) or DeliveryNoteSettings(id=1)
    row.cooled_to, row.last_no = body.cooled_to, body.last_no
    row.target_receiver, row.eu_target_receiver = body.target_receiver.strip(), body.eu_target_receiver.strip()
    session.add(row)
    session.commit()
    session.refresh(row)
    return row
