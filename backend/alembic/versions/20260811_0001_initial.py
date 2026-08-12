"""Initial PostGIS schema."""
from alembic import op

from app.database import Base
from app.models import *  # noqa: F401,F403

revision = "20260811_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions")
    op.execute("SET search_path TO public, extensions")
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
