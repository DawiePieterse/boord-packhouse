"""Everything this app reads from Boord's database, as plain SQL.

Read-only (db.boord_engine is query_only) and deliberately not mirrored as
SQLModel classes, so Boord's tables never appear in our Alembic metadata.
BOORD_SCHEMA_CHECK lists every column read below; main.py refuses to boot if
Boord drops or renames one. Change the two together.

Boord stores timestamps naive UTC, like this app (timeutil.py).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import text

import timeutil
from db import boord_engine

BOORD_SCHEMA_CHECK = {
    "worker": "id, first_name, last_name, name, photo_filename, active",
    "block": "id, name, variety",
    "supplier": "id, name, is_own_farm",
    "lot": "id, supplier_id, total_crates, status, received_at",
    "harvestrecord": "lot_id, block_id",
}

# How far back to look for "the last previous receiving day". Off-season
# there is none, and the list is simply today's (empty).
LOOKBACK_DAYS = 14


def _display_name(row) -> str:
    return row.name or f"{row.first_name or ''} {row.last_name or ''}".strip() or row.id


def workers() -> list:
    """Active Boord workers. The tablets cache this so a badge scan works
    with no signal. The badge QR holds exactly worker.id."""
    with boord_engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT id, first_name, last_name, name, photo_filename FROM worker "
            "WHERE active = 1 ORDER BY id")).all()
    return [{"id": r.id, "name": _display_name(r),
             "photo": f"/photos/{r.photo_filename}" if r.photo_filename else ""} for r in rows]


# What this app prints for a supplier on its delivery notes and export papers,
# and the Boord column each comes from (Boord Admin -> Master Data ->
# Suppliers; the last five since Boord 3.67). Read when Boord has the column
# and blank when it has not, and on purpose not in BOORD_SCHEMA_CHECK: this
# release installed a night before Boord's must still boot, and then simply
# prints the farm's own details as it always has (export_forms.sender).
SUPPLIER_DETAILS = {"puc": "puc", "ggn": "global_gap_number", "document_name": "document_name",
                    "reg_number": "reg_number", "contact": "document_contact", "address": "document_address",
                    "note_prefix": "note_prefix"}


def suppliers() -> list:
    """Every Boord supplier, the farm's own first, each with the details its
    documents carry: the supplier picker on Pallet Stack, Delivery Note and
    Juice, and what a delivery note copies when it is saved."""
    with boord_engine.connect() as conn:
        have = {r[1] for r in conn.execute(text("PRAGMA table_info(supplier)"))}
        extra = "".join(f", {col} AS {key}" for key, col in SUPPLIER_DETAILS.items() if col in have)
        rows = conn.execute(text(f"SELECT id, name, is_own_farm{extra} FROM supplier "
                                 "ORDER BY is_own_farm DESC, name")).mappings().all()
    return [{"id": r["id"], "name": r["name"] or f"Supplier {r['id']}", "is_own_farm": bool(r["is_own_farm"]),
             **{key: (r.get(key) or "").strip() for key in SUPPLIER_DETAILS}} for r in rows]


def supplier(supplier_id) -> Optional[dict]:
    return next((s for s in suppliers() if s["id"] == supplier_id), None)


def own_supplier_id() -> Optional[int]:
    """The farm's own supplier row: whose a pallet, bin or note is when it
    does not say (one made before they were kept per supplier, v0.73)."""
    return next((s["id"] for s in suppliers() if s["is_own_farm"]), None)


def fruit_sources(now: Optional[datetime] = None) -> list:
    """What the sulfur screen's Fruit source picker offers: the farm's own
    blocks and the other suppliers in lots received today, then those of the
    last earlier receiving day. One group per day, newest first:

        [{"date": "2026-10-23", "label": "Today", "sources": [
            {"key": "block:15", "block_id": "15", "block_name": "Block 15",
             "variety": "Early Delight", "crates": 120},
            {"key": "supplier:2", "supplier_id": 2, "supplier_name": "Jansen Boerdery",
             "crates": 80}]}, ...]

    Days are farm-local calendar days. Own-farm blocks come from the crates'
    harvest records; another farmer's lot has none, so it is offered by
    supplier. Crates are Boord's field picking crates (about 7 kg on the
    farm), not the ~20 kg packhouse crates that go into a tent, so no weight
    is offered here: the suggested time uses Settings -> Sulfur's crate weight.
    """
    now = timeutil.as_utc(now or datetime.now(timezone.utc))
    since = (now - timedelta(days=LOOKBACK_DAYS)).replace(tzinfo=None)
    with boord_engine.connect() as conn:
        lots = conn.execute(text(
            "SELECT lot.id, lot.supplier_id, lot.total_crates, lot.received_at, "
            "supplier.name AS supplier_name, supplier.is_own_farm "
            "FROM lot LEFT JOIN supplier ON supplier.id = lot.supplier_id "
            "WHERE lot.received_at IS NOT NULL AND lot.received_at >= :since "
            "AND lot.status IN ('received', 'processing_complete')"), {"since": since}).all()

        today = now.astimezone().date()
        by_day = {}
        for lot in lots:
            received = lot.received_at
            if isinstance(received, str):
                received = datetime.fromisoformat(received)
            day = timeutil.to_local(received).date()
            if day <= today:
                by_day.setdefault(day, []).append(lot)
        days = sorted(by_day, reverse=True)
        # Today (when anything came in), then the last day before it.
        wanted = [d for d in days if d == today][:1] + [d for d in days if d < today][:1]

        groups = []
        for day in wanted:
            own = [l.id for l in by_day[day] if l.is_own_farm or l.supplier_id is None]
            sources = []
            if own:
                params = {f"l{i}": lot_id for i, lot_id in enumerate(own)}
                placeholders = ", ".join(f":{k}" for k in params)
                for b in conn.execute(text(
                        "SELECT harvestrecord.block_id, block.name, block.variety, COUNT(*) AS crates "
                        "FROM harvestrecord LEFT JOIN block ON block.id = harvestrecord.block_id "
                        f"WHERE harvestrecord.lot_id IN ({placeholders}) "
                        "AND harvestrecord.block_id IS NOT NULL "
                        "GROUP BY harvestrecord.block_id, block.name, block.variety "
                        "ORDER BY harvestrecord.block_id"), params).all():
                    sources.append({"key": f"block:{b.block_id}", "block_id": b.block_id,
                                    "block_name": b.name or f"Block {b.block_id}",
                                    "variety": b.variety or "", "crates": b.crates})
            others = {}
            for l in by_day[day]:
                if l.supplier_id is not None and not l.is_own_farm:
                    entry = others.setdefault(l.supplier_id, {
                        "key": f"supplier:{l.supplier_id}", "supplier_id": l.supplier_id,
                        "supplier_name": l.supplier_name or f"Supplier {l.supplier_id}", "crates": 0})
                    entry["crates"] += l.total_crates or 0
            sources += sorted(others.values(), key=lambda s: s["supplier_name"])
            label = "Today" if day == today else day.strftime("%a %d %b").replace(" 0", " ")
            groups.append({"date": day.isoformat(), "label": label, "sources": sources})
    return groups


def varieties() -> list:
    """Every variety on Boord's blocks, for Settings -> Sulfur."""
    with boord_engine.connect() as conn:
        return [r[0] for r in conn.execute(text(
            "SELECT DISTINCT variety FROM block WHERE variety IS NOT NULL AND variety != '' ORDER BY variety"))]
