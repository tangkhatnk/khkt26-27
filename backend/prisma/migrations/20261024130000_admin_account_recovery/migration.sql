ALTER TABLE "users"
  ADD COLUMN "deleted_at" TIMESTAMP(3);

ALTER TABLE "admin_action_audits"
  ADD COLUMN "before_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "after_deleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "before_name" VARCHAR(100),
  ADD COLUMN "after_name" VARCHAR(100);

ALTER TABLE "admin_action_audits"
  DROP CONSTRAINT "admin_action_audits_action_check",
  ADD CONSTRAINT "admin_action_audits_action_check"
    CHECK ("action" IN ('role', 'suspension', 'profile', 'deletion')),
  ADD CONSTRAINT "admin_action_audits_profile_name_check"
    CHECK (
      ("action" = 'profile' AND "before_name" IS NOT NULL AND "after_name" IS NOT NULL
        AND "before_name" <> "after_name")
      OR ("action" <> 'profile' AND "before_name" IS NULL AND "after_name" IS NULL)
    ),
  ADD CONSTRAINT "admin_action_audits_deletion_transition_check"
    CHECK ("action" <> 'deletion' OR "before_deleted" <> "after_deleted"),
  ADD CONSTRAINT "admin_action_audits_non_deletion_state_check"
    CHECK ("action" = 'deletion' OR "before_deleted" = "after_deleted");
