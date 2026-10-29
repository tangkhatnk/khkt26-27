import { afterEach, describe, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});

import { config } from "../src/config.js";
import {
  generateStudyExerciseQuestions,
  generateStudyExerciseSolutions,
} from "../src/studyExerciseProvider.js";

const originalKey = config.GEMINI_API_KEY;
const originalModel = config.GEMINI_MODEL;
const originalFallback = config.GEMINI_FALLBACK_MODEL;

function question(type: string, evidenceExcerpt: string, index: number) {
  return {
    type,
    prompt: `Explain the stack rule in example ${index + 1}.`,
    ...(type === "multiple-choice" ? { choices: ["push", "pop", "peek", "clear"] } : {}),
    ...(type === "true-false" ? { choices: ["Đúng", "Sai"] } : {}),
    evidenceExcerpt,
  };
}

afterEach(() => {
  config.GEMINI_API_KEY = originalKey;
  config.GEMINI_MODEL = originalModel;
  config.GEMINI_FALLBACK_MODEL = originalFallback;
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("study exercise Gemini provider", () => {
  it("reports configuration and cancellation errors in Vietnamese", async () => {
    config.GEMINI_API_KEY = "";
    await expect(generateStudyExerciseQuestions("A source text.", 1)).rejects.toMatchObject({
      status: 503,
      message: "Gemini chưa được cấu hình trên máy chủ.",
    });

    config.GEMINI_API_KEY = "test-only-private-key";
    const controller = new AbortController();
    controller.abort();
    await expect(generateStudyExerciseQuestions("A source text.", 1, controller.signal))
      .rejects.toMatchObject({ status: 499, message: "Yêu cầu đã bị hủy." });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("generates grounded open-ended questions without answer fields", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const source = "A stack follows last-in, first-out (LIFO) order.";
    const response = {
      exercises: [{
        prompt: "Explain how a stack changes after a push followed by a pop.",
        evidenceExcerpt: "A stack follows last-in, first-out (LIFO) order.",
      }],
    };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(response) });
    await expect(generateStudyExerciseQuestions(source, 1)).resolves.toEqual(response.exercises);
    const request = generateContent.mock.calls[0][0];
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema.properties.exercises.items.properties.answer).toBeUndefined();
    expect(request.config.responseJsonSchema.properties.exercises.items.properties.explanation).toBeUndefined();
    expect(request.config.responseJsonSchema.properties.exercises.items.properties.type).toBeUndefined();
  });

  it("rejects choices on typed short-answer and essay exercises", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const source = "A stack follows last-in, first-out order.";

    for (const type of ["short-answer", "essay"] as const) {
      generateContent.mockReset();
      generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [
        {
          type,
          prompt: "Explain why a stack follows last-in, first-out order.",
          choices: ["push", "pop"],
          evidenceExcerpt: source,
        },
      ] }) });

      await expect(generateStudyExerciseQuestions(source, {
        multipleChoice: 0,
        trueFalse: 0,
        shortAnswer: type === "short-answer" ? 1 : 0,
        essay: type === "essay" ? 1 : 0,
      })).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    }
  });

  it("keeps optional choices in legacy scalar open-ended output", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const source = "A stack follows last-in, first-out order.";
    const response = { exercises: [{
      prompt: "Explain why a stack follows last-in, first-out order.",
      choices: ["push", "pop"],
      evidenceExcerpt: source,
    }] };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(response) });

    await expect(generateStudyExerciseQuestions(source, 1)).resolves.toEqual(response.exercises);
  });

  it("repairs provider math tab escapes while keeping source evidence exact", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const raw = JSON.stringify({ exercises: [{
      prompt: "Explain \\(\\triangle ABC\\)",
      evidenceExcerpt: "A triangle has three sides.",
    }] }).replaceAll("\\\\triangle", "\\triangle");
    generateContent.mockResolvedValueOnce({ text: raw });

    await expect(generateStudyExerciseQuestions("A triangle has three sides.", 1)).resolves.toEqual([{
      prompt: "Explain \\(\\triangle ABC\\)",
      evidenceExcerpt: "A triangle has three sides.",
    }]);
  });

  it("rejects provider output that adds an answer before the session", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({
      exercises: [{
        prompt: "Explain how a stack changes after a push followed by a pop.",
        evidenceExcerpt: "A stack follows last-in, first-out (LIFO) order.",
        answer: "The stack becomes empty.",
      }],
    }) });
    await expect(generateStudyExerciseQuestions(
      "A stack follows last-in, first-out (LIFO) order.", 1,
    )).rejects.toThrow();
  });

  it("generates each requested type in batches of five under one shared deadline", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    const source = "A stack follows last-in, first-out order; pop removes the newest item.";
    const counts = { multipleChoice: 5, trueFalse: 5, shortAnswer: 5, essay: 5 };
    const callTimes: number[] = [];
    const startedAt = Date.now();
    generateContent.mockImplementation(async request => {
      const payload = JSON.parse(request.contents) as { type: string; count: number };
      callTimes.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 2));
      return { text: JSON.stringify({ exercises: Array.from(
        { length: payload.count }, (_, index) => question(payload.type, source, index),
      ) }) };
    });

    const generated = await generateStudyExerciseQuestions(source, counts);
    const calls = generateContent.mock.calls.map(([request]) => request);

    expect(generated).toHaveLength(20);
    expect(Object.fromEntries(["multiple-choice", "true-false", "short-answer", "essay"].map(type => [
      type, generated.filter(exercise => exercise.type === type).length,
    ]))).toEqual({ "multiple-choice": 5, "true-false": 5, "short-answer": 5, essay: 5 });
    expect(calls).toHaveLength(4);
    expect(calls.map(request => JSON.parse(request.contents).count)).toEqual([5, 5, 5, 5]);
    expect(calls.every(request => request.config.responseJsonSchema.properties.exercises.maxItems <= 5)).toBe(true);
    expect(calls[0]!.config.responseJsonSchema.properties.exercises.items.properties.type.enum)
      .toEqual(["multiple-choice", "true-false", "short-answer", "essay"]);
    expect(calls.every((request, index) => request.config.httpOptions.timeout <=
      85_000 - (callTimes[index]! - startedAt) - 1_000)).toBe(true);
    expect(calls.every(request => request.config.httpOptions.timeout >= 11_000)).toBe(true);
  });

  it("uses one configured fallback for a documented transient service-unavailable error", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    generateContent.mockRejectedValueOnce({ status: 503, code: "SERVICE_UNAVAILABLE" });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [question(
      "short-answer", "A stack follows last-in, first-out order.", 0,
    )] }) });

    await expect(generateStudyExerciseQuestions(
      "A stack follows last-in, first-out order.", { multipleChoice: 0, trueFalse: 0, shortAnswer: 1, essay: 0 },
    )).resolves.toMatchObject([{ type: "short-answer" }]);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual([originalModel, "fallback-test-model"]);
  });

  it("keeps a fallback window after a local provider-attempt timeout", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    vi.useFakeTimers();
    generateContent.mockImplementationOnce(request => new Promise((_resolve, reject) => {
      request.config.abortSignal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
    }));
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [question(
      "short-answer", "A stack follows last-in, first-out order.", 0,
    )] }) });

    const pending = generateStudyExerciseQuestions("A stack follows last-in, first-out order.", {
      multipleChoice: 0, trueFalse: 0, shortAnswer: 1, essay: 0,
    });
    const primaryBudget = generateContent.mock.calls[0]![0].config.httpOptions.timeout;
    expect(primaryBudget).toBeGreaterThanOrEqual(11_000);
    expect(primaryBudget).toBeLessThan(85_000);
    await vi.advanceTimersByTimeAsync(primaryBudget);

    await expect(pending).resolves.toHaveLength(1);
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual([originalModel, "fallback-test-model"]);
    expect(generateContent.mock.calls[1]![0].config.httpOptions.timeout).toBeLessThanOrEqual(
      85_000 - primaryBudget - 1_000,
    );
  });

  it("retries only documented deadline and rate-limit codes", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    const retryableErrors = [
      { status: 504, code: "DEADLINE_EXCEEDED" },
      { status: 429, code: "RATE_LIMIT_EXCEEDED" },
      { status: 429, code: "TOO_MANY_REQUESTS" },
    ];
    for (const error of retryableErrors) {
      generateContent.mockReset();
      generateContent.mockRejectedValueOnce(error);
      generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [question(
        "short-answer", "A stack follows last-in, first-out order.", 0,
      )] }) });

      await expect(generateStudyExerciseQuestions(
        "A stack follows last-in, first-out order.", { multipleChoice: 0, trueFalse: 0, shortAnswer: 1, essay: 0 },
      )).resolves.toHaveLength(1);
      expect(generateContent.mock.calls.map(([request]) => request.model))
        .toEqual([originalModel, "fallback-test-model"]);
    }
  });

  it("keeps using the fallback model after one failover across remaining batches", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    const source = "A stack follows last-in, first-out order.";
    let callCount = 0;
    generateContent.mockImplementation(async request => {
      callCount += 1;
      if (callCount === 1)
        throw { status: 503, code: "SERVICE_UNAVAILABLE" };
      const payload = JSON.parse(request.contents) as { type: string; count: number };
      return { text: JSON.stringify({ exercises: Array.from(
        { length: payload.count }, (_, index) => question(payload.type, source, index),
      ) }) };
    });

    const generated = await generateStudyExerciseQuestions(source, {
      multipleChoice: 1, trueFalse: 1, shortAnswer: 0, essay: 0,
    });
    expect(generated).toHaveLength(2);
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual([originalModel, "fallback-test-model", "fallback-test-model"]);
  });

  it("does not fall back for quota, billing, permission, or missing-model failures", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    const permanentErrors = [
      { error: { status: "RESOURCE_EXHAUSTED" }, status: 429, expected: 429 },
      { error: { status: "FAILED_PRECONDITION" }, status: 402, expected: 402 },
      { error: { status: "PERMISSION_DENIED" }, status: 403, expected: 502 },
      { error: { status: "NOT_FOUND" }, status: 404, expected: 502 },
    ];
    for (const { expected, ...error } of permanentErrors) {
      generateContent.mockReset();
      generateContent.mockRejectedValueOnce(error);
      await expect(generateStudyExerciseQuestions("A stack source.", 1))
        .rejects.toMatchObject({ status: expected });
      expect(generateContent).toHaveBeenCalledTimes(1);
    }
  });

  it("stops between batches when the caller cancels the request", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const controller = new AbortController();
    const counts = { multipleChoice: 1, trueFalse: 1, shortAnswer: 1, essay: 0 };
    generateContent.mockImplementationOnce(async () => ({ text: JSON.stringify({ exercises: [
      question("multiple-choice", "A stack follows last-in, first-out order.", 0),
    ] }) })).mockImplementationOnce(async () => {
      controller.abort();
      return { text: JSON.stringify({ exercises: [
        question("true-false", "A stack follows last-in, first-out order.", 0),
      ] }) };
    });

    await expect(generateStudyExerciseQuestions(
      "A stack follows last-in, first-out order.", counts, controller.signal,
    )).rejects.toMatchObject({ status: 499 });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("returns structured solutions for the supplied exercise IDs", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const exercises = [{
      id: "00000000-0000-4000-8000-000000000007",
      prompt: "Solve 2x + 4 = 10 and show the algebraic steps.",
    }];
    const solutions = { exercises: [{
      id: exercises[0].id,
      solution: "x = 3",
      explanation: "Subtract 4 from both sides, then divide by 2.",
    }] };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(solutions) });
    await expect(generateStudyExerciseSolutions("Solve 2x + 4 = 10.", exercises))
      .resolves.toEqual(solutions.exercises);
  });

  it("solves larger sets in batches of at most five", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const exercises = Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
      prompt: `Explain stack example ${index + 1}.`,
    }));
    const callTimes: number[] = [];
    const startedAt = Date.now();
    generateContent.mockImplementation(async request => {
      const { exercises: batch } = JSON.parse(request.contents) as { exercises: typeof exercises };
      callTimes.push(Date.now());
      await new Promise(resolve => setTimeout(resolve, 2));
      return { text: JSON.stringify({ exercises: batch.map(exercise => ({
        id: exercise.id, solution: "Use the stated relationship.", explanation: "Follow each step.",
      })) }) };
    });

    const solutions = await generateStudyExerciseSolutions("A stack follows LIFO order.", exercises);
    const calls = generateContent.mock.calls.map(([request]) => request);

    expect(solutions).toHaveLength(11);
    expect(calls).toHaveLength(3);
    expect(calls.map(request => JSON.parse(request.contents).exercises.length)).toEqual([5, 5, 1]);
    expect(calls.every((request, index) => request.config.httpOptions.timeout <=
      85_000 - (callTimes[index]! - startedAt) - 1_000)).toBe(true);
  });

  it("repairs generated math escapes and preserves backslash-n inside code fences", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const id = "00000000-0000-4000-8000-000000000008";
    const raw = JSON.stringify({ exercises: [{
      id,
      solution: "\\(x \\triangle ABC = 10\\)",
      explanation: "Use \\(x \\triangle ABC\\). Code: ```python\nprint('a\\nb')\n```",
    }] }).replaceAll("\\\\triangle", "\\triangle");
    generateContent.mockResolvedValueOnce({ text: raw });

    await expect(generateStudyExerciseSolutions("Solve the triangle problem.", [{
      id,
      prompt: "Solve the triangle problem.",
    }])).resolves.toEqual([{
      id,
      solution: "\\(x \\triangle ABC = 10\\)",
      explanation: "Use \\(x \\triangle ABC\\). Code: ```python\nprint('a\\nb')\n```",
    }]);
  });
});
