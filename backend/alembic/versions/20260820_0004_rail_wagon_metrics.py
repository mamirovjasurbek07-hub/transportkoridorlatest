"""Add entry and exit wagon metrics for railway customs posts."""

from alembic import op


revision = "20260820_0004"
down_revision = "20260820_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE post_daily_metrics ADD COLUMN IF NOT EXISTS empty_wagons_entry bigint NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE post_daily_metrics ADD COLUMN IF NOT EXISTS empty_wagons_exit bigint NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE post_daily_metrics ADD COLUMN IF NOT EXISTS loaded_wagons_entry bigint NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE post_daily_metrics ADD COLUMN IF NOT EXISTS loaded_wagons_exit bigint NOT NULL DEFAULT 0")
    # Keep the old demo railway volume visible after upgrading an already
    # populated installation. Real daily data can replace these values later.
    op.execute("""
        UPDATE post_daily_metrics
        SET loaded_wagons_entry = vehicles_entry,
            loaded_wagons_exit = vehicles_exit
        WHERE post_type = 'RW'
          AND loaded_wagons_entry = 0
          AND loaded_wagons_exit = 0
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE post_daily_metrics DROP COLUMN IF EXISTS loaded_wagons_exit")
    op.execute("ALTER TABLE post_daily_metrics DROP COLUMN IF EXISTS loaded_wagons_entry")
    op.execute("ALTER TABLE post_daily_metrics DROP COLUMN IF EXISTS empty_wagons_exit")
    op.execute("ALTER TABLE post_daily_metrics DROP COLUMN IF EXISTS empty_wagons_entry")
