"""supplier and market per pallet, block per line

A stack only groups pallets now: the supplier and market move from the stack
onto each pallet (copied over), and the block from the pallet into its lines
(the JSON, so no column; a pallet's old block is dropped: unreleased, dev only).

Revision ID: 6ce020558967
Revises: cd9acad6841f
Created: 2026-10-26 20:37:05.584565

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 - autogenerate renders sqlmodel.sql.sqltypes.AutoString


revision = '6ce020558967'
down_revision = 'cd9acad6841f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('pallet', schema=None) as batch_op:
        batch_op.add_column(sa.Column('supplier_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('supplier_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
        batch_op.add_column(sa.Column('market_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('market_name', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''))
        batch_op.drop_column('block_id')
        batch_op.drop_column('block_name')
        batch_op.drop_column('variety')

    op.execute("UPDATE pallet SET "
               + ", ".join(f"{col} = (SELECT consignment.{col} FROM consignment WHERE consignment.uuid = pallet.consignment_uuid)"
                           for col in ("supplier_id", "supplier_name", "market_id", "market_name")))

    # Rebuilding the table without the columns also drops the (unnamed) foreign key to market.
    with op.batch_alter_table('consignment', schema=None, recreate='always') as batch_op:
        batch_op.drop_column('market_name')
        batch_op.drop_column('supplier_id')
        batch_op.drop_column('market_id')
        batch_op.drop_column('supplier_name')


def downgrade() -> None:
    with op.batch_alter_table('consignment', schema=None) as batch_op:
        batch_op.add_column(sa.Column('supplier_name', sa.VARCHAR(), server_default='', nullable=False))
        batch_op.add_column(sa.Column('market_id', sa.INTEGER(), nullable=True))
        batch_op.add_column(sa.Column('supplier_id', sa.INTEGER(), nullable=True))
        batch_op.add_column(sa.Column('market_name', sa.VARCHAR(), server_default='', nullable=False))

    with op.batch_alter_table('pallet', schema=None) as batch_op:
        batch_op.add_column(sa.Column('variety', sa.VARCHAR(), server_default='', nullable=False))
        batch_op.add_column(sa.Column('block_name', sa.VARCHAR(), server_default='', nullable=False))
        batch_op.add_column(sa.Column('block_id', sa.VARCHAR(), nullable=True))
        batch_op.drop_column('market_name')
        batch_op.drop_column('market_id')
        batch_op.drop_column('supplier_name')
        batch_op.drop_column('supplier_id')
