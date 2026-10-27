"""usa and eu target receivers

Revision ID: 3f1c9a7e5b20
Revises: 8586b02a2c87
Created: 2026-10-27 09:00:00

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision = '3f1c9a7e5b20'
down_revision = '8586b02a2c87'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('deliverynotesettings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target_receiver', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('eu_target_receiver', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))


def downgrade() -> None:
    with op.batch_alter_table('deliverynotesettings', schema=None) as batch_op:
        batch_op.drop_column('eu_target_receiver')
        batch_op.drop_column('target_receiver')
