"""training level

Revision ID: b8d0f2a4c6e5
Revises: a7c9e1f3b5d4
Create Date: 2026-10-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d0f2a4c6e5'
down_revision: Union[str, Sequence[str], None] = 'a7c9e1f3b5d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('horses', sa.Column('training_level', sa.String(length=6), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('horses') as batch:
        batch.drop_column('training_level')
