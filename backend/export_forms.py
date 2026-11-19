"""The export papers for a delivery note, as Excel or PDF, for the USA or the EU.

The department accepts only its own workbook, so the papers are that workbook
(templates/export_forms.xlsx: the farm's LW 2300 of 18 Nov 2026, its sample
data cleared) with the note filled in cell by cell, straight into the sheets'
XML: every page, border, picture, stamp box and revision number stays theirs.
The USA gets its five sheets: DAFF's two-page accompanying document for the
phyto inspection, the consignment note and PPECB's two-page litchi inspection
findings sheet (Rev 2). The EU gets the same without the phyto pages. One row
per pallet line; the forms hold MAX_LINES. The PDF is Excel's own, made on the
farm PC (forms_pdf).
"""
import io
import json
import os
import posixpath
import re
import subprocess
import sys
import tempfile
import threading
import zipfile
from datetime import date, datetime
from pathlib import Path
from xml.sax.saxutils import escape

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


# A pack that only ever holds one size: a Rhino carton is always XL.
PACK_COUNT = {"RHINO": "XL"}


def _count(pack: str) -> str:
    """The size count (XL) out of the pack's name (Rhino 4.5 kg XL), else the
    one size its pack always holds (4.5kg Rhino)."""
    words = pack.upper().replace(",", " ").split()
    return next((w for w in words if w in SIZES), None) or next((PACK_COUNT[w] for w in words if w in PACK_COUNT), "")


def _package(pack: str) -> str:
    """The pack's name without its count: Rhino 4.5 kg."""
    return " ".join(w for w in pack.replace(",", " ").split() if w.upper() not in SIZES)


def _num(v):
    """A number the department's form keeps as one (block 10, date code 7304);
    one with a leading 0 (pallet 017) stays as typed."""
    return int(v) if isinstance(v, str) and v.isdigit() and not v.startswith("0") else v


def export_rows(pallets: list) -> list:
    rows = []
    # Lowest pallet number first, as the department's forms run.
    order = sorted(range(len(pallets)), key=lambda k: (str(pallets[k].get("pallet_ref") or "").zfill(6), k))
    for k in order:
        p = pallets[k]
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
    if value is None or value == "":
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


class NoPdf(RuntimeError):
    pass


# Excel itself saves the workbook as PDF, so the PDF is Excel's own printout of the
# department's form. PowerShell's COM, not a Python package: pip can't install past
# the farm PC's Device Guard. Excel opened by a task running as SYSTEM needs its
# profile's Desktop folder, so the script makes it first.
EXCEL_PDF = r"""
$ErrorActionPreference = 'Stop'
foreach ($d in "$env:windir\System32\config\systemprofile\Desktop", "$env:windir\SysWOW64\config\systemprofile\Desktop") {
  try { if ((Test-Path (Split-Path $d)) -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } } catch { }
}
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.ScreenUpdating = $false
  $wb = $xl.Workbooks.Open($env:FORMS_IN, 0, $true)
  try { $wb.ExportAsFixedFormat(0, $env:FORMS_OUT) } finally { $wb.Close($false) }
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
"""
EXCEL = threading.Lock()  # one Excel at a time


def _excel_pdf(xlsx: bytes) -> bytes:
    if sys.platform != "win32":
        raise NoPdf("The PDF is made by Excel on the farm PC: here, use the Excel file.")
    with EXCEL, tempfile.TemporaryDirectory() as d:
        src, out = Path(d, "forms.xlsx"), Path(d, "forms.pdf")
        src.write_bytes(xlsx)
        env = {**os.environ, "FORMS_IN": str(src), "FORMS_OUT": str(out)}
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                "-Command", EXCEL_PDF], env=env, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            # Only the server's own Excel (SYSTEM's), never one someone has open on the PC.
            subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE", "/FI", "USERNAME eq NT AUTHORITY\\SYSTEM"],
                           capture_output=True)
            raise NoPdf("Excel on the farm PC took too long to make the PDF: use the Excel file.")
        if r.returncode or not out.exists():
            why = (r.stderr or r.stdout).strip().splitlines()
            raise NoPdf("Excel on the farm PC could not make the PDF (" + (why[0] if why else f"exit {r.returncode}")
                        + "): use the Excel file.")
        return out.read_bytes()


def forms_pdf(n, market: str = "USA") -> bytes:
    """The same workbook as one PDF, saved by Excel itself: what printing it
    from Excel gives, a sheet a page by the department's own page setup."""
    return _excel_pdf(forms(n, market))
