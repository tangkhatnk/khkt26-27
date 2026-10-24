ALTER TABLE "users"
  ADD COLUMN "suspended_at" TIMESTAMP(3),
  ADD COLUMN "admin_state_version" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "users_admin_state_version_nonnegative" CHECK ("admin_state_version" >= 0);

CREATE TABLE "admin_grants" (
  "user_id" UUID NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_grants_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "admin_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "admin_grants_is_active_user_id_idx" ON "admin_grants"("is_active", "user_id");

CREATE TABLE "admin_control" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_control_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_control_singleton_check" CHECK ("id" = 1)
);
INSERT INTO "admin_control" ("id") VALUES (1);

CREATE TABLE "admin_action_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "action" VARCHAR(20) NOT NULL,
  "before_is_admin" BOOLEAN NOT NULL,
  "after_is_admin" BOOLEAN NOT NULL,
  "before_suspended" BOOLEAN NOT NULL,
  "after_suspended" BOOLEAN NOT NULL,
  "before_version" INTEGER NOT NULL,
  "after_version" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_action_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_action_audits_action_check" CHECK ("action" IN ('role', 'suspension')),
  CONSTRAINT "admin_action_audits_version_check" CHECK ("before_version" >= 0 AND "after_version" = "before_version" + 1),
  CONSTRAINT "admin_action_audits_reason_check" CHECK (length(btrim("reason")) > 0)
);
CREATE INDEX "admin_action_audits_created_at_id_idx" ON "admin_action_audits"("created_at" DESC, "id" DESC);
CREATE INDEX "admin_action_audits_target_user_id_created_at_idx" ON "admin_action_audits"("target_user_id", "created_at" DESC);
CREATE INDEX "admin_action_audits_actor_user_id_created_at_idx" ON "admin_action_audits"("actor_user_id", "created_at" DESC);

CREATE FUNCTION reject_admin_action_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin action audit is append-only';
END;
$$;
CREATE TRIGGER "admin_action_audits_append_only"
  BEFORE UPDATE OR DELETE ON "admin_action_audits"
  FOR EACH ROW EXECUTE FUNCTION reject_admin_action_audit_change();
