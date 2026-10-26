"""Consignments and their pallets, captured on a phone.

The sulfur runs' technique (routers/sulfur.py): every record is made on the
phone with its own uuid, queued in IndexedDB and sent here until it lands, an
idempotent upsert by uuid. Unlike a run, a consignment and its pallets stay
editable (a rescan, a changed count, a pallet taken off), so the latest copy
sent replaces the fields the phone owns. What the server owns, the pallet's
year / number, is given once, the first time the pallet arrives.

A stack only groups pallets: each pallet has its own supplier and market, and
each of its lines (pack, cartons) its own block. A pallet's barcode is optional; when it has one, it is unique
among the pallets still on a consignment.
"""
import json
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, SQLModel, func, select

from db import get_packhouse_session
from models import Consignment, Market, Pallet
from routers.sulfur import _iso, _now, _utc_naive
from timeutil import to_local

router = APIRouter(prefix="/api/consignment", tags=["consignment"])

# Consignments newer than this are sent to the phones; older ones are history.
LISTED = timedelta(days=90)


class ConsignmentIn(SQLModel):
    uuid: str
    created_at: datetime


class PalletIn(SQLModel):
    uuid: str
    consignment_uuid: str
    barcode: str
    scanned_at: datetime
    pallet_ref: str = ""
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    market_id: Optional[int] = None
    market_name: str = ""
    date_code: str = ""
    scanned_by: str = ""
    scanned_by_name: str = ""
    changed_by: str = ""
    changed_by_name: str = ""
    lines: list = []
    removed: bool = False


class SyncIn(SQLModel):
    device: str = ""
    consignments: List[ConsignmentIn] = []
    pallets: List[PalletIn] = []


def _lines_problem(lines: list) -> Optional[str]:
    if not lines:
        return "a pallet needs at least one line"
    for ln in lines:
        if not isinstance(ln, dict) or not (isinstance(ln.get("cartons"), int) and ln["cartons"] >= 1):
            return "every line needs a whole number of cartons"
        if not (isinstance(ln.get("carton_kg"), (int, float)) and ln["carton_kg"] > 0) or not ln.get("packaging_name"):
            return "every line needs a carton type and its weight"
    return None


def _pallet_problem(rec: PalletIn, session: Session) -> Optional[str]:
    if not rec.uuid or len(rec.uuid) > 64:
        return "bad uuid"
    if session.get(Consignment, rec.consignment_uuid) is None:
        return "unknown consignment"
    barcode = rec.barcode.strip()
    if not rec.removed:
        if not (len(rec.pallet_ref) == 3 and rec.pallet_ref.isascii() and rec.pallet_ref.isdigit()):
            return "the pallet number is 3 digits"
        # Unique across every stack in the season (the farm-local year the pallet
        # was scanned in: litchi season sits inside one calendar year). A pallet
        # taken off frees its number.
        season = to_local(_utc_naive(rec.scanned_at)).year
        twin = session.exec(select(Pallet).where(Pallet.pallet_year == season, Pallet.pallet_ref == rec.pallet_ref,
                                                 Pallet.uuid != rec.uuid, Pallet.removed == False)).first()  # noqa: E712
        if twin is not None:
            return f"pallet {rec.pallet_ref} is already used this season"
        if rec.supplier_id is None:
            return "a pallet needs its supplier"
        if rec.market_id is None or session.get(Market, rec.market_id) is None:
            return "unknown market"
        problem = _lines_problem(rec.lines)
        if problem:
            return problem
        other = barcode and session.exec(select(Pallet).where(Pallet.barcode == barcode, Pallet.uuid != rec.uuid,
                                                              Pallet.removed == False)).first()  # noqa: E712
        if other:
            return f"barcode already on pallet {other.pallet_year}-{other.pallet_no:04d}"
    return None


def _next_number(session: Session, year: int) -> int:
    return (session.exec(select(func.max(Pallet.pallet_no)).where(Pallet.pallet_year == year)).one() or 0) + 1


def pallet_out(p: Pallet) -> dict:
    o = p.model_dump()
    o["lines"] = json.loads(p.lines or "[]")
    for key in ("scanned_at", "synced_at"):
        o[key] = _iso(o[key])
    return o


@router.post("/sync")
def sync(body: SyncIn, session: Session = Depends(get_packhouse_session)):
    now = _now()
    synced, rejected = [], []
    for rec in body.consignments:
        if not rec.uuid or len(rec.uuid) > 64:
            rejected.append({"uuid": rec.uuid, "error": "bad uuid"})
            continue
        if session.get(Consignment, rec.uuid) is None:
            session.add(Consignment(uuid=rec.uuid, created_at=_utc_naive(rec.created_at), device=body.device, synced_at=now))
        synced.append(rec.uuid)
    session.flush()  # a pallet sent in the same pass finds its consignment
    for rec in body.pallets:
        problem = _pallet_problem(rec, session)
        if problem:
            rejected.append({"uuid": rec.uuid, "error": problem})
            continue
        row = session.get(Pallet, rec.uuid)
        if row is None:
            scanned = _utc_naive(rec.scanned_at)
            year = to_local(scanned).year
            row = Pallet(uuid=rec.uuid, consignment_uuid=rec.consignment_uuid, scanned_at=scanned, device=body.device,
                         synced_at=now, barcode="", pallet_year=year, pallet_no=_next_number(session, year),
                         scanned_by=rec.scanned_by, scanned_by_name=rec.scanned_by_name)
        row.barcode, row.removed = rec.barcode.strip(), rec.removed
        row.changed_by, row.changed_by_name = rec.changed_by, rec.changed_by_name
        if not rec.removed:
            row.lines, row.pallet_ref = json.dumps(rec.lines), rec.pallet_ref
            row.supplier_id, row.supplier_name = rec.supplier_id, rec.supplier_name
            row.market_id, row.market_name, row.date_code = rec.market_id, rec.market_name, rec.date_code
        session.add(row)
        session.flush()  # the next new pallet counts this one
        synced.append(rec.uuid)
    session.commit()
    return {"server_now": _iso(now), "synced": synced, "rejected": rejected}


@router.get("/state")
def state(session: Session = Depends(get_packhouse_session)):
    """The recent consignments and their pallets, newest first. Removed pallets
    are sent too, so a phone holding its own copy of one learns it went."""
    now = _now()
    consignments = session.exec(select(Consignment).where(Consignment.created_at >= now - LISTED)
                                .order_by(Consignment.created_at.desc())).all()
    uuids = [c.uuid for c in consignments]
    pallets = session.exec(select(Pallet).where(Pallet.consignment_uuid.in_(uuids))
                           .order_by(Pallet.scanned_at)).all() if uuids else []
    cons = []
    for c in consignments:
        o = c.model_dump()
        o["created_at"], o["synced_at"] = _iso(c.created_at), _iso(c.synced_at)
        cons.append(o)
    return {"server_now": _iso(now), "consignments": cons, "pallets": [pallet_out(p) for p in pallets]}
