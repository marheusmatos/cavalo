"""horse traits and dimensions

Revision ID: c41d7e9a5b20
Revises: 7b4086ca7457
Create Date: 2026-10-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c41d7e9a5b20'
down_revision: Union[str, Sequence[str], None] = '7b4086ca7457'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('horses', sa.Column('sex', sa.String(length=1), nullable=True))
    op.add_column('horses', sa.Column('birth_date', sa.Date(), nullable=True))
    op.add_column('horses', sa.Column('coat', sa.String(length=50), nullable=True))
    op.add_column('horses', sa.Column('notes', sa.String(length=500), nullable=True))
    op.add_column('horses', sa.Column('height_cm', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('girth_cm', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('length_cm', sa.Float(), nullable=True))
    op.add_column('horses', sa.Column('cannon_cm', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('horses', 'cannon_cm')
    op.drop_column('horses', 'length_cm')
    op.drop_column('horses', 'girth_cm')
    op.drop_column('horses', 'height_cm')
    op.drop_column('horses', 'notes')
    op.drop_column('horses', 'coat')
    op.drop_column('horses', 'birth_date')
    op.drop_column('horses', 'sex')
