"""pallet barcode as the bare SSCC

Revision ID: b7e2c4a91f05
Revises: a1d5c3e8f702
Created: 2026-11-18 12:00:00

Some scanners put ]C1 (the GS1-128 symbology identifier) in front of a pallet
label's code, others (00) or a bare 00. Keep every pallet's barcode as just its
18-digit SSCC, as export_forms.pallet_code does from now on (the rule is
copied here so this migration never changes). Delivery notes keep their own
copies as they went out; their papers clean the code when drawn.
"""
import re

from alembic import op
import sqlalchemy as sa


revision = 'b7e2c4a91f05'
down_revision = 'a1d5c3e8f702'
branch_labels = None
depends_on = None


def _code(code: str) -> str:
    c = re.sub(r"^\][A-Za-z]\d", "", code.strip()).replace("\x1d", "")
    m = re.fullmatch(r"\(?00\)?(\d{18})", c)
    return m.group(1) if m else c


def upgrade() -> None:
    conn = op.get_bind()
    for uuid, barcode in conn.execute(sa.text("SELECT uuid, barcode FROM pallet")).fetchall():
        if _code(barcode) != barcode:
            conn.execute(sa.text("UPDATE pallet SET barcode = :b WHERE uuid = :u"), {"b": _code(barcode), "u": uuid})


def downgrade() -> None:
    pass  # what each scanner sent is not kept; the bare SSCC is right either way
