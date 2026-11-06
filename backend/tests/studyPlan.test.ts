import { afterEach, describe, expect, it, vi } from "vitest";
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});
import { config } from "../src/config.js";
import { generateStudyPlan, STUDY_PLAN_SYSTEM_INSTRUCTION } from "../src/studyPlan.js";
import { studyPlanProviderResponseJsonSchema } from "../src/studyPlanSchemas.js";

const taskModels = config as typeof config & { GEMINI_TUTOR_MODEL: string };
const request = {
  goal: "Hiểu chu trình nước",
  topic: "Khoa học tự nhiên",
  level: "Lớp 6",
  preferredMinutes: 45,
};
const plan = {
  title: "Tìm hiểu chu trình nước",
  steps: [
    { title: "Nhận biết các giai đoạn", action: "Đọc mô tả về bay hơi và ngưng tụ.", outcome: "Nêu được thứ tự các giai đoạn.", check: "Tự kể lại thứ tự mà không nhìn tài liệu." },
    { title: "Vẽ chu trình", action: "Vẽ mũi tên giữa biển, mây và đất liền.", outcome: "Thể hiện được vòng tuần hoàn.", check: "Đối chiếu sơ đồ với mô tả vừa đọc." },
    { title: "Giải thích mưa", action: "Viết ngắn cách mây tạo thành mưa.", outcome: "Liên hệ được ngưng tụ với lượng mưa.", check: "Tự giải thích bằng hai câu." },
  ],
  finalCheck: "Vẽ và giải thích trọn chu trình nước.",
};
const originalKey = config.GEMINI_API_KEY;
const originalTutorModel = taskModels.GEMINI_TUTOR_MODEL;
const originalFallbackModel = config.GEMINI_FALLBACK_MODEL;

afterEach(() => {
  config.GEMINI_API_KEY = originalKey;
  taskModels.GEMINI_TUTOR_MODEL = originalTutorModel;
  config.GEMINI_FALLBACK_MODEL = originalFallbackModel;
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("goal-first study plan provider", () => {
  it("uses the existing tutor model and returns a validated structured draft", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    taskModels.GEMINI_TUTOR_MODEL = "tutor-specific-model";
    generateContent.mockResolvedValue({ text: JSON.stringify(plan) });

    await expect(generateStudyPlan(request)).resolves.toEqual(plan);
    const providerRequest = generateContent.mock.calls[0]![0];
    expect(providerRequest.model).toBe("tutor-specific-model");
    expect(providerRequest.config.responseMimeType).toBe("application/json");
    expect(providerRequest.config.responseJsonSchema).toEqual(studyPlanProviderResponseJsonSchema);
    expect(providerRequest.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(providerRequest.config.httpOptions.timeout).toBeLessThanOrEqual(30_000);
    expect(providerRequest.config.systemInstruction).toBe(STUDY_PLAN_SYSTEM_INSTRUCTION);
    expect(providerRequest.config.systemInstruction).toMatch(/nguồn.*không đáng tin|không đáng tin.*nguồn/iu);
    expect(providerRequest.config.systemInstruction).toMatch(/bản nháp|chưa được xác minh/iu);
    expect(JSON.parse(providerRequest.contents)).toEqual({ studyPlanRequest: request });
    expect(JSON.stringify(providerRequest)).not.toContain("test-only-private-key");
  });

  it("accepts only exact source excerpts and never adds them without a supplied source", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const sourceText = "Nội dung về chu trình nước: hơi nước ngưng tụ thành giọt.";
    const { createHash } = await import("node:crypto");
    const sourceRequest = {
      ...request,
      sourceText,
      sourceFingerprint: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    };
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({
      ...plan,
      steps: [{ ...plan.steps[0], sourceExcerpt: "hơi nước ngưng tụ thành giọt" }, ...plan.steps.slice(1)],
    }) });
    const grounded = await generateStudyPlan(sourceRequest);
    expect(grounded.steps[0]?.sourceExcerpt).toBe("hơi nước ngưng tụ thành giọt");

    generateContent.mockResolvedValueOnce({ text: JSON.stringify({
      ...plan,
      steps: [{ ...plan.steps[0], sourceExcerpt: "nước bay lên thành mây" }, ...plan.steps.slice(1)],
    }) });
    await expect(generateStudyPlan(sourceRequest)).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });

    generateContent.mockResolvedValueOnce({ text: JSON.stringify({
      ...plan,
      steps: [{ ...plan.steps[0], sourceExcerpt: "chu trình nước" }, ...plan.steps.slice(1)],
    }) });
    let thrown: unknown;
    try {
      await generateStudyPlan(request);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect((thrown as Error).message).not.toContain("private provider field");
  });

  it("rejects malformed provider output without exposing it", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...plan, extra: "private provider field" }) });

    await expect(generateStudyPlan(request)).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    await expect(generateStudyPlan(request)).rejects.not.toThrow("private provider field");
  });

  it("uses one bounded tutor fallback after a primary timeout", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    taskModels.GEMINI_TUTOR_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    vi.useFakeTimers();
    let primarySignal: AbortSignal | undefined;
    generateContent
      .mockImplementationOnce(providerRequest => new Promise((_resolve, reject) => {
        primarySignal = providerRequest.config.abortSignal as AbortSignal;
        primarySignal.addEventListener("abort", () => reject(new Error("primary aborted")), { once: true });
      }))
      .mockResolvedValueOnce({ text: JSON.stringify(plan) });

    const pending = generateStudyPlan(request);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(primarySignal?.aborted).toBe(true);
    await expect(pending).resolves.toEqual(plan);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls.map(([value]) => value.model)).toEqual(["primary-model", "fallback-model"]);
  });

  it("passes caller cancellation into the provider and maps it without fallback", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    taskModels.GEMINI_TUTOR_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    const caller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    generateContent.mockImplementationOnce(providerRequest => new Promise((_resolve, reject) => {
      providerSignal = providerRequest.config.abortSignal as AbortSignal;
      providerSignal.addEventListener("abort", () => reject(new Error("provider aborted")), { once: true });
    }));

    const pending = generateStudyPlan(request, caller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ status: 499, kind: "request-cancelled" });
    caller.abort();

    await cancelled;
    expect(providerSignal?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not call Gemini when configuration is missing or the request is already cancelled", async () => {
    config.GEMINI_API_KEY = undefined;
    await expect(generateStudyPlan(request)).rejects.toMatchObject({ status: 503 });
    config.GEMINI_API_KEY = "test-only-private-key";
    const caller = new AbortController();
    caller.abort();
    await expect(generateStudyPlan(request, caller.signal)).rejects.toMatchObject({ status: 499, kind: "request-cancelled" });
    expect(generateContent).not.toHaveBeenCalled();
  });
});
