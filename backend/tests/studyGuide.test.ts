import { afterEach, describe, expect, it, vi } from "vitest";
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});
import { config } from "../src/config.js";
import { generateStudyGuide, STUDY_GUIDE_SYSTEM_INSTRUCTION } from "../src/studyGuide.js";
import { studyGuideProviderResponseJsonSchema } from "../src/studyGuideSchemas.js";

const input = {
  topic: "biology",
  prompt: "Explain photosynthesis for a beginner.",
  goal: "Prepare for a biology exam.",
};
const providerDraft = {
  title: "Ôn tập quang hợp",
  keyPoints: "Quang hợp chuyển năng lượng ánh sáng thành năng lượng hóa học. Quá trình này tạo chất hữu cơ cho cây.",
  theory: [
    "Quang hợp là quá trình sinh học chuyển năng lượng ánh sáng thành năng lượng hóa học được tích lũy trong chất hữu cơ.",
    "Có thể giải thích quá trình từ các nguyên liệu đầu vào, điều kiện diễn ra và sản phẩm tạo thành.",
    "Ánh sáng cung cấp năng lượng, nước và khí cacbonic tham gia vào các phản ứng tạo chất hữu cơ.",
    "Khi phân tích một thí nghiệm, cần xác định biến được thay đổi, yếu tố được giữ ổn định và kết quả quan sát.",
    "Các giai đoạn có quan hệ với nhau nhưng có điều kiện, cơ chế và sản phẩm khác nhau.",
    "Không nên suy ra một quy luật từ một quan sát đơn lẻ nếu chưa xét các điều kiện của thí nghiệm.",
  ].join(" "),
  role: "Quá trình này tạo chất hữu cơ cho cây và góp phần cung cấp nguồn vật chất, năng lượng cho các sinh vật khác.",
  comparison: "Có thể so sánh các giai đoạn theo nơi diễn ra, điều kiện cần và sản phẩm chính để thấy vai trò riêng của từng giai đoạn.",
  examples: "Đặt hai cây cùng loài trong điều kiện tương tự nhưng một cây thiếu ánh sáng. So sánh sự tạo tinh bột để xem ánh sáng ảnh hưởng thế nào.",
  commonMisconceptions: "Không nên cho rằng cây chỉ hô hấp vào ban đêm; hãy phân biệt hô hấp với quang hợp và xét điều kiện của từng quá trình.",
  practice: [
    {
      question: "Vì sao cây trồng trong tối lâu ngày phát triển khác cây được chiếu sáng?",
      answerHint: "Xem xét nguồn năng lượng cần cho quang hợp và liên hệ với sự tạo chất hữu cơ.",
    },
    {
      question: "Cần giữ yếu tố nào ổn định khi so sánh ảnh hưởng của ánh sáng?",
      answerHint: "Giữ ổn định loài cây, lượng nước và các điều kiện khác để so sánh công bằng.",
    },
    {
      question: "Kết quả nào cho thấy cây đã tạo được chất hữu cơ?",
      answerHint: "Tìm dấu hiệu cho thấy tinh bột có mặt ở lá sau khi cây nhận ánh sáng.",
    },
  ],
  verificationNote: "",
};
const formatPractice = (field: "question" | "answerHint") =>
  providerDraft.practice.map((pair, index) => `${index + 1}. ${pair[field]}`).join("\n");
const draft = {
  title: "Ôn tập quang hợp",
  text: `## 1. Ý chính\n${providerDraft.keyPoints}\n\n## 2. Lý thuyết\n${providerDraft.theory}\n\n## 3. Vai trò\n${providerDraft.role}\n\n## 4. So sánh\n${providerDraft.comparison}\n\n## 5. Ví dụ minh họa\n${providerDraft.examples}\n\n## 6. Nhầm lẫn thường gặp\n${providerDraft.commonMisconceptions}\n\n## 7. Câu hỏi thực tế\n${formatPractice("question")}\n\n## 8. Gợi ý đáp án\n${formatPractice("answerHint")}`,
};
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
  it("uses the configured Gemini model and returns a bounded editable draft", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify(providerDraft) });

    await expect(generateStudyGuide(input)).resolves.toEqual(draft);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(config.GEMINI_MODEL);
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toEqual(studyGuideProviderResponseJsonSchema);
    expect(request.config.systemInstruction).toBe(STUDY_GUIDE_SYSTEM_INSTRUCTION);
    expect(request.config.systemInstruction).toMatch(/không.*trích dẫn.*bịa|không.*bịa.*trích dẫn/iu);
    expect(request.config.systemInstruction).toMatch(/gia sư|người hướng dẫn/iu);
    expect(request.config.systemInstruction).toMatch(/từng bước|chia nhỏ|đoạn ngắn/iu);
    expect(request.config.systemInstruction).toMatch(/1\. Ý chính[\s\S]*2\. Lý thuyết[\s\S]*3\. Vai trò[\s\S]*4\. So sánh[\s\S]*5\. Ví dụ minh họa[\s\S]*6\. Nhầm lẫn thường gặp[\s\S]*7\. Câu hỏi thực tế[\s\S]*8\. Gợi ý đáp án/iu);
    expect(request.config.systemInstruction).toMatch(/theory là phần trọng tâm và chi tiết nhất/iu);
    expect(request.config.systemInstruction).toMatch(/Tạo 3–5 cặp practice[\s\S]{0,240}trong cùng một đối tượng/iu);
    expect(request.config.systemInstruction).toMatch(/\$H_2O\$/u);
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(request.contents)).toEqual({ studyGuideRequest: input });
    expect(JSON.stringify(request)).not.toContain("test-only-private-key");
  });

  it("rejects oversized or malformed provider output without exposing provider data", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...providerDraft, keyPoints: "x".repeat(20_001) }) });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 502,
      kind: "invalid-ai-output",
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects provider output with a missing section or shallow theory", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({
      text: JSON.stringify({ ...providerDraft, theory: "Quang hợp tạo chất hữu cơ." }),
    });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 502,
      kind: "invalid-ai-output",
    });
  });

  it("appends an optional verification note after the eight numbered sections", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft,
      verificationNote: "Đối chiếu thuật ngữ với giáo trình của lớp.",
    }) });

    const result = await generateStudyGuide(input);
    expect(result.text.match(/^## /gmu)).toHaveLength(8);
    expect(result.text.indexOf("## 8. Gợi ý đáp án")).toBeLessThan(result.text.indexOf("**Ghi chú giả định và kiểm chứng:**"));
    expect(result.text.endsWith("**Ghi chú giả định và kiểm chứng:** Đối chiếu thuật ngữ với giáo trình của lớp.")).toBe(true);
  });

  it("returns parseable Markdown when provider text uses escaped newlines", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const backslash = String.fromCharCode(92);
    const escapedBreak = `${backslash}n`;
    const comparison = [
      `${"So sánh các chất theo vai trò, điều kiện và kết quả của phản ứng. ".repeat(3)}`,
      "", "| Chất | Vai trò |", "| --- | --- |", "| Oxy | Sản phẩm |",
    ].join(escapedBreak);
    generateContent.mockResolvedValue({ text: JSON.stringify({ ...providerDraft, comparison }) });

    const result = await generateStudyGuide(input);

    expect(result.text).toContain("| Chất | Vai trò |\n| --- | --- |\n| Oxy | Sản phẩm |");
    expect(result.text).not.toContain(`${backslash}n|`);
    expect(result.text.length).toBeLessThanOrEqual(20_000);
  });

  it("rejects an empty trailing practice pair instead of guessing question-answer alignment", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft,
      practice: [...providerDraft.practice, { question: "", answerHint: "" }],
    }) });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 502,
      kind: "invalid-ai-output",
    });
  });

  it("rejects a practice pair with a real question but no answer hint", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft,
      practice: [...providerDraft.practice, { question: "Câu hỏi thứ tư có tình huống cụ thể là gì?", answerHint: "" }],
    }) });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 502,
      kind: "invalid-ai-output",
    });
  });

  it("formats a maximum-bound provider draft below the final 20,000-character limit", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const maximumDraft = {
      ...providerDraft,
      keyPoints: "k".repeat(1_200),
      theory: "t".repeat(8_500),
      role: "r".repeat(1_200),
      comparison: "c".repeat(1_800),
      examples: "e".repeat(1_600),
      commonMisconceptions: "m".repeat(1_400),
      practice: Array.from({ length: 5 }, () => ({
        question: "q".repeat(250),
        answerHint: "a".repeat(400),
      })),
      verificationNote: "n".repeat(600),
    };
    generateContent.mockResolvedValue({ text: JSON.stringify(maximumDraft) });

    const result = await generateStudyGuide(input);

    expect(result.text.length).toBeLessThanOrEqual(20_000);
    expect(result.text.length).toBeGreaterThan(19_000);
    expect(result.text.match(/^## /gmu)).toHaveLength(8);
  });

  it("keeps model headings nested below the eight server-owned section headings", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({
      ...providerDraft,
      keyPoints: `${providerDraft.keyPoints}\n\n# Heading one\n## Heading two\n### Heading three\n    ## Indented heading\n\t# Tabbed heading\n\nSetext heading\n===============\n\n\`\`\`md\n## Code example\n\`\`\``,
    }) });

    const result = await generateStudyGuide(input);
    const outsideFencedCode = result.text.replace(/```[\s\S]*?```/gu, "");

    expect(outsideFencedCode.match(/^[\t ]*## /gmu)).toHaveLength(8);
    expect(result.text).toContain("### Heading one\n### Heading two\n### Heading three");
    expect(result.text).toContain("### Setext heading");
    expect(result.text).toContain("    ### Indented heading\n\t### Tabbed heading");
    expect(result.text).toContain("```md\n## Code example\n```");
  });

  it("maps provider quota errors to a safe retryable API error", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    generateContent.mockRejectedValue({ status: 429, message: "private provider details" });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 429,
      kind: "provider-quota-exceeded",
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled primary at 30 seconds and gives fallback only the remaining overall budget", async () => {
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

  it.each([
    { status: 503, code: "UNAVAILABLE", message: "overloaded" },
    { status: 408, message: "request timeout" },
    { status: 504, code: "DEADLINE_EXCEEDED", message: "deadline" },
  ])("tries fallback after a primary timeout or overload ($status)", async providerError => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    generateContent
      .mockRejectedValueOnce(providerError)
      .mockResolvedValueOnce({ text: JSON.stringify(providerDraft) });

    await expect(generateStudyGuide(input)).resolves.toEqual(draft);
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual([
      "primary-model", "fallback-model",
    ]);
    expect(generateContent.mock.calls[0][0].config.httpOptions.timeout).toBeLessThanOrEqual(30_000);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeLessThanOrEqual(90_000);
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

  it("does not retry configuration errors", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    generateContent.mockRejectedValueOnce({ status: 400, message: "private provider details" });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 502,
      kind: "provider-configuration-error",
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not retry provider authentication errors", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "primary-model";
    config.GEMINI_FALLBACK_MODEL = "fallback-model";
    generateContent.mockRejectedValueOnce({ status: 403, code: "PERMISSION_DENIED", message: "private provider details" });

    await expect(generateStudyGuide(input)).rejects.toMatchObject({
      status: 502,
      kind: "provider-authentication-failed",
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the primary times out and the fallback names the same model", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_MODEL = "same-model";
    config.GEMINI_FALLBACK_MODEL = "same-model";
    vi.useFakeTimers();
    generateContent.mockImplementationOnce(request => new Promise((_resolve, reject) => {
      const signal = request.config.abortSignal as AbortSignal;
      signal.addEventListener("abort", () => reject(new Error("primary aborted")), { once: true });
    }));

    const pending = generateStudyGuide(input);
    const timedOut = expect(pending).rejects.toMatchObject({ status: 504, kind: "upstream-timeout" });
    await vi.advanceTimersByTimeAsync(30_000);

    await timedOut;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not contact Gemini when the request was already cancelled or the key is missing", async () => {
    config.GEMINI_API_KEY = undefined;
    await expect(generateStudyGuide(input)).rejects.toMatchObject({ status: 503 });
    config.GEMINI_API_KEY = "test-only-private-key";
    const controller = new AbortController();
    controller.abort();
    await expect(generateStudyGuide(input, controller.signal)).rejects.toMatchObject({ status: 499 });
    expect(generateContent).not.toHaveBeenCalled();
  });
});
