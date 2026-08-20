"""Add official post categories and daily post metrics."""

from alembic import op


revision = "20260820_0003"
down_revision = "20260812_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE customs_posts ADD COLUMN IF NOT EXISTS post_category varchar(30) NOT NULL DEFAULT 'UNASSIGNED'")
    op.execute("ALTER TABLE customs_posts ALTER COLUMN post_category SET DEFAULT 'UNASSIGNED'")
    op.execute("CREATE INDEX IF NOT EXISTS ix_customs_posts_post_category ON customs_posts (post_category)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS post_daily_metrics (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            post_code varchar(10) NOT NULL REFERENCES customs_posts(post_code) ON DELETE CASCADE,
            post_type varchar(10) NOT NULL,
            metric_date date NOT NULL,
            vehicles_entry bigint NOT NULL DEFAULT 0,
            vehicles_exit bigint NOT NULL DEFAULT 0,
            citizens_entry bigint NOT NULL DEFAULT 0,
            citizens_exit bigint NOT NULL DEFAULT 0,
            customs_inspections bigint NOT NULL DEFAULT 0,
            personal_inspections bigint NOT NULL DEFAULT 0,
            administrative_offenses bigint NOT NULL DEFAULT 0,
            criminal_cases bigint NOT NULL DEFAULT 0,
            narcotics_kg double precision NOT NULL DEFAULT 0,
            customs_payments double precision NOT NULL DEFAULT 0,
            cases_count bigint NOT NULL DEFAULT 0,
            additional_customs_payments double precision NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_post_daily_metric UNIQUE (post_code, metric_date)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_daily_metrics_post_code ON post_daily_metrics (post_code)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_daily_metrics_metric_date ON post_daily_metrics (metric_date)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_daily_metrics_post_type ON post_daily_metrics (post_type)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_post_daily_metrics_date_type ON post_daily_metrics (metric_date, post_type)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS post_daily_metrics")
    op.execute("DROP INDEX IF EXISTS ix_customs_posts_post_category")
    op.execute("ALTER TABLE customs_posts DROP COLUMN IF EXISTS post_category")
