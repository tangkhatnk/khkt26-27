import { afterEach, describe, expect, it, vi } from "vitest";
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});
import { config } from "../src/config.js";
import { generateGeminiQuiz, quizResponseSchema } from "../src/gemini.js";
const question = { id: "q1", question: "Question?", options: ["A", "B", "C", "D"], correctAnswerIndex: 1, explanation: "Reason" };
const originalKey = config.GEMINI_API_KEY;
const originalModel = config.GEMINI_MODEL;
const originalFallbackModel = config.GEMINI_FALLBACK_MODEL;
afterEach(() => {
  config.GEMINI_API_KEY = originalKey;
  config.GEMINI_MODEL = originalModel;
  config.GEMINI_FALLBACK_MODEL = originalFallbackModel;
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe("Gemini adapter", () => {
  it("sends untrusted study data with a fixed JSON schema and configured model", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent.mockResolvedValue({ text: JSON.stringify([question]) });
    expect(await generateGeminiQuiz({ topic: "biology", documentText: "Study material text", count: 1 })).toEqual([question]);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(config.GEMINI_MODEL);
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseSchema).toEqual(quizResponseSchema);
    expect(request.config.responseSchema.items.properties.options.minItems).toBe("4");
    expect(JSON.parse(request.contents).studyData.documentText).toBe("Study material text");
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("does not contact Gemini without a key", async () => {
    config.GEMINI_API_KEY = "";
    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 503 });
    expect(generateContent).not.toHaveBeenCalled();
  });
  it.each(["not json", "[]", undefined])("rejects invalid/refused output %s", async text => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent.mockResolvedValue({ text });
    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 502 });
  });
  it.each([
    [{ status: 400, message: JSON.stringify({ error: { details: [{ reason: "API_KEY_INVALID" }] } }) }, 502, "provider-authentication-failed", "Khóa Gemini không hợp lệ hoặc chưa được cấp quyền. Hãy kiểm tra GEMINI_API_KEY ở backend."],
    [{ status: 403, message: "provider details must stay private" }, 502, "provider-authentication-failed", "Khóa Gemini không hợp lệ hoặc chưa được cấp quyền. Hãy kiểm tra GEMINI_API_KEY ở backend."],
    [{ status: 402, message: "provider details must stay private" }, 402, "provider-billing-required", "Gemini cần được cấp thêm tín dụng hoặc bật thanh toán trong Google AI Studio."],
    [{ status: 429, message: "provider details must stay private" }, 429, "provider-quota-exceeded", "Gemini đã vượt hạn mức. Hãy kiểm tra hạn mức trong Google AI Studio rồi thử lại."],
    [{ status: 503, message: "provider details must stay private" }, 503, "service-unavailable", "Gemini hiện không khả dụng. Vui lòng thử lại sau."],
    [{ status: 404, message: "provider details must stay private" }, 502, "provider-model-unavailable", "Model Gemini đã chọn không khả dụng. Hãy đổi GEMINI_MODEL sang model hiện được hỗ trợ trong Google AI Studio."],
    [{ status: "NOT_FOUND", message: "provider details must stay private" }, 502, "provider-model-unavailable", "Model Gemini đã chọn không khả dụng. Hãy đổi GEMINI_MODEL sang model hiện được hỗ trợ trong Google AI Studio."],
  ])("classifies provider failures without exposing provider details", async (error, status, kind, message) => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent.mockRejectedValue(error);
    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status, kind, message });
  });
  it("falls back once to a distinct model when the primary is overloaded", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_MODEL = "gemini-primary";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent
      .mockRejectedValueOnce({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) })
      .mockResolvedValueOnce({ text: JSON.stringify([question]) });

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).resolves.toEqual([question]);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual(["gemini-primary", "gemini-fallback"]);
    expect(generateContent.mock.calls[0][0].config.abortSignal).toBe(generateContent.mock.calls[1][0].config.abortSignal);
  });
  it("does not make more than one fallback attempt when both models are overloaded", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockRejectedValue({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 503, kind: "service-unavailable" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("does not fall back for authentication errors", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockRejectedValue({ status: 403, message: "provider details must stay private" });

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ kind: "provider-authentication-failed" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ status: 402 }, "provider-billing-required"],
    [{ status: 429 }, "provider-quota-exceeded"],
    [{ status: 404 }, "provider-model-unavailable"],
    [{ status: 400 }, "provider-configuration-error"],
    [{ status: 503 }, "service-unavailable"],
  ])("does not use the fallback for non-overload errors %j", async (error, kind) => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockRejectedValue(error);

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ kind });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it.each(["", "gemini-3.8-flash"])("does not fall back when fallback model is disabled or equals primary (%s)", async fallbackModel => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_MODEL = "gemini-3.8-flash";
    config.GEMINI_FALLBACK_MODEL = fallbackModel;
    generateContent.mockRejectedValue({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 503, kind: "service-unavailable" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("does not fall back when the primary returns invalid output", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockResolvedValue({ text: "not json" });

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("aborts requests after 60 seconds", async () => {
    vi.useFakeTimers(); config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockImplementation(({ config: options }) => new Promise((_, reject) => {
      options.abortSignal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
    }));
    const assertion = expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(60000); await assertion;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("shares one 60-second deadline across the primary and fallback attempts", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    let rejectPrimary!: (error: unknown) => void;
    generateContent
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectPrimary = reject; }))
      .mockImplementationOnce(({ config: options }) => new Promise((_, reject) => {
        options.abortSignal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
      }));

    const operation = generateGeminiQuiz({ topic: "biology", count: 1 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(45000);
    rejectPrimary({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeLessThanOrEqual(15000);

    const assertion = expect(operation).rejects.toMatchObject({ status: 504, kind: "upstream-timeout" });
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
