"""sensor alert limits

Revision ID: d8e2f1a3c6b4
Revises: c41d7e9a5b20
Create Date: 2026-10-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e2f1a3c6b4'
down_revision: Union[str, Sequence[str], None] = 'c41d7e9a5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('horses', sa.Column('alert_bpm_min', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('alert_bpm_max', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('alert_temp_min', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('alert_temp_max', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('alert_mov_max', sa.Float(), nullable=True))
    op.add_column(
        'horses',
        sa.Column('alert_ver', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_table(
        'sensor_alerts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('horse_id', sa.Integer(), nullable=False),
        sa.Column('ts', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=1), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('limit', sa.Float(), nullable=False),
        sa.Column('email', sa.String(length=254), nullable=True),
        sa.Column('emailed', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['horse_id'], ['horses.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_sensor_alerts_horse_ts', 'sensor_alerts', ['horse_id', 'ts']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_sensor_alerts_horse_ts', table_name='sensor_alerts')
    op.drop_table('sensor_alerts')
    with op.batch_alter_table('horses') as batch:
        for col in (
            'alert_ver',
            'alert_mov_max',
            'alert_temp_max',
            'alert_temp_min',
            'alert_bpm_max',
            'alert_bpm_min',
        ):
            batch.drop_column(col)
