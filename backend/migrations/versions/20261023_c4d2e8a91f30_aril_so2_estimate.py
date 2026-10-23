"""Aril SO2 estimate against the EU limit: anchor, limit and warning level on
Settings -> Sulfur, and the estimate shown on each run.

Revision ID: c4d2e8a91f30
Revises: 8eea5bf1e094
Created: 2026-10-23

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401

revision = "c4d2e8a91f30"
down_revision = "8eea5bf1e094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default: SQLite cannot add a NOT NULL column to a table that has
    # rows without one, and the seeded settings row is there.
    with op.batch_alter_table("sulfursettings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("residue_ref_ppm", sa.Float(), nullable=False, server_default="5.0"))
        batch_op.add_column(sa.Column("residue_calibrated", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("residue_limit_ppm", sa.Float(), nullable=False, server_default="10.0"))
        batch_op.add_column(sa.Column("residue_warn_ppm", sa.Float(), nullable=False, server_default="8.0"))
    with op.batch_alter_table("sulfurrun", schema=None) as batch_op:
        batch_op.add_column(sa.Column("estimated_ppm", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("sulfurrun", schema=None) as batch_op:
        batch_op.drop_column("estimated_ppm")
    with op.batch_alter_table("sulfursettings", schema=None) as batch_op:
        batch_op.drop_column("residue_warn_ppm")
        batch_op.drop_column("residue_limit_ppm")
        batch_op.drop_column("residue_calibrated")
        batch_op.drop_column("residue_ref_ppm")
