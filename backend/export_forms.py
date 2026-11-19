"""The export papers for a delivery note, as Excel or PDF, for the USA or the EU.

The department accepts only its own workbook, so the papers are that workbook
(templates/export_forms.xlsx: the farm's LW 2300 of 18 Nov 2026, its sample
data cleared) with the note filled in cell by cell, straight into the sheets'
XML: every page, border, picture, stamp box and revision number stays theirs.
The USA gets its five sheets: DAFF's two-page accompanying document for the
phyto inspection, the consignment note and PPECB's two-page litchi inspection
findings sheet (Rev 2). The EU gets the same without the phyto pages. One row
per pallet line; the forms hold MAX_LINES.
"""
import io
import json
import posixpath
import re
import zipfile
from datetime import date, datetime
from pathlib import Path
from xml.sax.saxutils import escape

from fpdf import FPDF
from openpyxl import load_workbook

PUC = "D2087"
SIZES = ("XXXL", "XXL", "XL", "L", "M", "S", "MIX")
TEMPLATE = Path(__file__).resolve().parent / "templates" / "export_forms.xlsx"
PHYTO = (("Phyto (1)", range(27, 40)), ("Phyto (2)", range(27, 35)))  # its pallet rows the consignment note carries on
INSPECTION = ("Inspection Sheet", "Inspection Sheet (2)")  # 11 pallets each, two rows a pallet from row 14
MAX_LINES = 21  # the consignment note's rows, 11 to 31
EPOCH = date(1899, 12, 30)  # Excel's day 0


EXPORT_MARKET = re.compile(r"\b(usa|eu)\b", re.I)  # a pallet's market name that makes it export


def market_group(name: str) -> str:
    """A pallet's market group: usa or eu by its market name, else local. A
    delivery note holds pallets of one group."""
    hit = EXPORT_MARKET.search(name or "")
    return hit.group(1).lower() if hit else "local"


def note_label(n) -> str:
    """The note's number as printed: LW-1335 when it carries export (USA or EU)
    pallets, else B-1335 (local): one series of numbers, only the prefix differs.
    A juice note has its own series, J-0001 on."""
    export = any(EXPORT_MARKET.search(p.get("market_name") or "") for p in json.loads(n.pallets or "[]"))
    juice = json.loads(getattr(n, "bins", None) or "[]")
    if juice:
        return f"J-{n.note_no:04d}"
    return f"{'LW' if export else 'B'}-{n.note_no}"


def pallet_code(code: str) -> str:
    """A pallet label's code as it is kept: a GS1 SSCC is just its 18 digits,
    without the ]C1 some scanners put in front (the GS1-128 symbology
    identifier), the (00) or the bare 00. Any other code is kept as typed."""
    c = re.sub(r"^\][A-Za-z]\d", "", code.strip()).replace("\x1d", "")
    m = re.fullmatch(r"\(?00\)?(\d{18})", c)
    return m.group(1) if m else c


def _count(pack: str) -> str:
    """The size count (XL) out of the pack's name (Rhino 4.5 kg XL)."""
    return next((w for w in pack.upper().replace(",", " ").split() if w in SIZES), "")


def _package(pack: str) -> str:
    """The pack's name without its count: Rhino 4.5 kg."""
    return " ".join(w for w in pack.replace(",", " ").split() if w.upper() not in SIZES)


def _num(v):
    """A number the department's form keeps as one (block 10, date code 7304);
    one with a leading 0 (pallet 017) stays as typed."""
    return int(v) if isinstance(v, str) and v.isdigit() and not v.startswith("0") else v


def export_rows(pallets: list) -> list:
    rows = []
    for k, p in enumerate(pallets):
        for ln in p["lines"]:
            rows.append({"pallet": k, "pallet_no": p["pallet_ref"], "pallet_id": pallet_code(p["barcode"]),
                         "variety": ln.get("variety") or "", "block": (ln.get("block_name") or "").replace("Block ", ""),
                         "cartons": ln["cartons"], "date_code": p["date_code"], "count": _count(ln["packaging_name"]),
                         "pack": ln["packaging_name"]})
    return rows


class TooManyLines(ValueError):
    pass


def _facts(n, market: str):
    rows = export_rows(json.loads(n.pallets or "[]"))
    if len(rows) > MAX_LINES:
        raise TooManyLines(f"The department's forms hold {MAX_LINES} pallet lines and this note has {len(rows)}: "
                           "split it over two notes.")
    # The number as the farm writes it on the department's forms: LW 2300.
    return {"rows": rows, "doc_no": note_label(n).replace("-", " "), "market": market,
            "day": date.fromisoformat(n.loaded_on) if n.loaded_on else None,
            "varieties": ", ".join(sorted({r["variety"] for r in rows if r["variety"]})),
            "receiver": [line.strip() for line in n.receiver.split("\n") if line.strip()][:6]}


def _phyto(f, page: int) -> dict:
    """One page of DAFF's accompanying document: its own pallet lines, numbered
    on from the page before, and their totals."""
    first = sum(len(rows) for _, rows in PHYTO[:page])
    rows = PHYTO[page][1]
    mine = f["rows"][first:first + len(rows)]
    c = {"C5": f["doc_no"], "I9": f["day"]}
    for r in range(18, 23):  # the intake documents: one line, this note
        c.update({f"{col}{r}": None for col in "HJKL"})
    cartons, pallets = sum(x["cartons"] for x in mine), len({x["pallet"] for x in mine})
    if mine:
        c.update({"H19": f["doc_no"], "J19": PUC, "K19": cartons, "L19": pallets})
    c.update({"K23": cartons if mine else None, "L23": pallets if mine else None})
    for i, r in enumerate(range(27, 37 if page else 40)):  # every row the page has, the empty ones cleared
        x = mine[i] if i < len(mine) else None
        values = (first + i + 1, x["pallet_id"], "D 2087", x["variety"], _num(x["block"]), x["cartons"],
                  _num(x["date_code"]), x["count"], _num(x["pallet_no"])) if x else (None,) * 9
        c.update({f"{col}{r}": v for col, v in zip(("A", "B", "H", "I", "J", "K", "L", "M", "N"), values)})
    return c


def _consignment(f) -> dict:
    receiver = f["receiver"] + [None] * 6
    c = {f"F{r}": receiver[i] for i, r in enumerate(range(2, 8))}
    c.update({"K2": f["doc_no"], "K3": None, "C6": f["day"], "K8": f["market"], "C33": f["day"], "J34": None,
              "K35": None, "K32": sum(x["cartons"] for x in f["rows"])})
    for i, r in enumerate(range(11, 32)):
        x = f["rows"][i] if i < len(f["rows"]) else None
        values = (_num(x["pallet_no"]), x["pallet_id"], _num(x["date_code"]), "Litchis", x["variety"], "Class 1",
                  x["count"], _num(x["block"]), _package(x["pack"]), x["cartons"]) if x else (None,) * 10
        c.update({f"{col}{r}": v for col, v in zip("BCDEFGHIJK", values)})
    return c


def _inspection(f, page: int) -> dict:
    mine = f["rows"][11 * page:11 * page + 11]
    c = {"E9": f["receiver"][0] if f["receiver"] else None, "H10": "DATE:", "K10": f["day"],
         "C11": f"CULTIVAR:  {f['varieties']}", "B12": f["doc_no"]}
    for i in range(11):
        x = mine[i] if i < len(mine) else None
        c.update({f"A{14 + 2 * i}": x["pallet_id"] if x else None, f"D{15 + 2 * i}": f["market"] if x else None})
    return c


def _cell(ref: str, attrs: str, value) -> str:
    """A cell's XML with the template's style (s) kept and the value written
    as it is: a date as Excel's day number, text inline."""
    s = re.search(r'\ss="\d+"', attrs)
    s = s.group(0) if s else ""
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        value = (value - EPOCH).days
    if value is None:
        return f'<c r="{ref}"{s}/>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{s}><v>{value}</v></c>'
    return f'<c r="{ref}"{s} t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


def _fill(xml: str, cells: dict) -> str:
    for ref, value in cells.items():
        m = re.search(rf'<c r="{ref}"([^>]*?)(?:/>|>.*?</c>)', xml, re.S)
        if m is None:
            if value is None:
                continue
            raise KeyError(f"the template has no cell {ref}")
        xml = xml[:m.start()] + _cell(ref, m.group(1), value) + xml[m.end():]
    return xml


def _rels_of(path: str) -> str:
    return posixpath.join(posixpath.dirname(path), "_rels", posixpath.basename(path) + ".rels")


def _targets(parts: dict, path: str) -> dict:
    """A part's relationships: id -> the part it points to."""
    out = {}
    for rel in re.findall(r"<Relationship [^>]*>", parts.get(_rels_of(path), b"").decode()):
        if 'TargetMode="External"' in rel:
            continue
        target = re.search(r'Target="([^"]+)"', rel).group(1)
        out[re.search(r'Id="([^"]+)"', rel).group(1)] = (target.lstrip("/") if target.startswith("/") else
                                                          posixpath.normpath(posixpath.join(posixpath.dirname(path), target)))
    return out


def _sheets(parts: dict) -> dict:
    """The workbook's sheets in order: name -> its part."""
    rels = _targets(parts, "xl/workbook.xml")
    return {name: rels[rid] for name, rid in
            re.findall(r'<sheet name="([^"]+)"[^>]*r:id="([^"]+)"', parts["xl/workbook.xml"].decode())}


def _tidy(parts: dict) -> dict:
    """Keep only the parts the package still points to, and the content types
    of those: dropping a sheet drops its drawing, pictures and printer settings."""
    keep, todo = set(), ["", "xl/workbook.xml"]
    rels = {"": "_rels/.rels"}
    while todo:
        path = todo.pop()
        rp = rels.get(path, _rels_of(path))
        if rp not in parts:
            continue
        keep.add(rp)
        for rel in re.findall(r"<Relationship [^>]*>", parts[rp].decode()):
            if 'TargetMode="External"' in rel:
                continue
            target = re.search(r'Target="([^"]+)"', rel).group(1)
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(path), target))
            if part not in keep:
                keep.add(part)
                todo.append(part)
    keep.add("[Content_Types].xml")
    parts = {k: v for k, v in parts.items() if k in keep}
    types = re.sub(r'<Override PartName="/([^"]+)"[^>]*/>', lambda m: m.group(0) if m.group(1) in parts else "",
                   parts["[Content_Types].xml"].decode())
    parts["[Content_Types].xml"] = types.encode()
    return parts


def _filled(f, market: str) -> dict:
    """The template's parts with the note filled in."""
    with zipfile.ZipFile(TEMPLATE) as z:
        parts = {name: z.read(name) for name in z.namelist()}
    cells = {"Consignment 1": _consignment(f), INSPECTION[0]: _inspection(f, 0), INSPECTION[1]: _inspection(f, 1)}
    book = parts["xl/workbook.xml"].decode()
    if market == "USA":
        cells.update({PHYTO[0][0]: _phyto(f, 0), PHYTO[1][0]: _phyto(f, 1)})
    else:  # the EU has no phyto document
        for name, _ in PHYTO:
            book = re.sub(rf'<sheet name="{re.escape(name)}"[^>]*/>', "", book)
    names = re.findall(r'<sheet name="([^"]+)"', book)
    book = re.sub(r'activeTab="\d+"', f'activeTab="{names.index("Consignment 1")}"', book)
    # Every value is written, none worked out: no formulas, so no calculation chain.
    parts["xl/workbook.xml"] = book.encode()
    parts["xl/_rels/workbook.xml.rels"] = re.sub(r"<Relationship [^>]*calcChain[^>]*>", "",
                                                 parts["xl/_rels/workbook.xml.rels"].decode()).encode()
    if market != "USA":
        rels = parts["xl/_rels/workbook.xml.rels"].decode()
        live = set(re.findall(r'r:id="([^"]+)"', book))
        rels = re.sub(r'<Relationship [^>]*Id="([^"]+)"[^>]*worksheets/[^>]*>',
                      lambda m: m.group(0) if m.group(1) in live else "", rels)
        parts["xl/_rels/workbook.xml.rels"] = rels.encode()
    sheets = _sheets(parts)
    for name, values in cells.items():
        parts[sheets[name]] = _fill(parts[sheets[name]].decode(), values).encode()
    return _tidy(parts)


def _zip(parts: dict) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    return out.getvalue()


def forms(n, market: str = "USA") -> bytes:
    """The papers as the department's workbook, filled in."""
    return _zip(_filled(_facts(n, market), market))


def forms_pdf(n, market: str = "USA") -> bytes:
    """The same workbook drawn as one PDF, a sheet a page, each fitted to A4.
    Not Excel's own drawing (the farm PC has neither Excel nor LibreOffice):
    the cells, borders, pictures and stamp boxes are where the workbook puts
    them, the lettering is Helvetica."""
    parts = _filled(_facts(n, market), market)
    wb = load_workbook(io.BytesIO(_zip(parts)))
    pdf = FPDF(unit="pt", format="A4")
    pdf.set_auto_page_break(False)
    pdf.c_margin = 0
    for name, path in _sheets(parts).items():
        _sheet_pdf(pdf, wb[name], _drawing(parts, path))
    return bytes(pdf.output())


# Drawing a worksheet in fpdf2.
EMU_PT = 12700
WEIGHT = {"hair": 0.25, "thin": 0.5, "dotted": 0.5, "dashed": 0.5, "medium": 1.2, "mediumDashed": 1.2, "thick": 2,
          "double": 1.5}


def _latin(v) -> str:
    # fpdf2's built-in fonts are latin-1.
    return ("" if v is None else str(v)).replace("√", "v").replace("’", "'") \
        .encode("latin-1", "replace").decode("latin-1")


def _rgb(color, default=(0, 0, 0)):
    rgb = getattr(color, "rgb", None)
    return tuple(int(rgb[-6:][i:i + 2], 16) for i in (0, 2, 4)) if isinstance(rgb, str) else default


def _drawing(parts: dict, sheet: str) -> list:
    """The sheet's pictures, boxes and lines: (kind, from, to, picture bytes or text),
    from and to as (col, col offset, row, row offset) in points."""
    out = []
    for drawing in _targets(parts, sheet).values():
        if not drawing.startswith("xl/drawings/drawing"):
            continue
        media = _targets(parts, drawing)
        for anchor in re.findall(r"<xdr:twoCellAnchor.*?</xdr:twoCellAnchor>", parts[drawing].decode(), re.S):
            ends = [(int(c), int(co) / EMU_PT, int(r), int(ro) / EMU_PT) for c, co, r, ro in re.findall(
                r"<xdr:col>(\d+)</xdr:col><xdr:colOff>(-?\d+)</xdr:colOff><xdr:row>(\d+)</xdr:row><xdr:rowOff>(-?\d+)</xdr:rowOff>",
                anchor)]
            if "<xdr:pic>" in anchor:
                embed = re.search(r'r:embed="([^"]+)"', anchor).group(1)
                out.append(("picture", ends[0], ends[1], parts[media[embed]]))
            elif "<xdr:cxnSp" in anchor:
                out.append(("line", ends[0], ends[1], None))
            elif "<xdr:sp" in anchor:
                out.append(("box", ends[0], ends[1], " ".join(re.findall(r"<a:t>([^<]*)</a:t>", anchor))))
    return out


def _text(pdf, cell, x, y, w, h, scale):
    a, font = cell.alignment, cell.font
    pdf.set_font("Helvetica", ("B" if font.b else "") + ("I" if font.i else ""), (font.sz or 11) * scale)
    pdf.set_text_color(*_rgb(font.color))
    v = cell.value
    text = _latin(v.strftime("%Y/%m/%d") if isinstance(v, (date, datetime)) else v)
    pad = 2 * scale
    lh = pdf.font_size * 1.15
    align = {"center": "C", "right": "R"}.get(a.horizontal, "R" if isinstance(v, (int, float)) else "L")
    if a.wrap_text:
        lines = len(pdf.multi_cell(w - 2 * pad, lh, text, dry_run=True, output="LINES"))
    else:
        lines = 1
    top = {"top": y + pad, "center": y + (h - lines * lh) / 2}.get(a.vertical, y + h - lines * lh - pad)
    # Cut off at the row's height, as Excel does (Phyto (1)'s row 8 is too low to show);
    # text that doesn't wrap runs over the cells beside it.
    with pdf.rect_clip(x, y, w, h) if a.wrap_text else pdf.rect_clip(x - w - 400, y, 3 * w + 800, h):
        pdf.set_xy(x + pad, top)
        if a.wrap_text:
            pdf.multi_cell(w - 2 * pad, lh, text, align=align)
        else:
            pdf.cell(w - 2 * pad, lh, text, align=align)


def _sheet_pdf(pdf, ws, drawing):
    fmt = ws.sheet_format
    width = lambda c: 0 if ws.column_dimensions[chr(64 + c)].hidden else (
        ws.column_dimensions[chr(64 + c)].width or fmt.defaultColWidth or 8.43)  # noqa: E731
    height = lambda r: 0 if ws.row_dimensions[r].hidden else (  # noqa: E731
        ws.row_dimensions[r].height or fmt.defaultRowHeight or 15)
    ncol, nrow = ws.max_column, ws.max_row
    colw = [(width(c) * 7 + 5) * 0.75 for c in range(1, ncol + 1)]  # Excel's character width in points
    rowh = [height(r) for r in range(1, nrow + 1)]
    m = ws.page_margins
    left, top = m.left * 72, m.top * 72
    scale = min((pdf.w - left - m.right * 72) / sum(colw), (pdf.h - top - m.bottom * 72) / sum(rowh))
    xs = [left + sum(colw[:i]) * scale for i in range(ncol + 1)]
    ys = [top + sum(rowh[:i]) * scale for i in range(nrow + 1)]
    spans, hidden = {}, set()
    for rng in ws.merged_cells.ranges:
        spans[(rng.min_row, rng.min_col)] = (rng.max_row, rng.max_col)
        hidden |= {(r, c) for r in range(rng.min_row, rng.max_row + 1) for c in range(rng.min_col, rng.max_col + 1)}
    pdf.add_page()

    for r in range(1, nrow + 1):  # fills first, then borders over them, then text
        for c in range(1, ncol + 1):
            cell = ws.cell(r, c)
            if cell.fill.fill_type == "solid" and isinstance(cell.fill.fgColor.rgb, str):
                pdf.set_fill_color(*_rgb(cell.fill.fgColor, (255, 255, 255)))
                pdf.rect(xs[c - 1], ys[r - 1], xs[c] - xs[c - 1], ys[r] - ys[r - 1], style="F")
    for r in range(1, nrow + 1):
        for c in range(1, ncol + 1):
            b = ws.cell(r, c).border
            x0, x1, y0, y1 = xs[c - 1], xs[c], ys[r - 1], ys[r]
            for side, (ax, ay, bx, by) in ((b.left, (x0, y0, x0, y1)), (b.right, (x1, y0, x1, y1)),
                                           (b.top, (x0, y0, x1, y0)), (b.bottom, (x0, y1, x1, y1))):
                if side is not None and side.style:
                    pdf.set_draw_color(*_rgb(side.color))
                    pdf.set_line_width(WEIGHT.get(side.style, 0.5) * scale)
                    pdf.line(ax, ay, bx, by)
    for r in range(1, nrow + 1):
        for c in range(1, ncol + 1):
            if (r, c) in hidden and (r, c) not in spans:
                continue
            cell = ws.cell(r, c)
            if cell.value in (None, ""):
                continue
            r2, c2 = spans.get((r, c), (r, c))
            _text(pdf, cell, xs[c - 1], ys[r - 1], xs[c2] - xs[c - 1], ys[r2] - ys[r - 1], scale)

    def at(end):
        col, col_off, row, row_off = end
        return (xs[min(col, ncol)] + col_off * scale, ys[min(row, nrow)] + row_off * scale)

    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.75 * scale)
    for kind, a, b, what in drawing:
        (x0, y0), (x1, y1) = at(a), at(b)
        if kind == "picture":
            pdf.image(io.BytesIO(what), x0, y0, x1 - x0, y1 - y0)
        elif kind == "line":
            pdf.line(x0, y0, x1, y1)
        else:
            pdf.set_fill_color(255, 255, 255)
            pdf.rect(x0, y0, x1 - x0, y1 - y0, style="DF")
            if what:
                pdf.set_font("Helvetica", "B", 11 * scale)
                pdf.set_text_color(166, 166, 166)
                pdf.set_xy(x0, y0 + 4 * scale)
                pdf.cell(x1 - x0, 12 * scale, _latin(what), align="C")
