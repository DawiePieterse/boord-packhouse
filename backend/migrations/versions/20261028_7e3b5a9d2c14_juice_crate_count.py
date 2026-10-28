"""juice crate count

Revision ID: 7e3b5a9d2c14
Revises: 4d8a2f6c1e93
Created: 2026-10-28 18:00:00

A crate record is a batch of crates; every one so far is one crate.
"""
from alembic import op
import sqlalchemy as sa


revision = '7e3b5a9d2c14'
down_revision = '4d8a2f6c1e93'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('juicebin', schema=None) as batch_op:
        batch_op.add_column(sa.Column('count', sa.Integer(), nullable=False, server_default='1'))


def downgrade() -> None:
    with op.batch_alter_table('juicebin', schema=None) as batch_op:
        batch_op.drop_column('count')
