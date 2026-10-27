"""target receiver list

Revision ID: 6b2e8d41c7f3
Revises: 3f1c9a7e5b20
Created: 2026-10-27 15:00:00

Settings' two target-receiver boxes (USA and EU) become a list an export note
picks from. What the boxes held carries over as the list's first entries:
the first line the name, the rest the address.
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision = '6b2e8d41c7f3'
down_revision = '3f1c9a7e5b20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    target = op.create_table(
        'targetreceiver',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('address', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
        sa.Column('market', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='USA'),
        sa.Column('sort', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('deliverynote', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target_receiver_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('target_receiver', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))

    row = op.get_bind().execute(sa.text("SELECT target_receiver, eu_target_receiver FROM deliverynotesettings WHERE id = 1")).first()
    rows = []
    for market, text in zip(("USA", "EU"), row or ()):
        lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
        if lines:
            rows.append({"name": lines[0], "address": ", ".join(lines[1:]), "market": market, "sort": len(rows), "active": True})
    if rows:
        op.bulk_insert(target, rows)

    with op.batch_alter_table('deliverynotesettings', schema=None) as batch_op:
        batch_op.drop_column('eu_target_receiver')
        batch_op.drop_column('target_receiver')


def downgrade() -> None:
    with op.batch_alter_table('deliverynotesettings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('target_receiver', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('eu_target_receiver', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
    with op.batch_alter_table('deliverynote', schema=None) as batch_op:
        batch_op.drop_column('target_receiver')
        batch_op.drop_column('target_receiver_id')
    op.drop_table('targetreceiver')
