"""Delivery notes (the paper Afleweringsnota), made on a phone.

The pallets' technique (routers/consignment.py): each note is made on the
phone with its own uuid, queued in IndexedDB and sent here until it lands, an
idempotent upsert where the latest copy replaces the fields the phone owns.
Who made it is set once, on first arrival. What is on the truck is pallets
from Pallet Stack, each on at most one live note; the note keeps its own copy
of each (number, barcode, supplier, market, lines), taken from the server's
pallet when the note is saved, so a pallet edited afterwards leaves a note
that has gone out as it was. The PDF is the paper note with every pallet and
its lines, to print or share on WhatsApp.
"""
import json
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlmodel import Session, SQLModel, func, select

from db import get_packhouse_session
from models import DeliveryNote, DeliveryNoteSettings, Pallet, Receiver, Transporter
from routers.sulfur import _iso, _now, _utc_naive
from routers.sulfur_report import _latin

router = APIRouter(prefix="/api/deliverynote", tags=["deliverynote"])

# Notes newer than this are sent to the phones; older ones are history.
LISTED = timedelta(days=90)


class NoteIn(SQLModel):
    uuid: str
    note_no: int
    created_at: datetime
    receiver_id: Optional[int] = None
    receiver: str = ""
    transporter_id: Optional[int] = None
    transporter: str = ""
    seal_no: str = ""
    cooled_to: str = ""
    loaded_on: str = ""
    offloaded_on: str = ""
    pallets: list = []      # [{uuid, ...}]: only the uuid is read, the rest is the server's copy
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
    if not rec.pallets:
        return "a note needs at least one pallet"
    uuids = _uuids(rec)
    if len(set(uuids)) != len(uuids):
        return "a pallet is on it twice"
    for uuid in uuids:
        p = session.get(Pallet, uuid)
        if p is None or p.removed:
            return "a pallet on it is not on the server (yet), or was deleted"
    # ponytail: scans every live note; a JSON column, fine for a farm's season of notes
    others = session.exec(select(DeliveryNote).where(DeliveryNote.uuid != rec.uuid, DeliveryNote.removed == False)).all()  # noqa: E712
    for other in others:
        shared = set(uuids) & {c["uuid"] for c in json.loads(other.pallets or "[]")}
        if shared:
            p = session.get(Pallet, shared.pop())
            return f"pallet {p.pallet_ref} is already on note {other.note_no}"
    return None


def _uuids(rec: NoteIn) -> list:
    return [c.get("uuid") if isinstance(c, dict) else None for c in rec.pallets]


# What a note keeps of each pallet.
KEPT = ("uuid", "pallet_ref", "barcode", "date_code", "supplier_name", "market_name")


def _copy(p: Pallet) -> dict:
    return {**{k: getattr(p, k) for k in KEPT}, "lines": json.loads(p.lines or "[]")}


def note_out(n: DeliveryNote) -> dict:
    o = n.model_dump()
    o["pallets"] = json.loads(n.pallets or "[]")
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
            row.note_no, row.pallets = rec.note_no, json.dumps([_copy(session.get(Pallet, u)) for u in _uuids(rec)])
            row.receiver_id, row.transporter_id = rec.receiver_id, rec.transporter_id
            row.receiver, row.transporter, row.seal_no, row.cooled_to = rec.receiver, rec.transporter, rec.seal_no, rec.cooled_to
            row.loaded_on, row.offloaded_on = rec.loaded_on, rec.offloaded_on
        session.add(row)
        if not rec.removed:  # the last note number moves on past this one
            settings = session.get(DeliveryNoteSettings, 1)
            if settings is not None and (settings.last_no or 0) < rec.note_no:
                settings.last_no = rec.note_no
                session.add(settings)
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


@router.get("/options")
def options(session: Session = Depends(get_packhouse_session)):
    """What a new note picks from (Settings -> Delivery Note): the transporters
    and receivers in use, the cooled-to temperature it starts with, and the
    last note number (Settings', else the highest ever used: the phones only
    hold 90 days of notes), so the next one follows on after a quiet spell too."""
    def active(model):
        return session.exec(select(model).where(model.active == True).order_by(model.sort, model.id)).all()  # noqa: E712
    settings = session.get(DeliveryNoteSettings, 1)
    return {"transporters": active(Transporter), "receivers": active(Receiver),
            "cooled_to": settings.cooled_to if settings else 8.0,
            "last_no": (settings.last_no if settings and settings.last_no
                        else session.exec(select(func.max(DeliveryNote.note_no))).one())}


# The printed parts of the paper note.
FARM = "Bekfontein Boerdery"
CONTACT = ["Tel: 083 627 6926", "Office: 083 762 1395", "Email: andre@laughw.co.za"]
SENDER = ["BEKFONTEIN BOERDERY", "POSBUS 1290", "MALELANE", "1320"]
# Printed in Afrikaans, as the paper note is, with the English beside it.
SMALL_PRINT = ("Bekfontein Boerdery is nie verantwoordelik vir enige tekorte of beskadiging van goedere voor of na "
               "aflewering nie. Indien enige eise: Doen dit asseblief stiptelik binne sewe dae na aflewering d.m.v. "
               "'n epos na ons kantore.\n"
               "Bekfontein Boerdery is not responsible for any shortage of or damage to goods before or after "
               "delivery. Any claim: please make it promptly, within seven days of delivery, by e-mail to our offices.")


def _kg(v: float) -> str:
    """kg as the screens show it (en-ZA): 1 234,5."""
    text = f"{round(v, 1):,.1f}".replace(",", " ").replace(".", ",")
    return text[:-2] if text.endswith(",0") else text


def _line_text(ln: dict) -> str:
    """A pallet line as Pallet Stack shows it: 80 x 1kg XXL, Block 7, Mauritius, Litchis."""
    block = f", {ln.get('block_name')}{', ' + ln['variety'] if ln.get('variety') else ''}" if ln.get("block_id") else ""
    return f"{ln['cartons']} x {ln['packaging_name']}{block}, Litchis"


def _cartons(p: dict) -> int:
    return sum(ln["cartons"] for ln in p["lines"])


def _pallet_kg(p: dict) -> float:
    return sum(ln["cartons"] * ln["carton_kg"] for ln in p["lines"])


def _day(v: str) -> str:
    return date.fromisoformat(v).strftime("%d/%m/%y") if v else ""


def _draw(n: DeliveryNote, pages: int):
    """The note as the paper Afleweringsnota on A4; pages is how many it
    runs to (note_pdf draws it once to count them), so "page 1 of 2" can be
    right-aligned: fpdf2's {nb} placeholder is filled in after the line is placed."""
    from fpdf import FPDF
    pdf = FPDF(format="A4")
    pdf.set_margins(15, 15, 15)
    pdf.set_auto_page_break(True, margin=15)
    pdf.add_page()
    w = pdf.epw  # 180 mm
    half = w / 2

    def text(size, value, style="", h=5, **kw):
        pdf.set_font("Helvetica", style, size)
        pdf.cell(kw.pop("w", 0), h, _latin(value), **kw)

    # One look throughout: printed labels small and upper case, what was
    # filled in at one size, bold only for the pallet numbers and the total.
    def label(value, **kw):
        text(7, value, h=kw.pop("h", 5), **kw)

    def value(v, style="", **kw):
        text(10, v, style, h=kw.pop("h", 5), **kw)

    # Header: farm and contact, then the note's title and number.
    top = pdf.get_y()
    text(18, FARM, "BI", h=9, new_x="LMARGIN", new_y="NEXT")
    text(8, "(EDMS) BPK    Reg Nr 1992/002298/07", h=4, new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(top)
    for line in CONTACT:
        text(8, line, h=4, w=w, align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(top + 15)

    def title_no():
        title = "AFLEWERINGSNOTA / DELIVERY NOTE"
        pdf.set_font("Helvetica", "B", 11)
        room = pdf.get_string_width(title) + 6
        text(11, title, "B", h=7, w=room)
        pdf.set_text_color(200, 0, 0)
        text(14, str(n.note_no), "B", h=7, w=30)
        text(14, f"page {pdf.page_no()} of {pages}", "B", h=7, w=w - room - 30, align="R")
        pdf.set_text_color(0, 0, 0)
        pdf.ln()

    title_no()

    # Afsender | Ontvanger, the same way (capitals, as the printed sender), then
    # three equal signature boxes.
    x0, y = pdf.l_margin, pdf.get_y()
    addresses = ((x0, "AFSENDER / SENDER", SENDER), (x0 + half, "ONTVANGER / RECEIVER", n.receiver.strip().upper().split("\n")[:5]))
    tall = 6 + 5 * max(len(lines) for _, _, lines in addresses) + 1.5  # as tall as the longer address, no more
    pdf.rect(x0, y, w, tall)
    pdf.line(x0 + half, y, x0 + half, y + tall)
    for x, title, lines in addresses:
        pdf.set_xy(x + 1.5, y + 1)
        label(title, h=4)
        for i, line in enumerate(lines):
            pdf.set_xy(x + 1.5, y + 6 + i * 5)
            value(line, w=half - 3)
    y += tall
    # Two rows in thirds, the dividing lines one above the other: the
    # signatures, then Transporter | Seel nr | Verkoel op.
    third = w / 3
    for height in (13, 8):
        pdf.rect(x0, y, w, height)
        for k in (1, 2):
            pdf.line(x0 + k * third, y, x0 + k * third, y + height)
        if height == 13:
            # Afrikaans, and the English under it: both in one line would not fit a third.
            for k, (afr, eng) in enumerate((("HANDTEKENING AFSENDER", "SENDER'S SIGNATURE"),
                                            ("HANDTEKENING ONTVANGER", "RECEIVER'S SIGNATURE"),
                                            ("HANDTEKENING DRYWER", "DRIVER'S SIGNATURE"))):
                for row, title in enumerate((afr, eng)):
                    pdf.set_xy(x0 + k * third + 1.5, y + 1 + row * 3)
                    text(6, title, h=3)
        y += height
    y -= 8

    # A filled-in value shrinks to fit its third rather than run over the line.
    def fitted(v, room):
        pdf.set_font("Helvetica", "", 10)
        text(max(6, min(10, 10 * room / max(pdf.get_string_width(_latin(v)), 1))), v, h=5, w=room)

    for k, (title, v) in enumerate((("TRANSPORTER", n.transporter), ("SEEL NR / SEAL NO", n.seal_no),
                                    ("VERKOEL OP / COOLED TO", f"{n.cooled_to} °C" if n.cooled_to else "°C"))):
        pdf.set_xy(x0 + k * third + 1.5, y + 1.5)
        pdf.set_font("Helvetica", "", 7)
        room = pdf.get_string_width(title) + 3  # the label's own width, then a gap
        label(title, w=room)
        fitted(v, third - room - 3)
    y += 8

    # Pallet no | Beskrywing van inhoud: each pallet a block of its own, shown
    # as Pallet Stack shows it, then the total. A block that would not fit
    # (with the small print and dates after the last one) starts a new page.
    col = 26  # room for TOTAAL / TOTAL
    footer = 26  # the boxed dates and the small print in both languages

    def head():
        if pdf.page_no() > 1:  # a later page says whose it is, as the first page does
            title_no()
        pdf.set_xy(x0, pdf.get_y())
        text(7, "PALLET NO", "B", border=1, w=col, h=6, align="C")
        text(7, "BESKRYWING VAN INHOUD / DESCRIPTION OF CONTENTS", "B", border=1, w=w - col, h=6, align="C", new_x="LMARGIN", new_y="NEXT")

    pdf.set_y(y)
    head()
    pallets = json.loads(n.pallets or "[]")
    bottom = pdf.h - pdf.b_margin
    for i, p in enumerate(pallets):
        height = 2 + 5 + 4.5 + 4.5 * len(p["lines"]) + 1.5
        last = i == len(pallets) - 1
        if pdf.get_y() + height + (8 + footer if last else 0) > bottom:
            pdf.add_page()
            head()
        y = pdf.get_y()
        pdf.rect(x0, y, col, height)
        pdf.rect(x0 + col, y, w - col, height)
        pdf.set_xy(x0, y + 1.5)
        text(12, p["pallet_ref"], "B", h=6, w=col, align="C")
        right = x0 + col + 1.5
        inner = w - col - 3
        pdf.set_xy(right, y + 1.5)
        value(" · ".join(v or "-" for v in (p["date_code"], p["supplier_name"], p["market_name"])), w=inner * 0.6)
        text(9, f"{_cartons(p)} cartons · {_kg(_pallet_kg(p))} kg", h=5, w=inner * 0.4, align="R")
        pdf.set_xy(right, y + 6.5)
        pdf.set_text_color(90, 90, 90)
        text(8, f"Barcode {p['barcode']}", h=4.5, w=inner)
        pdf.set_text_color(0, 0, 0)
        for j, ln in enumerate(p["lines"]):
            pdf.set_xy(right + 2, y + 11 + j * 4.5)
            text(9, f"{j + 1}.  {_line_text(ln)}", h=4.5, w=inner - 2)
        pdf.set_xy(x0, y + height)
    total = f"{len(pallets)} pallet{'' if len(pallets) == 1 else 's'} · {sum(map(_cartons, pallets))} cartons · {_kg(sum(map(_pallet_kg, pallets)))} kg"
    text(7, "TOTAAL / TOTAL", "B", border=1, w=col, h=8, align="C")
    value(total, "B", border=1, w=w - col, h=8, new_x="LMARGIN", new_y="NEXT")

    # The two dates, then the small print at the very bottom, boxed on under the table.
    y = pdf.get_y()
    for x, title, v in ((x0, "OPLAAIDATUM / LOAD DATE", n.loaded_on), (x0 + half, "AFLAAIDATUM / OFFLOAD DATE", n.offloaded_on)):
        pdf.rect(x, y, half, 8)
        pdf.set_xy(x + 1.5, y + 1.5)
        pdf.set_font("Helvetica", "", 7)
        room = pdf.get_string_width(title) + 3
        label(title, w=room)
        value(_day(v), w=half - room - 3)
    pdf.set_xy(x0, y + 8)
    pdf.set_font("Helvetica", "", 6)
    pdf.multi_cell(w, 3, _latin(SMALL_PRINT), border=1, align="C", padding=(1, 1.5), new_x="LMARGIN", new_y="NEXT")
    return pdf


@router.get("/{uuid}/pdf")
def note_pdf(uuid: str, session: Session = Depends(get_packhouse_session)):
    """The note as the paper Afleweringsnota, on A4, signature lines blank."""
    n = session.get(DeliveryNote, uuid)
    if n is None or n.removed:
        raise HTTPException(404, "No such delivery note")
    pdf = _draw(n, _draw(n, 1).page_no())
    name = f"afleweringsnota_{n.note_no}.pdf"
    return Response(bytes(pdf.output()), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
