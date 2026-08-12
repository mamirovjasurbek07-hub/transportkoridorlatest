"""Add customs post vehicle permissions."""

from alembic import op

revision = "20260812_0002"
down_revision = "20260811_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The initial migration uses metadata.create_all, so IF NOT EXISTS keeps
    # both an existing production database and a brand-new database safe.
    op.execute("ALTER TABLE customs_posts ADD COLUMN IF NOT EXISTS allow_passenger_vehicles boolean NOT NULL DEFAULT true")
    op.execute("ALTER TABLE customs_posts ADD COLUMN IF NOT EXISTS allow_cargo_vehicles boolean NOT NULL DEFAULT true")


def downgrade() -> None:
    op.execute("ALTER TABLE customs_posts DROP COLUMN IF EXISTS allow_cargo_vehicles")
    op.execute("ALTER TABLE customs_posts DROP COLUMN IF EXISTS allow_passenger_vehicles")
