import { afterEach, describe, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});

import { config } from "../src/config.js";
const taskModels = config as typeof config & {
  GEMINI_QUESTION_MODEL: string;
  GEMINI_EVALUATION_MODEL: string;
};
import {
  generateStudyExerciseQuestions,
  generateStudyExerciseSolutions,
} from "../src/studyExerciseProvider.js";

const originalKey = config.GEMINI_API_KEY;
const originalQuestionModel = taskModels.GEMINI_QUESTION_MODEL;
const originalEvaluationModel = taskModels.GEMINI_EVALUATION_MODEL;
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
  taskModels.GEMINI_QUESTION_MODEL = originalQuestionModel;
  taskModels.GEMINI_EVALUATION_MODEL = originalEvaluationModel;
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
    config.GEMINI_MODEL = "legacy-model";
    taskModels.GEMINI_QUESTION_MODEL = "question-specific-model";
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
    expect(request.model).toBe("question-specific-model");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema.properties.exercises.items.properties.answer).toBeUndefined();
    expect(request.config.responseJsonSchema.properties.exercises.items.properties.explanation).toBeUndefined();
    expect(request.config.responseJsonSchema.properties.exercises.items.properties.type).toBeUndefined();
  });

  it("aligns typed and scalar prompt instructions with the grounded-evidence validator", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const source = "The area formula uses the base and perpendicular height.";
    const response = { exercises: [{
      prompt: "Which area formula uses the base and height?",
      evidenceExcerpt: source,
    }] };
    const requests = [
      { composition: { multipleChoice: 1, trueFalse: 0, shortAnswer: 0, essay: 0 }, type: "multiple-choice" },
      { composition: { multipleChoice: 0, trueFalse: 1, shortAnswer: 0, essay: 0 }, type: "true-false" },
      { composition: { multipleChoice: 0, trueFalse: 0, shortAnswer: 1, essay: 0 }, type: "short-answer" },
      { composition: { multipleChoice: 0, trueFalse: 0, shortAnswer: 0, essay: 1 }, type: "essay" },
      { composition: 1, type: undefined },
    ] as const;

    for (const { composition, type } of requests) {
      const isTrueFalse = type === "true-false";
      generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [{
        prompt: isTrueFalse ? "Đúng hay sai: The area formula uses the base and height?"
          : response.exercises[0].prompt,
        evidenceExcerpt: source,
        ...(type === undefined ? {} : { type }),
        ...(type === "multiple-choice" ? { choices: ["A", "B", "C", "D"] } : {}),
        ...(type === "true-false" ? { choices: ["Đúng", "Sai"] } : {}),
      }] }) });
      await expect(generateStudyExerciseQuestions(source, composition)).resolves.toHaveLength(1);

      const instruction = generateContent.mock.calls.at(-1)![0].config.systemInstruction;
      expect(instruction).toContain("nhắc lại nguyên văn ít nhất một từ khóa có nghĩa");
      expect(instruction).toContain("evidenceExcerpt phải là một đoạn trích nguyên văn liên tục");
      if (isTrueFalse)
        expect(instruction).toContain("Đúng hay sai: Stack luôn loại bỏ phần tử mới nhất trước?");
    }
  });

  it("repairs one invalid typed batch on the same working model", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = originalQuestionModel;
    const source = "The base remains fixed while height changes.";
    const invalid = { exercises: [{
      type: "true-false",
      prompt: "Is this statement accurate?",
      choices: ["Đúng", "Sai"],
      evidenceExcerpt: source,
    }] };
    const repaired = { exercises: [{
      type: "true-false",
      prompt: "Đúng hay sai: the base remains fixed?",
      choices: ["Đúng", "Sai"],
      evidenceExcerpt: source,
    }] };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalid) });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(repaired) });

    await expect(generateStudyExerciseQuestions(source, {
      multipleChoice: 0, trueFalse: 1, shortAnswer: 0, essay: 0,
    })).resolves.toMatchObject([{ type: "true-false", prompt: repaired.exercises[0].prompt }]);

    const requests = generateContent.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests.map(request => request.model)).toEqual([originalQuestionModel, originalQuestionModel]);
    expect(requests.map(request =>
      request.config.responseJsonSchema.properties.exercises.items.properties.type.enum))
      .toEqual([["true-false"], ["true-false"]]);
    expect(requests[1]!.config.systemInstruction).toContain("prompt-not-grounded");
    expect(requests[1]!.config.systemInstruction).not.toContain(invalid.exercises[0].prompt);
  });

  it("repairs with the fallback model when it produced the invalid batch", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    const source = "The base remains fixed while height changes.";
    generateContent.mockRejectedValueOnce({ status: 503, code: "SERVICE_UNAVAILABLE" });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [{
      type: "true-false", prompt: "Is this statement accurate?", choices: ["Đúng", "Sai"], evidenceExcerpt: source,
    }] }) });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [{
      type: "true-false", prompt: "Đúng hay sai: the base remains fixed?", choices: ["Đúng", "Sai"], evidenceExcerpt: source,
    }] }) });

    await expect(generateStudyExerciseQuestions(source, {
      multipleChoice: 0, trueFalse: 1, shortAnswer: 0, essay: 0,
    })).resolves.toHaveLength(1);
    const requests = generateContent.mock.calls.map(([request]) => request);
    expect(requests.map(request => request.model)).toEqual([
      originalQuestionModel, "fallback-test-model", "fallback-test-model",
    ]);
    expect(requests.map(request =>
      request.config.responseJsonSchema.properties.exercises.items.properties.type.enum))
      .toEqual([["true-false"], ["true-false"], ["true-false"]]);
  });

  it("rejects a batch when its one validation repair is still invalid", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = originalQuestionModel;
    const source = "The base remains fixed while height changes.";
    const invalid = { exercises: [{
      type: "true-false",
      prompt: "Is this statement accurate?",
      choices: ["Đúng", "Sai"],
      evidenceExcerpt: source,
    }] };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalid) });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalid) });

    await expect(generateStudyExerciseQuestions(source, {
      multipleChoice: 0, trueFalse: 1, shortAnswer: 0, essay: 0,
    })).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("uses only one validation repair across all requested batches", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = originalQuestionModel;
    const source = "The base remains fixed while height changes.";
    const invalid = (type: string, choices: string[]) => ({ exercises: [{
      type,
      prompt: "Is this statement accurate?",
      choices,
      evidenceExcerpt: source,
    }] });
    const repairedMultipleChoice = { exercises: [{
      type: "multiple-choice",
      prompt: "Which base remains fixed?",
      choices: ["The base", "The height"],
      evidenceExcerpt: source,
    }] };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalid("multiple-choice", ["A", "B"])) });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(repairedMultipleChoice) });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalid("true-false", ["Đúng", "Sai"])) });

    await expect(generateStudyExerciseQuestions(source, {
      multipleChoice: 1, trueFalse: 1, shortAnswer: 0, essay: 0,
    })).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual([originalQuestionModel, originalQuestionModel, originalQuestionModel]);
  });

  it("propagates caller cancellation during the validation repair", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = originalQuestionModel;
    const source = "The base remains fixed while height changes.";
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [{
      type: "true-false", prompt: "Is this statement accurate?", choices: ["Đúng", "Sai"], evidenceExcerpt: source,
    }] }) });
    let markRepairStarted!: () => void;
    const repairStarted = new Promise<void>(resolve => { markRepairStarted = resolve; });
    generateContent.mockImplementationOnce(request => {
      markRepairStarted();
      return new Promise((_resolve, reject) => request.config.abortSignal.addEventListener(
        "abort", () => reject(new Error("request aborted")), { once: true },
      ));
    });

    const controller = new AbortController();
    const pending = generateStudyExerciseQuestions(source, {
      multipleChoice: 0, trueFalse: 1, shortAnswer: 0, essay: 0,
    }, controller.signal);
    await repairStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ status: 499, kind: "request-cancelled" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("keeps a validation repair inside the shared 85 second generation deadline", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = originalQuestionModel;
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const startedAt = Date.now();
    const source = "The base remains fixed while height changes.";
    generateContent.mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
      return { text: JSON.stringify({ exercises: [{
        type: "true-false", prompt: "Is this statement accurate?", choices: ["Đúng", "Sai"], evidenceExcerpt: source,
      }] }) };
    });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ exercises: [{
      type: "true-false", prompt: "Đúng hay sai: the base remains fixed?", choices: ["Đúng", "Sai"], evidenceExcerpt: source,
    }] }) });

    await expect(generateStudyExerciseQuestions(source, {
      multipleChoice: 0, trueFalse: 1, shortAnswer: 0, essay: 0,
    })).resolves.toHaveLength(1);

    const requests = generateContent.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.config.httpOptions.timeout).toBeLessThanOrEqual(42_000);
    expect(requests[1]!.config.httpOptions.timeout).toBeGreaterThanOrEqual(11_000);
    expect(requests[1]!.config.httpOptions.timeout).toBeLessThanOrEqual(85_000 - 35_000 - 1_000);
    expect(Date.now() - startedAt).toBe(35_000);
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
      expect(generateContent).toHaveBeenCalledTimes(2);
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
    const invalidOutput = { exercises: [{
      prompt: "Explain how a stack changes after a push followed by a pop.",
      evidenceExcerpt: "A stack follows last-in, first-out (LIFO) order.",
      answer: "The stack becomes empty.",
    }] };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalidOutput) });
    generateContent.mockResolvedValueOnce({ text: JSON.stringify(invalidOutput) });
    await expect(generateStudyExerciseQuestions(
      "A stack follows last-in, first-out (LIFO) order.", 1,
    )).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
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
    expect(calls.map(request =>
      request.config.responseJsonSchema.properties.exercises.items.properties.type.enum))
      .toEqual([["multiple-choice"], ["true-false"], ["short-answer"], ["essay"]]);
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
      .toEqual([originalQuestionModel, "fallback-test-model"]);
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
      .toEqual([originalQuestionModel, "fallback-test-model"]);
    expect(generateContent.mock.calls[1]![0].config.httpOptions.timeout).toBeLessThanOrEqual(
      85_000 - primaryBudget - 1_000,
    );
  });

  it("gives the initial fallback more than 15 seconds while reserving every later batch and repair floor", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "fallback-test-model";
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const source = "A stack follows last-in, first-out order; pop removes the newest item.";
    let callCount = 0;
    generateContent.mockImplementation(async request => {
      callCount += 1;
      const payload = JSON.parse(request.contents) as { type: string; count: number };
      if (callCount === 1) {
        await vi.advanceTimersByTimeAsync(9_000);
        throw { status: 503, code: "SERVICE_UNAVAILABLE" };
      }
      if (callCount === 2) {
        await vi.advanceTimersByTimeAsync(18_000);
        return { text: JSON.stringify({ exercises: [question(payload.type, source, 0)] }) };
      }
      if (callCount === 3) {
        return { text: JSON.stringify({ exercises: [{
          type: "true-false", prompt: "Is this statement accurate?", choices: ["Đúng", "Sai"], evidenceExcerpt: source,
        }] }) };
      }
      if (payload.type === "true-false") {
        return { text: JSON.stringify({ exercises: [{
          type: "true-false", prompt: "Đúng hay sai: stack removes the newest item first?",
          choices: ["Đúng", "Sai"], evidenceExcerpt: source,
        }] }) };
      }
      return { text: JSON.stringify({ exercises: [question(payload.type, source, 0)] }) };
    });

    const startedAt = Date.now();
    const generated = await generateStudyExerciseQuestions(source, {
      multipleChoice: 1, trueFalse: 1, shortAnswer: 1, essay: 1,
    });
    const requests = generateContent.mock.calls.map(([request]) => request);
    const budgets = requests.map(request => request.config.httpOptions.timeout);

    expect(generated).toHaveLength(4);
    expect(requests.map(request => request.model)).toEqual([
      originalQuestionModel,
      "fallback-test-model", "fallback-test-model", "fallback-test-model", "fallback-test-model", "fallback-test-model",
    ]);
    expect(budgets).toEqual([
      14_000, // Preserve the primary's fair slice across four batches, failover, and repair.
      31_000, // Use the remaining time after reserving 11s for three batches, repair, and margin.
      14_250,
      19_000,
      28_500,
      57_000,
    ]);
    expect(budgets[1]).toBeGreaterThan(15_000);
    expect(budgets[1]).toBeLessThanOrEqual(40_000);
    expect(budgets.slice(2).every(budget => budget >= 11_000)).toBe(true);
    expect(Date.now() - startedAt).toBe(27_000);
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
        .toEqual([originalQuestionModel, "fallback-test-model"]);
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
      .toEqual([originalQuestionModel, "fallback-test-model", "fallback-test-model"]);
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
    config.GEMINI_MODEL = "legacy-model";
    taskModels.GEMINI_EVALUATION_MODEL = "evaluation-specific-model";
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
    expect(generateContent.mock.calls[0][0].model).toBe("evaluation-specific-model");
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
