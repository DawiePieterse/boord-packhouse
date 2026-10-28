"""juice bins

Revision ID: 9c4e1b7a2d60
Revises: 6b2e8d41c7f3
Created: 2026-10-28 10:00:00

Juice bins, weighed empty and full on a phone, and a delivery note's bins.
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision = '9c4e1b7a2d60'
down_revision = '6b2e8d41c7f3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'juicebin',
        sa.Column('uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('bin_no', sa.Integer(), nullable=False),
        sa.Column('weighed_at', sa.DateTime(), nullable=False),
        sa.Column('empty_kg', sa.Float(), nullable=True),
        sa.Column('full_kg', sa.Float(), nullable=True),
        sa.Column('made_by', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('made_by_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('changed_by', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('changed_by_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('removed', sa.Boolean(), nullable=False),
        sa.Column('bin_year', sa.Integer(), nullable=True),
        sa.Column('device', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('synced_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('uuid'),
    )
    with op.batch_alter_table('deliverynote', schema=None) as batch_op:
        batch_op.add_column(sa.Column('bins', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='[]'))


def downgrade() -> None:
    with op.batch_alter_table('deliverynote', schema=None) as batch_op:
        batch_op.drop_column('bins')
    op.drop_table('juicebin')
