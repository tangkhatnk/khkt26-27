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

afterEach(() => {
  config.GEMINI_API_KEY = originalKey;
  config.GEMINI_MODEL = originalModel;
  config.GEMINI_FALLBACK_MODEL = originalFallback;
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
