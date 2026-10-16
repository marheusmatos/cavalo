"""sensor settings

Revision ID: f6b8d0e2a4c3
Revises: e5a7c9d1f3b2
Create Date: 2026-10-15 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6b8d0e2a4c3'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9d1f3b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ('sensor_accel_hz', sa.Integer()),
    ('sensor_upload_s', sa.Integer()),
    ('sensor_temp_s', sa.Integer()),
    ('sensor_temp_offset', sa.Float()),
    ('sensor_rot', sa.String(length=200)),
    ('sensor_rot_at', sa.Integer()),
    ('sensor_rot_ver', sa.Integer()),
    ('sensor_sent_at', sa.Integer()),
    ('sensor_sent_ver', sa.Integer()),
)


def upgrade() -> None:
    """Upgrade schema."""
    for name, kind in COLUMNS:
        op.add_column('horses', sa.Column(name, kind, nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('horses') as batch:
        for name, _ in reversed(COLUMNS):
            batch.drop_column(name)
