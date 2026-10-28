"""receiver address

Revision ID: a1d5c3e8f702
Revises: 7e3b5a9d2c14
Created: 2026-10-28 20:00:00

A receiver's two address lines, printed between its market and city.
"""
from alembic import op
import sqlalchemy as sa


revision = 'a1d5c3e8f702'
down_revision = '7e3b5a9d2c14'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('receiver', schema=None) as batch_op:
        batch_op.add_column(sa.Column('address_1', sa.String(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('address_2', sa.String(), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('receiver', schema=None) as batch_op:
        batch_op.drop_column('address_2')
        batch_op.drop_column('address_1')
