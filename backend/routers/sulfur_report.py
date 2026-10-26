"""Settings -> Sulfur's daily report: the paper "sulfur room" log and the
"sulfur usage per day" sheet, from the runs, as a table, Excel and PDF.
Behind the PIN.

Days are farm-local calendar days (timeutil), so a run at 06:00 lands on the
day the packhouse worked, not the UTC day before.
"""
import io
import json
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlmodel import Session, select

import timeutil
from admin_auth import require_admin
from db import get_packhouse_session
from models import SulfurRun

router = APIRouter(prefix="/api/settings/sulfur/report", tags=["settings"], dependencies=[Depends(require_admin)])

LOG_HEAD = ["Date", "Batch nr", "Tent", "Time in", "SO time (min)", "Time out", "Lugs", "Size",
            "Fruit", "Sulfur (g)", "Operator"]
DAY_HEAD = ["Date", "Tent", "Runs", "Lugs", "Sulfur used (g)"]


def _source(r: SulfurRun) -> str:
    first = {"block_name": r.block_name, "supplier_id": r.supplier_id, "supplier_name": r.supplier_name}
    names = [f"Bought-in: {m['supplier_name']}" if m.get("supplier_id") is not None else m.get("block_name", "")
             for m in [first] + json.loads(r.more_sources or "[]")]
    return " + ".join(n for n in names if n)


def build(session: Session, start: date, end: date, tent_id: Optional[int] = None) -> dict:
    """{"runs": [...], "days": [...]}: every run in the span, oldest first,
    and the grams, lugs and runs per day and tent, with a total for each day
    (tent "All tents")."""
    lo, hi = timeutil.day_bounds(start, end)
    query = select(SulfurRun).where(SulfurRun.started_at >= lo, SulfurRun.started_at <= hi)
    if tent_id is not None:
        query = query.where(SulfurRun.tent_id == tent_id)
    runs, days = [], {}
    for r in session.exec(query.order_by(SulfurRun.started_at)).all():
        started, ended = timeutil.to_local(r.started_at), timeutil.to_local(r.ended_at)
        day = started.date().isoformat()
        runs.append({"date": day, "batch_no": r.batch_no, "tent": r.tent_name,
                     "time_in": started.strftime("%H:%M"),
                     "minutes": r.minutes, "time_out": ended.strftime("%H:%M") if ended else "",
                     "lugs": r.crates, "size": r.size, "fruit": _source(r), "grams": r.grams,
                     "operator": r.started_by_name or r.started_by})
        for tent in (r.tent_name, "All tents"):
            d = days.setdefault((day, tent), {"date": day, "tent": tent, "runs": 0, "lugs": 0, "grams": 0.0})
            d["runs"] += 1
            d["lugs"] += r.crates
            d["grams"] += r.grams
    # Per day: each tent, then the day's total.
    ordered = sorted(days.values(), key=lambda d: (d["date"], d["tent"] == "All tents", d["tent"]))
    return {"runs": runs, "days": ordered}


def _span(start: date, end: Optional[date]) -> tuple:
    end = end or start
    if end < start or (end - start) > timedelta(days=366):
        raise HTTPException(422, "The report runs from a day up to at most a year later")
    return start, end


def _data(start: date, end: Optional[date], tent_id: Optional[int], session: Session) -> dict:
    start, end = _span(start, end)
    return build(session, start, end, tent_id)


@router.get("")
def report(start: date = Query(..., alias="from"), end: Optional[date] = Query(None, alias="to"),
           tent_id: Optional[int] = None, session: Session = Depends(get_packhouse_session)):
    return _data(start, end, tent_id, session)


def _log_rows(data: dict) -> List[list]:
    return [[r["date"], r["batch_no"], r["tent"], r["time_in"], r["minutes"], r["time_out"], r["lugs"],
             r["size"], r["fruit"], r["grams"], r["operator"]] for r in data["runs"]]


def _day_rows(data: dict) -> List[list]:
    return [[d["date"], d["tent"], d["runs"], d["lugs"], d["grams"]] for d in data["days"]]


def _name(start: date, end: date, ext: str) -> str:
    return f"sulfur_{start.isoformat()}" + (f"_to_{end.isoformat()}" if end != start else "") + f".{ext}"


def _attach(content: bytes, media: str, filename: str) -> Response:
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/xlsx")
def report_xlsx(start: date = Query(..., alias="from"), end: Optional[date] = Query(None, alias="to"),
                tent_id: Optional[int] = None, session: Session = Depends(get_packhouse_session)):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    start, end = _span(start, end)
    data = build(session, start, end, tent_id)
    wb = Workbook()
    for ws, title, head, rows, widths in (
            (wb.active, "Sulfur room log", LOG_HEAD, _log_rows(data), [11, 24, 10, 8, 13, 9, 7, 8, 30, 11, 18]),
            (wb.create_sheet(), "Usage per day", DAY_HEAD, _day_rows(data), [11, 12, 7, 7, 15])):
        ws.title = title
        ws.append(head)
        for row in rows:
            ws.append(row)
        for cell in ws[1]:
            cell.font = Font(bold=True)
        for i, w in enumerate(widths):
            ws.column_dimensions[chr(65 + i)].width = w
        ws.freeze_panes = "A2"
    for row in wb["Usage per day"].iter_rows(min_row=2):
        if row[1].value == "All tents":  # the day's total, bold
            for cell in row:
                cell.font = Font(bold=True)
    out = io.BytesIO()
    wb.save(out)
    return _attach(out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                   _name(start, end, "xlsx"))


def _latin(v) -> str:
    # fpdf2's built-in fonts are latin-1 (Afrikaans names are fine).
    return ("" if v is None else f"{v:g}" if isinstance(v, float) else str(v)).encode("latin-1", "replace").decode("latin-1")


@router.get("/pdf")
def report_pdf(start: date = Query(..., alias="from"), end: Optional[date] = Query(None, alias="to"),
               tent_id: Optional[int] = None, session: Session = Depends(get_packhouse_session)):
    from fpdf import FPDF
    start, end = _span(start, end)
    data = build(session, start, end, tent_id)
    pdf = FPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(True, margin=12)
    pdf.add_page()

    def title(text):
        pdf.set_font("Helvetica", "B", 13)
        pdf.cell(0, 8, _latin(text), new_x="LMARGIN", new_y="NEXT")

    def table(head, rows, widths, bold_if=None):
        pdf.set_font("Helvetica", "B", 8)
        for h, w in zip(head, widths):
            pdf.cell(w, 6, _latin(h), border=1)
        pdf.ln()
        for row in rows:
            pdf.set_font("Helvetica", "B" if bold_if and bold_if(row) else "", 8)
            if pdf.get_y() > 190:
                pdf.add_page()
            for v, w in zip(row, widths):
                pdf.cell(w, 5.5, _latin(v), border=1)
            pdf.ln()

    span = start.isoformat() + (f" to {end.isoformat()}" if end != start else "")
    title(f"Bekfontein Boerdery - Sulfur room log, {span}")
    table(LOG_HEAD, _log_rows(data), [20, 46, 20, 16, 24, 16, 12, 16, 60, 20, 27])
    pdf.ln(4)
    title("Sulfur usage per day")
    table(DAY_HEAD, _day_rows(data), [24, 30, 16, 16, 32], bold_if=lambda r: r[1] == "All tents")
    return _attach(bytes(pdf.output()), "application/pdf", _name(start, end, "pdf"))
