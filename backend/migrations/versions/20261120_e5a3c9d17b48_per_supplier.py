"""notes and juice bins per supplier

Revision ID: e5a3c9d17b48
Revises: b7e2c4a91f05
Created: 2026-11-20 12:00:00

Pallet Stack, Delivery Note and Juice work one supplier at a time (v0.73). A
pallet already had its supplier; a delivery note and a juice bin get theirs,
and a note its copy of the supplier's details as printed. Rows from before
have no supplier here: which one is the farm's own is in Boord's database, so
main.py fills them in at startup rather than this migration.
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision = 'e5a3c9d17b48'
down_revision = 'b7e2c4a91f05'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('deliverynote') as batch_op:
        batch_op.add_column(sa.Column('supplier_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('supplier', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='{}'))
    with op.batch_alter_table('juicebin') as batch_op:
        batch_op.add_column(sa.Column('supplier_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('supplier_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('juicebin') as batch_op:
        batch_op.drop_column('supplier_name')
        batch_op.drop_column('supplier_id')
    with op.batch_alter_table('deliverynote') as batch_op:
        batch_op.drop_column('supplier')
        batch_op.drop_column('supplier_id')
