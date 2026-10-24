import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

const migrations = [
  "20261004000000_initial",
  "20261007000000_adventure",
  "20261009000000_tester_runs",
  "20261009100000_quiz_knowledge_point",
];
const migrationSql = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), "utf8");

it("removes static quiz rows while preserving AI questions, grades, and saved trip history", async () => {
  const db = new PGlite();
  try {
    for (const migration of migrations) await db.exec(migrationSql(migration));

    await db.exec(`
      INSERT INTO users (id, email, name, updated_at) VALUES
        ('00000000-0000-4000-8000-000000000001', 'fixture@example.invalid', 'Fixture', '2026-10-10T00:00:00Z');
      INSERT INTO topics (id, name, icon) VALUES ('biology', 'Biology', 'leaf');
      INSERT INTO study_sessions (
        id, user_id, goal_text, topic_id, target_duration_seconds,
        actual_duration_seconds, quiz_score, total_quiz_questions, is_completed, updated_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000001', 'Migration fixture', 'biology',
        60, 60, 2, 2, true, '2026-10-10T00:00:00Z'
      );
      INSERT INTO quiz_bank (
        id, topic_id, owner_id, question, options, correct_index, explanation,
        knowledge_point, difficulty, source, created_at
      ) VALUES
        ('00000000-0000-4000-8000-000000000010', 'biology', NULL, 'Static fixture question',
         '["A", "B", "C", "D"]'::jsonb, 1, 'Static fixture explanation', 'Static fixture point',
         'medium', 'static', '2026-10-10T00:00:00Z'),
        ('00000000-0000-4000-8000-000000000011', 'biology', NULL, 'Unanswered static fixture',
         '["A", "B", "C", "D"]'::jsonb, 0, 'Unused static explanation', 'Unused static point',
         'medium', 'static', '2026-10-10T00:00:00Z'),
        ('00000000-0000-4000-8000-000000000012', 'biology',
         '00000000-0000-4000-8000-000000000001', 'AI fixture question',
         '["A", "B", "C", "D"]'::jsonb, 1, 'AI fixture explanation', 'AI fixture point',
         'medium', 'gemini_generated', '2026-10-10T00:00:00Z');
      INSERT INTO quiz_sessions (
        id, session_id, question_id, selected_index, is_correct, answered_at
      ) VALUES
        ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000010', 1, true, '2026-10-10T00:01:00Z'),
        ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000012', 1, true, '2026-10-10T00:02:00Z');
      UPDATE adventure_state SET state =
        '{"people":{},"groups":{},"sessions":{"saved-trip":{"id":"saved-trip","quiz":{"score":1,"total":1}}},"invites":{}}'::jsonb
        WHERE id = 1;
    `);

    const migrationUrl = new URL(
      "../prisma/migrations/20261010120000_remove_static_quiz_bank/migration.sql",
      import.meta.url,
    );
    if (existsSync(migrationUrl)) await db.exec(readFileSync(migrationUrl, "utf8"));

    const tables = (await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )).rows.map((row) => row.tablename);
    expect(tables).not.toContain("quiz_bank");
    expect(tables).toContain("ai_questions");

    const questions = await db.query<{
      id: string; source: string; owner_id: string; question: string;
    }>("SELECT id, source, owner_id, question FROM ai_questions");
    expect(questions.rows).toEqual([{
      id: "00000000-0000-4000-8000-000000000012",
      source: "gemini_generated",
      owner_id: "00000000-0000-4000-8000-000000000001",
      question: "AI fixture question",
    }]);

    const staticAnswer = await db.query<{
      session_id: string; question_id: string | null; question_snapshot: { [key: string]: unknown } | null;
      selected_index: number; is_correct: boolean; answered_at: string;
    }>(`SELECT session_id, question_id, question_snapshot, selected_index, is_correct,
         to_char(answered_at, 'YYYY-MM-DD HH24:MI:SS') AS answered_at
       FROM quiz_sessions WHERE id = '00000000-0000-4000-8000-000000000020'`);
    expect(staticAnswer.rows[0]).toMatchObject({
      session_id: "00000000-0000-4000-8000-000000000002",
      question_id: null,
      question_snapshot: {
        id: "00000000-0000-4000-8000-000000000010",
        question: "Static fixture question",
        options: ["A", "B", "C", "D"],
        correct_index: 1,
        explanation: "Static fixture explanation",
        knowledge_point: "Static fixture point",
        source: "static",
      },
      selected_index: 1,
      is_correct: true,
    });
    expect(staticAnswer.rows[0].answered_at).toBe("2026-10-10 00:01:00");

    const aiAnswer = await db.query<{ question_id: string | null; question: string }>(`
      SELECT answer.question_id, question.question
      FROM quiz_sessions answer
      JOIN ai_questions question ON question.id = answer.question_id
      WHERE answer.id = '00000000-0000-4000-8000-000000000021'
    `);
    expect(aiAnswer.rows).toEqual([{
      question_id: "00000000-0000-4000-8000-000000000012",
      question: "AI fixture question",
    }]);

    const grade = await db.query<{ quiz_score: number; total_quiz_questions: number }>(
      "SELECT quiz_score, total_quiz_questions FROM study_sessions WHERE id = '00000000-0000-4000-8000-000000000002'",
    );
    expect(grade.rows[0]).toEqual({ quiz_score: 2, total_quiz_questions: 2 });

    const trip = await db.query<{ quiz: { score: number; total: number } }>(
      "SELECT state->'sessions'->'saved-trip'->'quiz' AS quiz FROM adventure_state WHERE id = 1",
    );
    expect(trip.rows[0].quiz).toEqual({ score: 1, total: 1 });

    const relation = await db.query<{ target: string }>(`
      SELECT confrelid::regclass::text AS target
      FROM pg_constraint
      WHERE conname = 'quiz_sessions_question_id_fkey'
    `);
    expect(relation.rows).toEqual([{ target: "ai_questions" }]);
  } finally {
    await db.close();
  }
});
