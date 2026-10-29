import { afterEach, describe, expect, it, vi } from "vitest";
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});
import { config } from "../src/config.js";
import { generateStudyGuide, STUDY_GUIDE_SYSTEM_INSTRUCTION } from "../src/studyGuide.js";
import { studyGuideProviderResponseJsonSchema } from "../src/studyGuideSchemas.js";
import { buildQuizGenerationPayload } from "../../src/adventure/quizGeneration.ts";
import { reviewMaterialSource } from "../../src/adventure/materialSources.ts";
import { studyGuideSource } from "../../src/adventure/studyGuide.ts";
import { parseStudyGuideMarkdown } from "../../src/adventure/studyGuideMarkdown.ts";

const input = {
  topic: "sports",
  prompt: "List five sports vocabulary words with Vietnamese meanings.",
};
const providerDraft = {
  title: "Từ vựng thể thao",
  body: "- *football*: bóng đá\n- *swimming*: bơi lội\n- *volleyball*: bóng chuyền",
};
const draft = { title: providerDraft.title, text: providerDraft.body };
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

describe("prompt-generated study guide", () => {
  it("returns a concise requested list as the editable public title and text draft", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify(providerDraft) });

    await expect(generateStudyGuide(input)).resolves.toEqual(draft);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(config.GEMINI_MODEL);
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toEqual(studyGuideProviderResponseJsonSchema);
    expect(request.config.maxOutputTokens).toBe(16_000);
    expect(request.config.systemInstruction).toBe(STUDY_GUIDE_SYSTEM_INSTRUCTION);
    expect(request.config.systemInstruction).toMatch(/Prompt quyết định phạm vi, độ dài, mức độ chi tiết/u);
    expect(request.config.systemInstruction).toMatch(/không kéo dài nội dung chỉ để lấp mục/u);
    expect(request.config.systemInstruction).toMatch(/không.*bịa.*trích dẫn|không.*trích dẫn.*bịa/iu);
    expect(request.config.systemInstruction).not.toMatch(/đúng 8 mục|theory là phần|500 ký tự/u);
    expect(request.config.systemInstruction).toContain("\\,dx");
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.contents)).toEqual({ studyGuideRequest: input });
    expect(JSON.stringify(request)).not.toContain("test-only-private-key");
  });

  it("appends only a bounded optional verification note and leaves body formatting intact", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft,
      verificationNote: "Đối chiếu cách viết tên giải đấu theo nguồn hiện hành.",
    }) });

    await expect(generateStudyGuide(input)).resolves.toEqual({
      title: providerDraft.title,
      text: `${providerDraft.body}\n\n**Ghi chú cần kiểm chứng:** Đối chiếu cách viết tên giải đấu theo nguồn hiện hành.`,
    });
  });

  it("rejects malformed and oversized provider bodies without exposing provider data", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...providerDraft, body: "x".repeat(19_301) }) });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects provider extras and an optional note beyond its limit", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValueOnce({ text: JSON.stringify({ ...providerDraft, private: "discard me" }) })
      .mockResolvedValueOnce({ text: JSON.stringify({ ...providerDraft, verificationNote: "n".repeat(601) }) });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({ kind: "invalid-ai-output" });
    await expect(generateStudyGuide(input)).rejects.toMatchObject({ kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("normalizes Markdown blocks while keeping math and code usable in the public draft", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const backslash = String.fromCharCode(92);
    const escapedBreak = `${backslash}n`;
    const body = [
      "## Từ vựng", "", "| English | Tiếng Việt |", "| --- | --- |", "| football | bóng đá |", "", "```js",
      `const marker = "line${backslash}nnext";`, "```", `Ký hiệu: $${backslash}nu$.`,
    ].join(escapedBreak);
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...providerDraft, body }) });

    const result = await generateStudyGuide(input);

    expect(result.text).toContain("### Từ vựng");
    expect(result.text).toContain("| English | Tiếng Việt |\n| --- | --- |\n| football | bóng đá |");
    expect(result.text).toContain(`const marker = "line${backslash}nnext";`);
    expect(result.text).toContain(`$${backslash}nu$`);
    expect(result.text).not.toContain(`${backslash}n|`);
  });

  it("repairs an under-escaped triangle through preview, reviewed source, and quiz payload", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const tab = "\t";
    const body = `${providerDraft.body}\n\nFormula: $${tab}riangle U = A + Q$.\n\nCode: \`${tab}riangle\`.`;
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...providerDraft, body }) });

    const generated = await generateStudyGuide(input);

    expect(generated.text).toContain("$\\triangle U = A + Q$");
    expect(generated.text).toContain(`Code: \`${tab}riangle\`.`);
    const previewMath = parseStudyGuideMarkdown(generated.text).flatMap(block =>
      block.type === "paragraph" ? block.children.flatMap(node => node.type === "math" ? [node.source] : []) : [],
    );
    expect(previewMath).toContain("\\triangle U = A + Q");
    const source = studyGuideSource("guide-1", generated);
    expect(source.reviewed).toBe(false);
    expect(reviewMaterialSource(source, source.text).text).toBe(generated.text);
    const payload = buildQuizGenerationPayload({
      topic: "sports", goal: "Review sports vocabulary", notes: "", sources: [reviewMaterialSource(source, source.text)],
      materials: [{ name: source.name, sourceId: source.id }],
    }, 3);
    expect(payload.documentText).toBe(`--- ${source.name} ---\n${generated.text}`);
  });

  it("keeps illustrations as bounded typed metadata outside the editable Markdown text", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const illustrations = [{
      kind: "sequence", afterSection: "examples", title: "Các bước giải", description: "Làm theo thứ tự.",
      steps: [{ label: "Tính giá trị" }, { label: "Tính hệ số góc" }],
    }];
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft, body: `${providerDraft.body}\n\n1. Bước 1\n2. Bước 2`,
      illustrations: illustrations.map(value => JSON.stringify(value)),
    }) });

    const result = await generateStudyGuide(input);

    expect(result.text).toContain("1. Bước 1\n2. Bước 2");
    expect(result.illustrations).toEqual(illustrations);
  });

  it.each([
    ["malformed illustration JSON", ["["]],
    ["an illustration item over the byte limit", [" ".repeat(16 * 1024 + 1)]],
    ["an illustration rejected by the strict schema", [JSON.stringify({ kind: "sequence", title: "Thiếu trường bắt buộc" })]],
  ])("rejects %s as invalid AI output", async (_name, illustrations) => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...providerDraft, illustrations }) });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("keeps the body and optional note below the existing 20,000-character API limit", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft,
      body: "b".repeat(19_300),
      verificationNote: "n".repeat(600),
    }) });

    const result = await generateStudyGuide(input);

    expect(result.text.length).toBeGreaterThan(19_000);
    expect(result.text.length).toBeLessThanOrEqual(20_000);
  });

  it("maps provider quota errors to a safe retryable API error", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    generateContent.mockRejectedValue({ status: 429, message: "private provider details" });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({ status: 429, kind: "provider-quota-exceeded" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled primary and returns the successful fallback response", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    vi.useFakeTimers();
    let primarySignal: AbortSignal | undefined;
    generateContent
      .mockImplementationOnce(request => new Promise((_resolve, reject) => {
        primarySignal = request.config.abortSignal as AbortSignal;
        primarySignal.addEventListener("abort", () => reject(new Error("primary aborted")), { once: true });
      }))
      .mockResolvedValueOnce({ text: JSON.stringify(providerDraft) });

    const pending = generateStudyGuide(input);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(primarySignal?.aborted).toBe(true);
    await expect(pending).resolves.toEqual(draft);
    const primary = generateContent.mock.calls[0][0];
    const fallback = generateContent.mock.calls[1][0];
    expect(primary.config.httpOptions.timeout).toBe(30_000);
    expect(fallback.config.httpOptions.timeout).toBeLessThanOrEqual(60_000);
    expect(fallback.config.httpOptions.timeout).toBeGreaterThan(0);
    expect(fallback.config.abortSignal).not.toBe(primarySignal);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("returns 499 on caller cancellation without starting a fallback", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    const caller = new AbortController();
    let primarySignal: AbortSignal | undefined;
    generateContent.mockImplementationOnce(request => new Promise((_resolve, reject) => {
      primarySignal = request.config.abortSignal as AbortSignal;
      primarySignal.addEventListener("abort", () => reject(new Error("primary aborted")), { once: true });
    }));

    const pending = generateStudyGuide(input, caller.signal);
    const cancelled = expect(pending).rejects.toMatchObject({ status: 499, kind: "request-cancelled" });
    caller.abort();

    await cancelled;
    expect(primarySignal?.aborted).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
