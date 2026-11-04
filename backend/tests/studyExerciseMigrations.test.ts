import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const database = new PGlite();

afterEach(async () => {
  await database.close();
});

describe("typed study exercise count migration", () => {
  it("accepts old scalar rows and constrains exact typed compositions", async () => {
    const migration = await readFile(new URL(
      "../prisma/migrations/20261030120000_typed_study_exercise_counts/migration.sql",
      import.meta.url,
    ), "utf8");
    await database.exec("CREATE TABLE study_exercise_sets (requested_count INTEGER);");
    await database.exec(migration);

    await database.query("INSERT INTO study_exercise_sets (requested_count, requested_counts) VALUES (3, NULL)");
    await database.query("INSERT INTO study_exercise_sets (requested_counts) VALUES ($1::jsonb)", [JSON.stringify({
      multipleChoice: 1, trueFalse: 0, shortAnswer: 0, essay: 0,
    })]);
    await database.query("INSERT INTO study_exercise_sets (requested_counts) VALUES ($1::jsonb)", [JSON.stringify({
      multipleChoice: 5, trueFalse: 5, shortAnswer: 5, essay: 5,
    })]);

    await expect(database.query("INSERT INTO study_exercise_sets (requested_counts) VALUES ($1::jsonb)", [JSON.stringify({
      multipleChoice: 0, trueFalse: 0, shortAnswer: 0, essay: 0,
    })])).rejects.toThrow();
    await expect(database.query("INSERT INTO study_exercise_sets (requested_counts) VALUES ($1::jsonb)", [JSON.stringify({
      multipleChoice: 6, trueFalse: 0, shortAnswer: 0, essay: 0,
    })])).rejects.toThrow();
    await expect(database.query("INSERT INTO study_exercise_sets (requested_counts) VALUES ($1::jsonb)", [JSON.stringify({
      multipleChoice: 1, trueFalse: 0, shortAnswer: 0, essay: 0, other: 0,
    })])).rejects.toThrow();
    for (const key of ["multipleChoice", "trueFalse", "shortAnswer", "essay"] as const) {
      for (const invalidValue of [null, "1"] as const) {
        await expect(database.query("INSERT INTO study_exercise_sets (requested_counts) VALUES ($1::jsonb)", [JSON.stringify({
          multipleChoice: 1,
          trueFalse: 0,
          shortAnswer: 0,
          essay: 0,
          [key]: invalidValue,
        })])).rejects.toThrow();
      }
    }

    const result = await database.query("SELECT requested_count, requested_counts FROM study_exercise_sets ORDER BY requested_count NULLS LAST");
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ requested_count: 3, requested_counts: null });
    expect((result.rows[2]?.requested_counts as { essay: number }).essay).toBe(5);
  });
});
