"""Sulfur runs: batch number, fruit size and a second source; Settings -> Sulfur's
list of sizes.

Revision ID: b7e41d0a92c5
Revises: 8af83656906c
Created: 2026-10-26

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401

revision = "b7e41d0a92c5"
down_revision = "8af83656906c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sulfurrun", schema=None) as batch_op:
        batch_op.add_column(sa.Column("batch_no", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("size", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("more_sources", sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=""))
    with op.batch_alter_table("sulfursettings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("sizes", sqlmodel.sql.sqltypes.AutoString(), nullable=False,
                                      server_default='["L", "XL", "XXL", "Mixed"]'))


def downgrade() -> None:
    with op.batch_alter_table("sulfursettings", schema=None) as batch_op:
        batch_op.drop_column("sizes")
    with op.batch_alter_table("sulfurrun", schema=None) as batch_op:
        batch_op.drop_column("more_sources")
        batch_op.drop_column("size")
        batch_op.drop_column("batch_no")
