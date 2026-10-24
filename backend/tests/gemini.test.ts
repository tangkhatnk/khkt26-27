import { afterEach, describe, expect, it, vi } from "vitest";
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});
import { config } from "../src/config.js";
import { generateGeminiQuiz, quizResponseSchema } from "../src/gemini.js";
const question = { id: "q1", question: "Question?", options: ["A", "B", "C", "D"], correctAnswerIndex: 1, explanation: "Reason" };
const sourceText = "In photosynthesis, chlorophyll absorbs light energy.";
const groundedQuestion = {
  id: "q1", question: "What absorbs light energy during photosynthesis?",
  options: ["Chlorophyll", "Sound", "Pressure", "Gravity"],
  correctAnswerIndex: 0,
  explanation: "Chlorophyll absorbs light energy during photosynthesis.",
  sourceExcerpt: "chlorophyll absorbs light energy",
};
const substantialStudyGuide = `# Quang hợp ở thực vật

## Pha sáng
Trong pha sáng, diệp lục hấp thụ năng lượng ánh sáng. Nước bị phân tách và giải phóng oxygen. ATP và NADPH cung cấp năng lượng cùng electron cho các phản ứng tiếp theo.

## Chu trình Calvin
Trong chu trình Calvin, carbon dioxide được cố định thành carbohydrate. Enzyme Rubisco xúc tác bước cố định carbon đầu tiên. Sản phẩm carbohydrate có thể được dùng để tổng hợp đường và các hợp chất hữu cơ khác.

## Mối liên hệ giữa hai giai đoạn
Pha sáng tạo ATP và NADPH, còn chu trình Calvin sử dụng chúng cùng carbon dioxide để tạo carbohydrate. Vì vậy, hai giai đoạn liên kết với nhau trong quá trình chuyển năng lượng ánh sáng thành năng lượng hóa học.`;
const studyGuideQuestions = [
  {
    id: "guide-q1", question: "Trong chu trình Calvin, chất nào được cố định thành carbohydrate?",
    options: ["carbon dioxide", "oxygen", "nước", "diệp lục"], correctAnswerIndex: 0,
    explanation: "Chu trình Calvin cố định carbon dioxide thành carbohydrate.", knowledgePoint: "Cố định carbon",
    sourceExcerpt: "Trong chu trình Calvin, carbon dioxide được cố định thành carbohydrate.",
  },
  {
    id: "guide-q2", question: "Chất nào hấp thụ năng lượng ánh sáng trong pha sáng?",
    options: ["Rubisco", "diệp lục", "carbon dioxide", "carbohydrate"], correctAnswerIndex: 1,
    explanation: "Diệp lục hấp thụ năng lượng ánh sáng trong pha sáng.", knowledgePoint: "Pha sáng",
    sourceExcerpt: "Trong pha sáng, diệp lục hấp thụ năng lượng ánh sáng.",
  },
  {
    id: "guide-q3", question: "Những phân tử nào cung cấp năng lượng và electron cho phản ứng tiếp theo?",
    options: ["ATP và NADPH", "oxygen và nước", "Rubisco và đường", "ánh sáng và diệp lục"], correctAnswerIndex: 0,
    explanation: "ATP và NADPH cung cấp năng lượng cùng electron cho các phản ứng tiếp theo.", knowledgePoint: "ATP và NADPH",
    sourceExcerpt: "ATP và NADPH cung cấp năng lượng cùng electron cho các phản ứng tiếp theo.",
  },
];
const providerGuideText = [
  "Đột biến gen là những biến đổi nhỏ xảy ra trong cấu trúc của gen, liên quan đến một hoặc một số cặp nucleotide.",
  "Thay thế cặp nucleotide | Đổi cặp này bằng cặp khác | Không đổi chiều dài",
  "Phần lớn đột biến điểm là có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin.",
].join("\n");
const providerFirstBatch = [
  {
    id: "q1", question: "Theo tài liệu, đột biến gen liên quan đến cấu trúc của gen là gì?",
    options: ["Biến đổi nhỏ liên quan đến một hoặc một số cặp nucleotide", "Biến đổi cấu trúc của toàn bộ nhiễm sắc thể", "Biến đổi số lượng nhiễm sắc thể trong tế bào", "Biến đổi diễn ra ở cấp độ tế bào chất"],
    correctAnswerIndex: 0,
    explanation: "Tài liệu nêu rõ đột biến gen là những biến đổi nhỏ xảy ra trong cấu trúc của gen, liên quan đến một hoặc một số cặp nucleotide.",
    knowledgePoint: "Khái niệm đột biến gen",
    sourceExcerpt: "Đột biến gen là những biến đổi nhỏ xảy ra trong cấu trúc của gen, liên quan đến một hoặc một số cặp nucleotide.",
  },
  {
    id: "q2", question: "Dạng đột biến điểm nào làm chiều dài gen không thay đổi?",
    options: ["Mất cặp nucleotide", "Thêm cặp nucleotide", "Thay thế cặp nucleotide", "Đột biến cấu trúc nhiễm sắc thể"],
    correctAnswerIndex: 2,
    explanation: "Dạng thay thế cặp nucleotide không đổi chiều dài gen.",
    knowledgePoint: "Ảnh hưởng chiều dài gen",
    sourceExcerpt: "Thay thế cặp nucleotide | Đổi cặp này bằng cặp khác | Không đổi chiều dài",
  },
  {
    id: "q3", question: "Phần lớn đột biến điểm gây hậu quả như thế nào?",
    options: ["Có lợi cho sinh vật", "Là trung tính", "Có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin", "Không ảnh hưởng gì đến chuỗi axit amin"],
    correctAnswerIndex: 2,
    explanation: "Phần lớn đột biến điểm là có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin.",
    knowledgePoint: "Hậu quả của đột biến điểm",
    sourceExcerpt: "Phần lớn đột biến điểm là có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin.",
  },
];
const providerRepairBatch = [
  {
    id: "q1", question: "Theo tài liệu, đột biến gen liên quan đến những thành phần nào?",
    options: ["Một hoặc một số cặp nucleotide", "Toàn bộ nhiễm sắc thể", "Cấu trúc của tế bào", "Số lượng nhiễm sắc thể"],
    correctAnswerIndex: 0,
    explanation: "Đột biến gen liên quan đến một hoặc một số cặp nucleotide.",
    knowledgePoint: "Khái niệm đột biến gen",
    sourceExcerpt: "Đột biến gen là những biến đổi nhỏ xảy ra trong cấu trúc của gen, liên quan đến một hoặc một số cặp nucleotide.",
  },
  { ...providerFirstBatch[1] },
  {
    id: "q3", question: "Phần lớn đột biến điểm gây hậu quả như thế nào?",
    options: ["Phần lớn là có lợi", "Phần lớn là trung tính", "Phần lớn là có hại", "Không gây ảnh hưởng gì"],
    correctAnswerIndex: 2,
    explanation: "Phần lớn đột biến điểm là có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin.",
    knowledgePoint: "Hậu quả của đột biến điểm",
    sourceExcerpt: "Phần lớn đột biến điểm là có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin.",
  },
];
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
    generateContent.mockResolvedValue({ text: JSON.stringify([groundedQuestion]) });
    expect(await generateGeminiQuiz({ topic: "biology", documentText: sourceText, documentAttached: true, goal: "Review photosynthesis", count: 1 }))
      .toEqual([groundedQuestion]);
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(config.GEMINI_MODEL);
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toEqual(quizResponseSchema(true));
    expect(request.config.responseJsonSchema.items.properties.options.minItems).toBe(4);
    expect(request.config.responseJsonSchema.items.required).toContain("knowledgePoint");
    expect(request.config.responseJsonSchema.items.required).toContain("sourceExcerpt");
    expect(JSON.parse(request.contents).studyData.documentText).toBe(sourceText);
    expect(JSON.parse(request.contents).studyData.goal).toBe("Review photosynthesis");
    expect(request.config.systemInstruction).toContain("đúng 1 câu");
    expect(request.config.systemInstruction).toContain("không bù kiến thức ngoài tài liệu");
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("keeps exact choice bounds without expanding the quiz array into fixed output bounds", () => {
    const schema = quizResponseSchema();
    expect(schema).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["id", "question", "options", "correctAnswerIndex", "explanation", "knowledgePoint"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
          correctAnswerIndex: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string" },
          knowledgePoint: { type: "string", description: "A concise concept label of at most 200 characters." },
        },
      },
    });
    expect(schema).not.toHaveProperty("minItems");
    expect(schema).not.toHaveProperty("maxItems");
  });
  it("requests thirty questions without fixed array bounds rejected by the provider", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const questions = Array.from({ length: 30 }, (_, index) => ({ ...question, id: `q${index}` }));
    generateContent.mockImplementation(request => {
      const schema = request.config.responseJsonSchema as { minItems?: number; maxItems?: number };
      if (schema.minItems !== undefined || schema.maxItems !== undefined)
        return Promise.reject({ status: 400, message: "fixed array bounds exceed the provider grammar limit" });
      return Promise.resolve({ text: JSON.stringify(questions) });
    });

    expect(await generateGeminiQuiz({ topic: "biology", count: 30 })).toHaveLength(30);
    const request = generateContent.mock.calls[0][0];
    const schema = request.config.responseJsonSchema;
    expect(request.config.systemInstruction).toContain("đúng 30 câu");
    expect(schema).not.toHaveProperty("minItems");
    expect(schema).not.toHaveProperty("maxItems");
    expect(schema.items.properties.options).toMatchObject({ minItems: 4, maxItems: 4 });
  });
  it("rejects a provider response whose question count differs from the request", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const questions = Array.from({ length: 29 }, (_, index) => ({ ...question, id: `q${index}` }));
    generateContent.mockResolvedValue({ text: JSON.stringify(questions) });

    await expect(generateGeminiQuiz({ topic: "biology", count: 30 })).rejects.toMatchObject({
      status: 502, kind: "invalid-ai-output",
    });
  });
  it("does not contact Gemini without a key", async () => {
    config.GEMINI_API_KEY = "";
    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 503 });
    expect(generateContent).not.toHaveBeenCalled();
  });
  it("rejects an attached file without source text before contacting Gemini", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    await expect(generateGeminiQuiz({ topic: "biology", documentAttached: true, count: 1 }))
      .rejects.toMatchObject({ name: "ZodError" });
    expect(generateContent).not.toHaveBeenCalled();
  });
  it("returns a specific error when the source cannot support the requested quiz", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent.mockResolvedValue({ text: "[]" });
    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: sourceText, count: 1,
    })).rejects.toMatchObject({ status: 422, kind: "insufficient-study-material" });
  });
  it("repairs one empty response from a substantial study guide without changing its source or requested count", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent
      .mockResolvedValueOnce({ text: "[]" })
      .mockResolvedValueOnce({ text: JSON.stringify(studyGuideQuestions) });

    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    })).resolves.toEqual(studyGuideQuestions);

    expect(generateContent).toHaveBeenCalledTimes(2);
    const first = generateContent.mock.calls[0][0];
    const retry = generateContent.mock.calls[1][0];
    expect(JSON.parse(first.contents).studyData).toMatchObject({
      documentAttached: true, documentText: substantialStudyGuide, count: 3,
    });
    expect(retry.contents).toBe(first.contents);
    expect(JSON.parse(retry.contents).studyData.count).toBe(3);
    expect(retry.config.systemInstruction).toMatch(/lần trước/i);
    expect(retry.config.systemInstruction).not.toContain("[]");
  });
  it("repairs one response with invalid source evidence while retaining strict server validation", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const unsupportedExcerpt = {
      ...studyGuideQuestions[0], sourceExcerpt: "Một đoạn không có trong bản ôn tập.",
    };
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify([unsupportedExcerpt, ...studyGuideQuestions.slice(1)]) })
      .mockResolvedValueOnce({ text: JSON.stringify(studyGuideQuestions) });

    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    })).resolves.toEqual(studyGuideQuestions);
    expect(generateContent).toHaveBeenCalledTimes(2);
    const retryInstruction = generateContent.mock.calls[1][0].config.systemInstruction;
    expect(retryInstruction).toContain("nguyên văn");
    expect(retryInstruction).not.toContain(unsupportedExcerpt.sourceExcerpt);
  });
  it("combines individually grounded questions from two complete provider batches", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const repairWithNewQuestionId = providerRepairBatch.map((item, index) =>
      index === 1 ? { ...item, id: "repair-q2" } : item,
    );
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify(providerFirstBatch) })
      .mockResolvedValueOnce({ text: JSON.stringify(repairWithNewQuestionId) });

    const questions = await generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: providerGuideText, count: 3,
    });

    expect(questions).toHaveLength(3);
    expect(questions.map(item => item.id)).toEqual(["q1", "repair-q2", "q3"]);
    expect(questions.map(item => item.options[item.correctAnswerIndex])).toEqual([
      "Một hoặc một số cặp nucleotide",
      "Thay thế cặp nucleotide",
      "Có hại vì làm phá vỡ sự hài hòa của chuỗi axit amin",
    ]);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("drops a cross-batch id collision while filling the quiz from other grounded candidates", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const repairWithIdCollision = [
      { ...providerRepairBatch[0], id: "q2" },
      {
        id: "repair-q2", question: "Theo bảng, ảnh hưởng nào được ghi cho dạng thay thế?",
        options: ["Không đổi chiều dài", "Giảm chiều dài", "Tăng chiều dài", "Đổi toàn bộ nhiễm sắc thể"],
        correctAnswerIndex: 0,
        explanation: "Dạng thay thế cặp nucleotide không đổi chiều dài.",
        knowledgePoint: "Ảnh hưởng chiều dài gen",
        sourceExcerpt: providerFirstBatch[1].sourceExcerpt,
      },
      providerRepairBatch[2],
    ];
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify(providerFirstBatch) })
      .mockResolvedValueOnce({ text: JSON.stringify(repairWithIdCollision) });

    const questions = await generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: providerGuideText, count: 3,
    });

    expect(questions.map(item => item.id)).toEqual(["q2", "repair-q2", "q3"]);
    expect(new Set(questions.map(item => item.id)).size).toBe(3);
  });
  it("does not salvage candidates from a repair batch with the wrong count", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const invalidFirstBatch = providerFirstBatch.map((item, index) =>
      index === 0 ? { ...item, sourceExcerpt: "not present in the guide" } : item,
    );
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify(invalidFirstBatch) })
      .mockResolvedValueOnce({ text: JSON.stringify(providerRepairBatch.slice(0, 2)) });

    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: providerGuideText, count: 3,
    })).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("does not start a fallback request when less than eleven seconds remain", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    let rejectPrimary!: (error: unknown) => void;
    generateContent.mockImplementationOnce(() => new Promise((_, reject) => { rejectPrimary = reject; }));

    const operation = generateGeminiQuiz({ topic: "biology", count: 1 });
    const assertion = expect(operation).rejects.toMatchObject({ status: 504, kind: "upstream-timeout" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(89_000);
    rejectPrimary({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });

    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("does not start source repair when less than eleven seconds remain", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-key";
    let resolvePrimary!: (response: { text: string }) => void;
    generateContent.mockImplementationOnce(() => new Promise(resolve => { resolvePrimary = resolve; }));

    const operation = generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    });
    const assertion = expect(operation).rejects.toMatchObject({ status: 504, kind: "upstream-timeout" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(81_000);
    resolvePrimary({ text: "[]" });

    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("bounds primary and fallback calls while leaving enough time for source repair", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_MODEL = "gemini-primary";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    const unsupported = { ...groundedQuestion, correctAnswerIndex: 1 };
    let rejectPrimary!: (error: unknown) => void;
    let resolveFallback!: (response: { text: string }) => void;
    generateContent
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectPrimary = reject; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveFallback = resolve; }))
      .mockResolvedValueOnce({ text: JSON.stringify([groundedQuestion]) });

    const operation = generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: sourceText, count: 1,
    });
    await Promise.resolve();
    expect(generateContent.mock.calls[0][0].config.httpOptions.timeout).toBeLessThanOrEqual(55_000);
    await vi.advanceTimersByTimeAsync(55_000);
    rejectPrimary({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(generateContent.mock.calls[1][0].model).toBe("gemini-fallback");
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeLessThanOrEqual(20_000);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeGreaterThanOrEqual(11_000);
    await vi.advanceTimersByTimeAsync(20_000);
    resolveFallback({ text: JSON.stringify([unsupported]) });
    await Promise.resolve();
    await Promise.resolve();

    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(generateContent.mock.calls[2][0].config.httpOptions.timeout).toBeLessThanOrEqual(15_000);
    expect(generateContent.mock.calls[2][0].config.httpOptions.timeout).toBeGreaterThanOrEqual(11_000);
    expect(await operation).toEqual([groundedQuestion]);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });
  it("reports insufficiency only after a second empty response and explains the requested count could not be grounded", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent.mockResolvedValue({ text: "[]" });

    const failure = await generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    }).catch(error => error);
    expect(failure).toMatchObject({ status: 422, kind: "insufficient-study-material" });
    expect(failure.message).toMatch(/không tạo đủ câu hỏi có căn cứ.*số lượng đã chọn/i);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls.every(([request]) => JSON.parse(request.contents).studyData.count === 3)).toBe(true);
  });
  it("does not call source data insufficient when a grounding failure is followed by an empty response", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    const unsupportedExcerpt = {
      ...studyGuideQuestions[0], sourceExcerpt: "Một đoạn không có trong bản ôn tập.",
    };
    generateContent
      .mockResolvedValueOnce({ text: JSON.stringify([unsupportedExcerpt, ...studyGuideQuestions.slice(1)]) })
      .mockResolvedValueOnce({ text: "[]" });

    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    })).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("does not retry a provider error during output repair", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent
      .mockResolvedValueOnce({ text: "[]" })
      .mockRejectedValueOnce({ status: 429, message: "provider details must stay private" });

    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    })).rejects.toMatchObject({ status: 429, kind: "provider-quota-exceeded" });
    expect(generateContent).toHaveBeenCalledTimes(2);
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
  it.each([[503, "UNAVAILABLE"], [504, "DEADLINE_EXCEEDED"]])("falls back once within the deadline after an explicit transient response %s", async (status, providerStatus) => {
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_MODEL = "gemini-primary";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent
      .mockRejectedValueOnce({ status, message: JSON.stringify({ error: { status: providerStatus } }) })
      .mockResolvedValueOnce({ text: JSON.stringify([question]) });

    await expect(generateGeminiQuiz({ topic: "biology", count: 1 })).resolves.toEqual([question]);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls.map(([request]) => request.model)).toEqual(["gemini-primary", "gemini-fallback"]);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeGreaterThan(20_000);
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
  it("does not retry malformed output from a source-grounded request", async () => {
    config.GEMINI_API_KEY = "test-only-key";
    generateContent.mockResolvedValue({ text: "not json" });

    await expect(generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    })).rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("aborts requests after 90 seconds", async () => {
    vi.useFakeTimers(); config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockImplementation(({ config: options }) => new Promise((_, reject) => {
      options.abortSignal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
    }));
    const assertion = expect(generateGeminiQuiz({ topic: "biology", count: 1 })).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(90000); await assertion;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it("shares one 90-second deadline across the primary and fallback attempts", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    let rejectPrimary!: (error: unknown) => void;
    generateContent
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectPrimary = reject; }))
      .mockResolvedValueOnce({ text: JSON.stringify([question]) });

    const operation = generateGeminiQuiz({ topic: "biology", count: 1 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(75000);
    rejectPrimary({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeLessThanOrEqual(15000);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeGreaterThanOrEqual(11000);

    await expect(operation).resolves.toEqual([question]);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it("shares the original 90-second deadline with the source-output repair attempt", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-key";
    let resolveFirst!: (response: { text: string }) => void;
    generateContent
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockImplementationOnce(({ config: options }) => new Promise((_, reject) => {
        options.abortSignal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
      }));

    const operation = generateGeminiQuiz({
      topic: "biology", documentAttached: true, documentText: substantialStudyGuide, count: 3,
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(75_000);
    resolveFirst({ text: "[]" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeLessThanOrEqual(15_000);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeGreaterThanOrEqual(11_000);
    const assertion = expect(operation).rejects.toMatchObject({ status: 504, kind: "upstream-timeout" });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
