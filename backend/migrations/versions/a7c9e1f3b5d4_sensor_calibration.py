"""sensor calibration

Revision ID: a7c9e1f3b5d4
Revises: f6b8d0e2a4c3
Create Date: 2026-10-15 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c9e1f3b5d4'
down_revision: Union[str, Sequence[str], None] = 'f6b8d0e2a4c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('horses', sa.Column('sensor_bpm_offset', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('sensor_mov_gain', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('horses') as batch:
        batch.drop_column('sensor_mov_gain')
        batch.drop_column('sensor_bpm_offset')
