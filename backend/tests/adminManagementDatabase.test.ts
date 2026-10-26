import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

async function migrate(db: PGlite) {
  const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
  const migrations = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of migrations)
    await db.exec(await readFile(new URL(`${name}/migration.sql`, migrationDirectory), "utf8"));
}

describe("admin account management migration", () => {
  it("adds versioned suspension, deletion, and persistent grant state plus the singleton lock row", async () => {
    const db = new PGlite();
    try {
      await migrate(db);
      const columns = await db.query<{ column_name: string; column_default: string | null; is_nullable: string }>(`
        SELECT column_name, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN ('suspended_at', 'admin_state_version', 'deleted_at')
        ORDER BY column_name`);
      expect(columns.rows).toEqual([
        { column_name: "admin_state_version", column_default: "0", is_nullable: "NO" },
        { column_name: "deleted_at", column_default: null, is_nullable: "YES" },
        { column_name: "suspended_at", column_default: null, is_nullable: "YES" },
      ]);
      const grants = await db.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_grants'`);
      expect(grants.rows.map((row) => row.column_name).sort()).toEqual(["created_at", "is_active", "updated_at", "user_id"]);
      const control = await db.query<{ id: number }>("SELECT id FROM admin_control");
      expect(control.rows).toEqual([{ id: 1 }]);

      const userId = randomUUID();
      await db.query("INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, 'Synthetic grant fixture', CURRENT_TIMESTAMP)", [userId, `${userId}@example.test`]);
      await db.query("INSERT INTO admin_grants (user_id) VALUES ($1)", [userId]);
      await expect(db.query("INSERT INTO admin_grants (user_id) VALUES ($1)", [userId])).rejects.toThrow();
      await expect(db.query("INSERT INTO admin_grants (user_id) VALUES ($1)", [randomUUID()])).rejects.toThrow();
      await expect(db.query("INSERT INTO admin_control (id) VALUES (2)")).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("creates the separate owner/session public summary store without source metadata", async () => {
    const db = new PGlite();
    try {
      await migrate(db);
      const columns = await db.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'public_material_summary_shares' ORDER BY column_name`);
      expect(columns.rows).toEqual([
        { column_name: "approved_at", data_type: "timestamp without time zone" },
        { column_name: "session_id", data_type: "text" },
        { column_name: "summary", data_type: "character varying" },
        { column_name: "updated_at", data_type: "timestamp without time zone" },
        { column_name: "user_id", data_type: "uuid" },
        { column_name: "version", data_type: "integer" },
      ]);
      const keys = await db.query<{ column_name: string }>(`
        SELECT a.attname AS column_name FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'public_material_summary_shares'::regclass AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)`);
      expect(keys.rows.map((row) => row.column_name)).toEqual(["user_id", "session_id"]);
      expect(columns.rows.map((row) => row.column_name)).not.toContain("source_id");
      expect(columns.rows.map((row) => row.column_name)).not.toContain("source_text");
    } finally {
      await db.close();
    }
  });

  it("stores only narrow append-only action history", async () => {
    const db = new PGlite();
    try {
      await migrate(db);
      const columns = await db.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'admin_action_audits'`);
      expect(columns.rows.map((row) => row.column_name).sort()).toEqual([
        "action", "actor_user_id", "after_deleted", "after_is_admin", "after_name", "after_suspended", "after_version",
        "before_deleted", "before_is_admin", "before_name", "before_suspended", "before_version", "created_at", "id", "reason", "target_user_id",
      ]);

      const actor = randomUUID();
      const target = randomUUID();
      const [row] = (await db.query<{ id: string }>(`
        INSERT INTO admin_action_audits
          (actor_user_id, target_user_id, action, before_is_admin, after_is_admin,
           before_suspended, after_suspended, before_version, after_version, reason,
           before_deleted, after_deleted)
        VALUES ($1, $2, 'role', false, true, false, false, 0, 1, 'Synthetic access review', false, false)
        RETURNING id`, [actor, target])).rows;
      await db.query(`
        INSERT INTO admin_action_audits
          (actor_user_id, target_user_id, action, before_is_admin, after_is_admin,
           before_suspended, after_suspended, before_version, after_version, reason,
           before_deleted, after_deleted, before_name, after_name)
        VALUES ($1, $2, 'profile', false, false, false, false, 0, 1,
          'Synthetic profile review', false, false, 'Old fixture name', 'New fixture name')`, [actor, target]);
      const [deletion] = (await db.query<{ id: string }>(`
        INSERT INTO admin_action_audits
          (actor_user_id, target_user_id, action, before_is_admin, after_is_admin,
           before_suspended, after_suspended, before_version, after_version, reason,
           before_deleted, after_deleted)
        VALUES ($1, $2, 'deletion', true, false, false, false, 0, 1,
          'Synthetic deletion review', false, true)
        RETURNING id`, [actor, target])).rows;
      await expect(db.query(`
        INSERT INTO admin_action_audits
          (actor_user_id, target_user_id, action, before_is_admin, after_is_admin,
           before_suspended, after_suspended, before_version, after_version, reason,
           before_deleted, after_deleted)
        VALUES ($1, $2, 'profile', false, false, false, false, 0, 1,
          'Missing profile history', false, false)`, [actor, target])).rejects.toThrow();
      await expect(db.query("UPDATE admin_action_audits SET reason = 'rewritten' WHERE id = $1", [row.id])).rejects.toThrow();
      await expect(db.query("DELETE FROM admin_action_audits WHERE id = $1", [row.id])).rejects.toThrow();
      await expect(db.query("UPDATE admin_action_audits SET reason = 'rewritten' WHERE id = $1", [deletion.id])).rejects.toThrow();
      const retained = await db.query<{ reason: string }>("SELECT reason FROM admin_action_audits WHERE id = $1", [row.id]);
      expect(retained.rows).toEqual([{ reason: "Synthetic access review" }]);
    } finally {
      await db.close();
    }
  });
});
