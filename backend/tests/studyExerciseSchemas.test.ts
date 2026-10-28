import { describe, expect, it } from "vitest";
import {
  parseGroundedStudyExercises,
  studyExercisePreparationRequestSchema,
  studyExercisePreparationResponseSchema,
  studyExerciseQuestionSchema,
} from "../src/studyExerciseSchemas.js";

describe("study exercise contracts", () => {
  it("preserves an exact learner-provided problem with numbered parts", () => {
    const text = "  1. Giải x + 2 = 5.\n2. Viết đoạn mã Python để kiểm tra nghiệm.  ";
    const input = studyExercisePreparationRequestSchema.parse({
      requestId: "00000000-0000-4000-8000-000000000101",
      plannedSessionId: "00000000-0000-4000-8000-000000000001",
      mode: "provided",
      text,
    });

    expect(input.text).toBe(text);
    expect(input.mode).toBe("provided");
  });

  it("defaults generated exercises to three and accepts counts from one through five", () => {
    const plannedSessionId = "00000000-0000-4000-8000-000000000002";
    const base = {
      requestId: "00000000-0000-4000-8000-000000000102",
      plannedSessionId,
      mode: "generated",
      text: "A source text with enough content.",
    };

    expect(studyExercisePreparationRequestSchema.parse(base).count).toBe(3);
    expect(studyExercisePreparationRequestSchema.parse({ ...base, count: 1 }).count).toBe(1);
    expect(studyExercisePreparationRequestSchema.parse({ ...base, count: 5 }).count).toBe(5);
    expect(studyExercisePreparationRequestSchema.safeParse({ ...base, count: 0 }).success).toBe(false);
    expect(studyExercisePreparationRequestSchema.safeParse({ ...base, count: 6 }).success).toBe(false);
  });

  it("accepts exactly 20,000 JavaScript characters and rejects longer source text", () => {
    const base = {
      requestId: "00000000-0000-4000-8000-000000000103",
      plannedSessionId: "00000000-0000-4000-8000-000000000003",
      mode: "generated",
      count: 1,
    } as const;

    expect(studyExercisePreparationRequestSchema.safeParse({ ...base, text: "漢".repeat(20_000) }).success).toBe(true);
    expect(studyExercisePreparationRequestSchema.safeParse({ ...base, text: "漢".repeat(20_001) }).success).toBe(false);
  });

  it("keeps generated exercises open-ended while permitting optional choices", () => {
    expect(studyExerciseQuestionSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000004",
      prompt: "Explain how a stack changes after a push followed by a pop.",
    }).success).toBe(true);
    expect(studyExerciseQuestionSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000005",
      prompt: "Which operation removes the last item from a stack?",
      choices: ["push", "pop", "peek"],
    }).success).toBe(true);
  });

  it("rejects answer, key, hint, and explanation fields from the question contract", () => {
    const question = {
      id: "00000000-0000-4000-8000-000000000006",
      prompt: "Explain the result of this operation.",
    };

    for (const secretField of ["answer", "key", "hint", "explanation"]) {
      expect(studyExerciseQuestionSchema.safeParse({ ...question, [secretField]: "secret" }).success)
        .toBe(false);
    }
  });

  it("returns a generated-only source hash without allowing private answer or source fields", () => {
    const generated = {
      id: "00000000-0000-4000-8000-000000000007",
      plannedSessionId: "00000000-0000-4000-8000-000000000008",
      mode: "generated",
      sourceFingerprint: "a".repeat(64),
      exercises: [{ id: "00000000-0000-4000-8000-000000000009", prompt: "Explain the source rule." }],
    };
    expect(studyExercisePreparationResponseSchema.safeParse(generated).success).toBe(true);
    expect(studyExercisePreparationResponseSchema.safeParse({ ...generated, sourceFingerprint: "not-a-hash" }).success).toBe(false);
    expect(studyExercisePreparationResponseSchema.safeParse({ ...generated, sourceText: "private source" }).success).toBe(false);
    expect(studyExercisePreparationResponseSchema.safeParse({ ...generated, solution: "secret" }).success).toBe(false);
    const provided = {
      id: generated.id,
      plannedSessionId: generated.plannedSessionId,
      mode: "provided",
      exercises: generated.exercises,
    };
    expect(studyExercisePreparationResponseSchema.safeParse(provided).success).toBe(true);
    expect(studyExercisePreparationResponseSchema.safeParse({ ...provided, sourceFingerprint: generated.sourceFingerprint }).success).toBe(false);
  });

  it("accepts evidence copied from the source and rejects evidence outside the source", () => {
    const source = "A stack follows last-in, first-out (LIFO) order.";
    const grounded = {
      exercises: [{
        prompt: "Explain why a stack follows last-in, first-out order after a push and pop.",
        evidenceExcerpt: "A stack follows last-in, first-out (LIFO) order.",
      }],
    };

    expect(parseGroundedStudyExercises(grounded, source, 1)).toHaveLength(1);
    expect(() => parseGroundedStudyExercises({
      exercises: [{ ...grounded.exercises[0], evidenceExcerpt: "A queue is first-in, first-out." }],
    }, source, 1)).toThrow();
    expect(() => parseGroundedStudyExercises({
      exercises: [{ ...grounded.exercises[0], evidenceExcerpt: " A stack follows last-in, first-out (LIFO) order. " }],
    }, source, 1)).toThrow();
    expect(() => parseGroundedStudyExercises({
      exercises: [{
        prompt: "Describe how a red-black tree rotates during insertion.",
        choices: ["Use the stack's last-in, first-out rule.", "Remove the newest item first."],
        evidenceExcerpt: "A stack follows last-in, first-out (LIFO) order.",
      }],
    }, source, 1)).toThrow();
  });
});
