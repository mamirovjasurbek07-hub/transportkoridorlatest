"""Performance, jobs, imports, saved filters and account security.

Revision ID: 20260923_0006
Revises: 20260821_0005
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260923_0006"
down_revision = "20260821_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True), if_not_exists=True)
    op.add_column("users", sa.Column("totp_secret", sa.String(length=80), nullable=True), if_not_exists=True)
    op.add_column("users", sa.Column("totp_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False), if_not_exists=True)

    op.create_table(
        "background_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="PENDING", nullable=False),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("total", sa.Integer(), server_default="0", nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("cancel_requested", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        if_not_exists=True,
    )
    op.create_index("ix_background_jobs_status_created", "background_jobs", ["status", "created_at"], if_not_exists=True)
    op.create_index("ix_background_jobs_kind_created", "background_jobs", ["kind", "created_at"], if_not_exists=True)

    op.create_table(
        "data_imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("import_type", sa.String(length=40), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("rows_total", sa.Integer(), nullable=False),
        sa.Column("rows_imported", sa.Integer(), nullable=False),
        sa.Column("rows_rejected", sa.Integer(), nullable=False),
        sa.Column("errors", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        if_not_exists=True,
    )
    op.create_index("ix_data_imports_created_status", "data_imports", ["created_at", "status"], if_not_exists=True)

    op.create_table(
        "saved_filters",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("filters", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_shared", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_saved_filter_user_name"),
        if_not_exists=True,
    )
    op.create_index("ix_saved_filters_user_id", "saved_filters", ["user_id"], if_not_exists=True)

    op.create_table(
        "alert_acknowledgements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alert_key", sa.String(length=160), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "alert_key", name="uq_alert_ack_user_key"),
        if_not_exists=True,
    )
    op.create_index("ix_alert_acknowledgements_user_id", "alert_acknowledgements", ["user_id"], if_not_exists=True)
    op.create_index("ix_alert_acknowledgements_alert_key", "alert_acknowledgements", ["alert_key"], if_not_exists=True)

    op.create_index("ix_corridors_active_priority_name", "corridors", ["is_active", "priority", "name"], if_not_exists=True)
    op.create_index("ix_corridors_geometry_source", "corridors", ["geometry_source"], if_not_exists=True)
    op.create_index("ix_posts_active_deleted_code", "customs_posts", ["is_active", "deleted_at", "post_code"], if_not_exists=True)
    op.create_index("ix_declarations_full_filter", "transit_declarations", ["origin_country_code", "destination_country_code", "entry_post_code", "exit_post_code", "declaration_date"], if_not_exists=True)
    op.create_index("ix_audit_action_created", "audit_logs", ["action", "created_at"], if_not_exists=True)
    op.create_index("ix_audit_ip_created", "audit_logs", ["ip_address", "created_at"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_audit_ip_created", table_name="audit_logs")
    op.drop_index("ix_audit_action_created", table_name="audit_logs")
    op.drop_index("ix_declarations_full_filter", table_name="transit_declarations")
    op.drop_index("ix_posts_active_deleted_code", table_name="customs_posts")
    op.drop_index("ix_corridors_geometry_source", table_name="corridors")
    op.drop_index("ix_corridors_active_priority_name", table_name="corridors")
    op.drop_table("alert_acknowledgements")
    op.drop_table("saved_filters")
    op.drop_table("data_imports")
    op.drop_table("background_jobs")
    op.drop_column("users", "totp_enabled")
    op.drop_column("users", "totp_secret")
    op.drop_column("users", "password_changed_at")
