"""motion patterns

Revision ID: e5a7c9d1f3b2
Revises: d8e2f1a3c6b4
Create Date: 2026-10-14 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5a7c9d1f3b2'
down_revision: Union[str, Sequence[str], None] = 'd8e2f1a3c6b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('sensor_alerts', sa.Column('code', sa.Integer(), nullable=True))
    patterns = op.create_table(
        'patterns',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=40), nullable=False),
        sa.Column('alert_n', sa.Integer(), nullable=True),
        sa.Column('alert_min', sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )
    op.create_table(
        'pattern_labels',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('pattern_id', sa.Integer(), nullable=False),
        sa.Column('horse_id', sa.Integer(), nullable=False),
        sa.Column('from_ms', sa.BigInteger(), nullable=False),
        sa.Column('to_ms', sa.BigInteger(), nullable=False),
        sa.Column('axes', sa.String(length=3), nullable=False),
        sa.ForeignKeyConstraint(['horse_id'], ['horses.id']),
        sa.ForeignKeyConstraint(['pattern_id'], ['patterns.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'motion_models',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ver', sa.Integer(), nullable=False),
        sa.Column('created', sa.Integer(), nullable=False),
        sa.Column('metrics', sa.Text(), nullable=False),
        sa.Column('blob', sa.LargeBinary(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('ver'),
    )
    # Os dois padrões que a tela Atividade já mostrava.
    op.bulk_insert(patterns, [{'id': 1, 'name': 'Pulo'}, {'id': 2, 'name': 'Volta'}])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('motion_models')
    op.drop_table('pattern_labels')
    op.drop_table('patterns')
    with op.batch_alter_table('sensor_alerts') as batch:
        batch.drop_column('code')
