"""Tents and sulfur runs - the app's first tables. Seeds Tent A to D.

Revision ID: a1c0f5e3b7d2
Revises:
Created: 2026-10-23

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401

revision = "a1c0f5e3b7d2"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    tent = op.create_table(
        "tent",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("default_grams", sa.Float(), nullable=False),
        sa.Column("default_minutes", sa.Integer(), nullable=False),
        sa.Column("default_crates", sa.Integer(), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "sulfurrun",
        sa.Column("uuid", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("tent_id", sa.Integer(), nullable=False),
        sa.Column("tent_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("grams", sa.Float(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("crates", sa.Integer(), nullable=False),
        sa.Column("block_id", sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column("block_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("variety", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), nullable=True),
        sa.Column("supplier_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("started_by", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("started_by_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("ended_by", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("ended_by_name", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("weather_temp", sa.Float(), nullable=True),
        sa.Column("weather_humidity", sa.Float(), nullable=True),
        sa.Column("device", sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column("synced_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tent_id"], ["tent.id"]),
        sa.PrimaryKeyConstraint("uuid"),
    )
    op.bulk_insert(tent, [
        {"name": f"Tent {letter}", "default_grams": 425.0, "default_minutes": 60,
         "default_crates": 24, "sort": i, "active": True}
        for i, letter in enumerate("ABCD")
    ])


def downgrade() -> None:
    op.drop_table("sulfurrun")
    op.drop_table("tent")
