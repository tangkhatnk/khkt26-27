CREATE TABLE "public_material_summary_shares" (
  "user_id" UUID NOT NULL,
  "session_id" TEXT NOT NULL,
  "summary" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "approved_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_material_summary_shares_pkey" PRIMARY KEY ("user_id", "session_id"),
  CONSTRAINT "public_material_summary_shares_session_id_check"
    CHECK (length("session_id") BETWEEN 1 AND 100),
  CONSTRAINT "public_material_summary_shares_version_check"
    CHECK ("version" >= 1),
  CONSTRAINT "public_material_summary_shares_approval_check"
    CHECK (("summary" IS NULL AND "approved_at" IS NULL) OR
      ("summary" IS NOT NULL AND "approved_at" IS NOT NULL AND length(btrim("summary")) > 0))
);

CREATE INDEX "public_material_summary_shares_session_id_idx"
  ON "public_material_summary_shares"("session_id");

ALTER TABLE "public_material_summary_shares"
  ADD CONSTRAINT "public_material_summary_shares_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
