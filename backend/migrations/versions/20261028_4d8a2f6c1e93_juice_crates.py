"""juice crates

Revision ID: 4d8a2f6c1e93
Revises: 9c4e1b7a2d60
Created: 2026-10-28 14:00:00

A juice container is a bin or a crate; every one so far is a bin.
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision = '4d8a2f6c1e93'
down_revision = '9c4e1b7a2d60'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('juicebin', schema=None) as batch_op:
        batch_op.add_column(sa.Column('container', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='bin'))


def downgrade() -> None:
    with op.batch_alter_table('juicebin', schema=None) as batch_op:
        batch_op.drop_column('container')
