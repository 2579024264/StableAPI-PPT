"""default icon subject extraction off

Revision ID: 019_icon_subject_default_off
Revises: 018_add_project_title
Create Date: 2026-07-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '019_icon_subject_default_off'
down_revision = '018_add_project_title'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE projects SET enable_icon_subject_extraction = false "
        "WHERE enable_icon_subject_extraction IS NULL"
    )
    with op.batch_alter_table('projects') as batch_op:
        batch_op.alter_column(
            'enable_icon_subject_extraction',
            existing_type=sa.Boolean(),
            existing_nullable=True,
            server_default=sa.false(),
        )


def downgrade() -> None:
    with op.batch_alter_table('projects') as batch_op:
        batch_op.alter_column(
            'enable_icon_subject_extraction',
            existing_type=sa.Boolean(),
            existing_nullable=True,
            server_default=sa.true(),
        )
