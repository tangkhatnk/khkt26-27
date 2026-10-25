CREATE TABLE "admin_session_action_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL,
  "target_owner_id" TEXT NOT NULL,
  "session_id" UUID NOT NULL,
  "action" VARCHAR(20) NOT NULL,
  "before_version" INTEGER NOT NULL,
  "after_version" INTEGER NOT NULL,
  "before_state" JSONB NOT NULL,
  "after_state" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_session_action_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_session_action_audits_action_check"
    CHECK ("action" IN ('correction', 'removal')),
  CONSTRAINT "admin_session_action_audits_version_check"
    CHECK ("before_version" >= 0 AND "after_version" = "before_version" + 1),
  CONSTRAINT "admin_session_action_audits_reason_check"
    CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "admin_session_action_audits_owner_check"
    CHECK (length("target_owner_id") BETWEEN 1 AND 100)
);

CREATE INDEX "admin_session_action_audits_session_created_idx"
  ON "admin_session_action_audits"("session_id", "created_at" DESC, "id" DESC);
CREATE INDEX "admin_session_action_audits_owner_created_idx"
  ON "admin_session_action_audits"("target_owner_id", "created_at" DESC);
CREATE INDEX "admin_session_action_audits_actor_created_idx"
  ON "admin_session_action_audits"("actor_user_id", "created_at" DESC);

CREATE FUNCTION reject_admin_session_action_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin session action audit is append-only';
END;
$$;
CREATE TRIGGER "admin_session_action_audits_append_only"
  BEFORE UPDATE OR DELETE ON "admin_session_action_audits"
  FOR EACH ROW EXECUTE FUNCTION reject_admin_session_action_audit_change();
