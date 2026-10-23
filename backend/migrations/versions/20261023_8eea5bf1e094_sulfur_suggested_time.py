"""Sulfur suggested time: Settings -> Sulfur (one seeded row) and what went
into each run's suggestion.

Revision ID: 8eea5bf1e094
Revises: a1c0f5e3b7d2
Created: 2026-10-23

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401 - autogenerate renders sqlmodel.sql.sqltypes.AutoString


revision = '8eea5bf1e094'
down_revision = 'a1c0f5e3b7d2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    settings = op.create_table('sulfursettings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('ref_grams', sa.Float(), nullable=False),
    sa.Column('ref_crates', sa.Integer(), nullable=False),
    sa.Column('ref_crate_kg', sa.Float(), nullable=False),
    sa.Column('ref_temp', sa.Float(), nullable=False),
    sa.Column('ref_humidity', sa.Float(), nullable=False),
    sa.Column('temp_pct_per_deg', sa.Float(), nullable=False),
    sa.Column('humidity_pct_per_pct', sa.Float(), nullable=False),
    sa.Column('min_minutes', sa.Integer(), nullable=False),
    sa.Column('max_minutes', sa.Integer(), nullable=False),
    sa.Column('round_to', sa.Integer(), nullable=False),
    sa.Column('variety_factors', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('sulfurrun', schema=None) as batch_op:
        batch_op.add_column(sa.Column('suggested_minutes', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('fruit_kg', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('suggestion_temp', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('suggestion_humidity', sa.Float(), nullable=True))

    # The starting numbers (see models.SulfurSettings), tuned later in Settings.
    op.bulk_insert(settings, [{
        "id": 1, "ref_grams": 425.0, "ref_crates": 24, "ref_crate_kg": 20.0,
        "ref_temp": 25.0, "ref_humidity": 60.0, "temp_pct_per_deg": 2.0,
        "humidity_pct_per_pct": 0.5, "min_minutes": 30, "max_minutes": 120, "round_to": 5,
        "variety_factors": '{"Mauritius": 1.0, "McLean\'s Red": 0.9}',
    }])


def downgrade() -> None:
    with op.batch_alter_table('sulfurrun', schema=None) as batch_op:
        batch_op.drop_column('suggestion_humidity')
        batch_op.drop_column('suggestion_temp')
        batch_op.drop_column('fruit_kg')
        batch_op.drop_column('suggested_minutes')

    op.drop_table('sulfursettings')
