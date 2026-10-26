"""Delivery notes (the paper Afleweringsnota), made on a phone.

The pallets' technique (routers/consignment.py): each note is made on the
phone with its own uuid, queued in IndexedDB and sent here until it lands, an
idempotent upsert where the latest copy replaces the fields the phone owns.
Who made it is set once, on first arrival. The PDF is the paper note, to
print or share on WhatsApp.
"""
import json
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel import Session, SQLModel, select

from db import get_packhouse_session
from models import DeliveryNote
from routers.sulfur import _iso, _now, _utc_naive
from routers.sulfur_report import _latin

router = APIRouter(prefix="/api/deliverynote", tags=["deliverynote"])

# Notes newer than this are sent to the phones; older ones are history.
LISTED = timedelta(days=90)


class NoteIn(SQLModel):
    uuid: str
    note_no: int
    created_at: datetime
    receiver: str = ""
    transporter: str = ""
    seal_no: str = ""
    cooled_to: str = ""
    loaded_on: str = ""
    offloaded_on: str = ""
    lines: list = []
    made_by: str = ""
    made_by_name: str = ""
    changed_by: str = ""
    changed_by_name: str = ""
    removed: bool = False


class SyncIn(SQLModel):
    device: str = ""
    notes: List[NoteIn] = []


def _is_day(v: str) -> bool:
    try:
        date.fromisoformat(v)
        return True
    except ValueError:
        return False


def _note_problem(rec: NoteIn, session: Session) -> Optional[str]:
    if not rec.uuid or len(rec.uuid) > 64:
        return "bad uuid"
    if rec.removed:
        return None
    if rec.note_no < 1:
        return "the note number is a whole number from 1"
    # A note taken off frees its number.
    twin = session.exec(select(DeliveryNote).where(DeliveryNote.note_no == rec.note_no, DeliveryNote.uuid != rec.uuid,
                                                   DeliveryNote.removed == False)).first()  # noqa: E712
    if twin is not None:
        return f"note {rec.note_no} is already used"
    if not rec.receiver.strip():
        return "a note needs its receiver"
    if not _is_day(rec.loaded_on) or (rec.offloaded_on and not _is_day(rec.offloaded_on)):
        return "bad date"
    if not rec.lines:
        return "a note needs at least one line"
    for ln in rec.lines:
        if not isinstance(ln, dict) or not (isinstance(ln.get("count"), int) and ln["count"] >= 1) \
                or not str(ln.get("description") or "").strip():
            return "every line needs a number and what it is"
    return None


def note_out(n: DeliveryNote) -> dict:
    o = n.model_dump()
    o["lines"] = json.loads(n.lines or "[]")
    for key in ("created_at", "synced_at"):
        o[key] = _iso(o[key])
    return o


@router.post("/sync")
def sync(body: SyncIn, session: Session = Depends(get_packhouse_session)):
    now = _now()
    synced, rejected = [], []
    for rec in body.notes:
        problem = _note_problem(rec, session)
        if problem:
            rejected.append({"uuid": rec.uuid, "error": problem})
            continue
        row = session.get(DeliveryNote, rec.uuid)
        if row is None:
            row = DeliveryNote(uuid=rec.uuid, note_no=rec.note_no, created_at=_utc_naive(rec.created_at),
                               device=body.device, synced_at=now, made_by=rec.made_by, made_by_name=rec.made_by_name)
        row.removed, row.changed_by, row.changed_by_name = rec.removed, rec.changed_by, rec.changed_by_name
        if not rec.removed:
            row.note_no, row.lines = rec.note_no, json.dumps(rec.lines)
            row.receiver, row.transporter, row.seal_no, row.cooled_to = rec.receiver, rec.transporter, rec.seal_no, rec.cooled_to
            row.loaded_on, row.offloaded_on = rec.loaded_on, rec.offloaded_on
        session.add(row)
        session.flush()  # the next note in this pass sees this one's number
        synced.append(rec.uuid)
    session.commit()
    return {"server_now": _iso(now), "synced": synced, "rejected": rejected}


@router.get("/state")
def state(session: Session = Depends(get_packhouse_session)):
    """The recent notes, newest first. Removed ones are sent too, so a phone
    holding its own copy of one learns it went."""
    now = _now()
    notes = session.exec(select(DeliveryNote).where(DeliveryNote.created_at >= now - LISTED)
                         .order_by(DeliveryNote.created_at.desc())).all()
    return {"server_now": _iso(now), "notes": [note_out(n) for n in notes]}


# The printed parts of the paper note.
FARM = "Bekfontein Boerdery"
CONTACT = ["Tel: 083 627 6926", "Office: 083 762 1395", "Email: andre@laughw.co.za"]
SENDER = ["BEKFONTEIN BOERDERY", "POSBUS 1290", "MALELANE", "1320"]
SMALL_PRINT = ("Bekfontein Boerdery is nie verantwoordelik vir enige tekorte of beskadiging van goedere voor of na "
               "aflewering nie. Indien enige eise: Doen dit asseblief stiptelik binne sewe dae na aflewering d.m.v. "
               "'n epos na ons kantore.")


def _day(v: str) -> str:
    return date.fromisoformat(v).strftime("%d/%m/%y") if v else ""


@router.get("/{uuid}/pdf")
def note_pdf(uuid: str, session: Session = Depends(get_packhouse_session)):
    """The note as the paper Afleweringsnota, on A5, signature lines blank."""
    from fpdf import FPDF
    n = session.get(DeliveryNote, uuid)
    if n is None or n.removed:
        raise HTTPException(404, "No such delivery note")
    pdf = FPDF(format="A5")
    pdf.set_margins(10, 10, 10)
    pdf.set_auto_page_break(True, margin=10)
    pdf.add_page()
    w = pdf.epw  # 128 mm
    half = w / 2

    def text(size, value, style="", h=5, **kw):
        pdf.set_font("Helvetica", style, size)
        pdf.cell(kw.pop("w", 0), h, _latin(value), **kw)

    # Header: farm and contact, then the note's title and number.
    top = pdf.get_y()
    text(18, FARM, "BI", h=9, new_x="LMARGIN", new_y="NEXT")
    text(8, "(EDMS) BPK    Reg Nr 1992/002298/07", h=4, new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(top)
    for line in CONTACT:
        text(8, line, h=4, w=w, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(top + 15)
    text(11, "AFLEWERINGSNOTA", "B", h=7, w=46)
    pdf.set_text_color(200, 0, 0)
    text(14, str(n.note_no), "B", h=7, new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)

    # Afsender | Ontvanger, then the three signatures.
    y = pdf.get_y()
    pdf.rect(pdf.l_margin, y, w, 34)
    pdf.line(pdf.l_margin + half, y, pdf.l_margin + half, y + 34)
    pdf.set_xy(pdf.l_margin + 1, y + 1)
    text(7, "AFSENDER", h=4, new_x="LMARGIN", new_y="NEXT")
    for line in SENDER:
        pdf.set_x(pdf.l_margin + 12)
        text(9, line, "B", h=5, new_x="LMARGIN", new_y="NEXT")
    pdf.set_xy(pdf.l_margin + half + 1, y + 1)
    text(7, "ONTVANGER", h=4)
    pdf.set_xy(pdf.l_margin + half + 1, y + 6)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(half - 2, 5, _latin(n.receiver.strip()), max_line_height=5)
    y += 34
    pdf.rect(pdf.l_margin, y, w, 12)
    for i, label in enumerate(("HANDTEKENING AFSENDER", "HANDTEKENING ONTVANGER", "HANDTEKENING DRYWER")):
        x = pdf.l_margin + i * w / 3
        if i:
            pdf.line(x, y, x, y + 12)
        pdf.set_xy(x + 1, y + 1)
        text(6, label, h=3)
    y += 12

    # Transporter, Seel Nr, Verkoel op.
    pdf.rect(pdf.l_margin, y, w, 8)
    pdf.set_xy(pdf.l_margin + 1, y + 1.5)
    text(8, "TRANSPORTER:", "B", h=5, w=25)
    text(10, n.transporter, h=5, w=half - 26)
    text(7, "SEEL NR", h=5, w=13)
    text(10, n.seal_no, h=5, w=20)
    text(7, "VERKOEL OP", h=5, w=17)
    text(10, f"{n.cooled_to} °C" if n.cooled_to else "°C", h=5, align="R", w=w - (pdf.get_x() - pdf.l_margin) - 1)
    y += 8

    # Getal | Beskrywing van inhoud: at least as many rows as the paper has.
    pdf.set_xy(pdf.l_margin, y)
    text(7, "GETAL", border=1, w=18, h=5)
    text(7, "BESKRYWING VAN INHOUD", border=1, w=w - 18, h=5, align="C", new_x="LMARGIN", new_y="NEXT")
    rows = json.loads(n.lines or "[]")
    for i in range(max(len(rows), 12)):
        ln = rows[i] if i < len(rows) else {}
        text(11, ln.get("count", ""), border=1, w=18, h=7, align="C")
        text(11, ln.get("description", ""), border=1, w=w - 18, h=7, new_x="LMARGIN", new_y="NEXT")

    pdf.ln(1)
    pdf.set_font("Helvetica", "", 6)
    pdf.multi_cell(w, 3, _latin(SMALL_PRINT), align="C")
    pdf.ln(2)
    text(7, "OPLAAIDATUM", w=20, h=6)
    text(11, _day(n.loaded_on), w=half - 20, h=6)
    text(7, "AFLAAIDATUM", w=20, h=6)
    text(11, _day(n.offloaded_on), h=6)
    name = f"afleweringsnota_{n.note_no}.pdf"
    return Response(bytes(pdf.output()), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
