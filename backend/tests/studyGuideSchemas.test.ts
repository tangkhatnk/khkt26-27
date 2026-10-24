import { describe, expect, it } from "vitest";
import {
  studyGuideProviderResponseJsonSchema,
  studyGuideProviderResponseSchema,
  studyGuideRequestSchema,
  studyGuideResponseSchema,
} from "../src/studyGuideSchemas.js";

const providerResponse = {
  title: "Biology review",
  keyPoints: "Quang hợp chuyển năng lượng ánh sáng thành năng lượng hóa học. Cây dùng quá trình này để tạo chất hữu cơ và duy trì hoạt động sống.",
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

describe("study guide request contract", () => {
  it("accepts prompt-only requests and trims their bounded fields", () => {
    expect(studyGuideRequestSchema.parse({
      topic: " biology ",
      prompt: "  Explain photosynthesis for a beginner.  ",
      goal: "  Prepare for a biology exam.  ",
    })).toEqual({
      topic: "biology",
      prompt: "Explain photosynthesis for a beginner.",
      goal: "Prepare for a biology exam.",
    });
  });

  it.each([
    { topic: "", prompt: "Explain photosynthesis for a beginner." },
    { topic: "biology", prompt: "short" },
    { topic: "biology", prompt: "x".repeat(4001) },
    { topic: "x".repeat(101), prompt: "Explain photosynthesis for a beginner." },
    { topic: "biology", prompt: "Explain photosynthesis for a beginner.", goal: "x".repeat(501) },
    { topic: "biology", prompt: "Explain photosynthesis for a beginner.", extra: true },
  ])("rejects invalid prompt request %j", input => {
    expect(studyGuideRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe("study guide response contracts", () => {
  it("accepts all eight structured section bodies and an optional verification note", () => {
    expect(studyGuideProviderResponseSchema.safeParse(providerResponse).success).toBe(true);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      verificationNote: "Đối chiếu thuật ngữ với giáo trình của lớp.",
    }).success).toBe(true);
  });

  it("normalizes escaped newlines in AI Markdown while preserving TeX and code literals", () => {
    const backslash = String.fromCharCode(92);
    const escapedBreak = `${backslash}n`;
    const comparison = [
      `${"Đối chiếu các chất theo tiêu chí và vai trò trong phản ứng. ".repeat(3)}`, "",
      "| Chất | Công thức |", "| --- | --- |", "| Bạc nitrat | $AgNO_3$ |",
    ].join(escapedBreak);
    const theory = [
      `${"Xem xét từng bước để phân biệt chất tham gia và sản phẩm trong phản ứng hóa học. ".repeat(8)}`, "", "```js",
      `const marker = "line${backslash}nnext";`, "```",
      `Ký hiệu tần số là $${backslash}nu$.`,
    ].join(escapedBreak);

    const parsed = studyGuideProviderResponseSchema.parse({ ...providerResponse, comparison, theory });

    expect(parsed.comparison).toBe(comparison.replaceAll(escapedBreak, "\n"));
    expect(parsed.theory).toContain(`$${backslash}nu$`);
    expect(parsed.theory).toContain(`const marker = "line${backslash}nnext";`);
    expect(parsed.theory).toContain("```js\n");
  });

  it("rejects missing sections and theory that is too brief to support a detailed guide", () => {
    const missingSection = { ...providerResponse } as Record<string, unknown>;
    delete missingSection.comparison;
    expect(studyGuideProviderResponseSchema.safeParse(missingSection).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      theory: "Quang hợp tạo chất hữu cơ.",
    }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      practice: providerResponse.practice.slice(0, 2),
    }).success).toBe(false);
  });

  it("rejects empty or partial practice pairs rather than guessing question-answer alignment", () => {
    const emptyPair = { question: " \n ", answerHint: "\t" };
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      practice: [...providerResponse.practice, emptyPair],
    }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      practice: [providerResponse.practice[0], emptyPair, ...providerResponse.practice.slice(1)],
    }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      practice: [...providerResponse.practice, { question: "Một câu hỏi thứ tư có nội dung rõ ràng?", answerHint: "" }],
    }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      practice: [...providerResponse.practice, { ...emptyPair, unexpected: true }],
    }).success).toBe(false);
  });

  it("describes per-field character caps and uses Gemini-supported item bounds", () => {
    const properties = studyGuideProviderResponseJsonSchema.properties;
    expect(properties.title.description).toContain("Độ dài từ 1 đến 120");
    expect(properties.keyPoints.description).toContain("1,200");
    expect(properties.theory.description).toContain("8,500");
    expect(properties.keyPoints.description).toContain("từ 80 đến");
    expect(properties.theory.description).toContain("từ 500 đến");
    expect(properties.practice).toMatchObject({ minItems: 3, maxItems: 5 });
    expect(properties.practice.items.properties.question.description).toContain("250");
    expect(properties.practice.items.properties.answerHint.description).toContain("400");
    expect(properties.practice.items.properties.question.description).toContain("từ 20 đến");
    expect(properties.practice.items.required).toEqual(["question", "answerHint"]);
    expect(properties.verificationNote.description).toContain("600");
    expect(properties.keyPoints).not.toHaveProperty("maxLength");
    expect(properties.theory).not.toHaveProperty("maxLength");
  });

  it("enforces the documented character caps after heading normalization", () => {
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      keyPoints: "k".repeat(1_201),
    }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      theory: "t".repeat(8_501),
    }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({
      ...providerResponse,
      practice: [
        ...providerResponse.practice.slice(0, 2),
        { question: "q".repeat(251), answerHint: providerResponse.practice[2].answerHint },
      ],
    }).success).toBe(false);
  });

  it("keeps the external editable title and Markdown body bounds without requiring a legacy note heading", () => {
    const backslash = String.fromCharCode(92);
    const literalEscapes = `User text ${backslash}n${backslash}n stays unchanged.`.repeat(4);
    expect(studyGuideResponseSchema.safeParse({
      title: "Biology review",
      text: `## 1. Ý chính\n${"Quang hợp chuyển năng lượng ánh sáng thành năng lượng hóa học. ".repeat(4)}`,
    }).success).toBe(true);
    expect(studyGuideResponseSchema.safeParse({
      title: "x".repeat(121),
      text: "x".repeat(100),
    }).success).toBe(false);
    expect(studyGuideResponseSchema.safeParse({
      title: "Biology review",
      text: "x".repeat(20_001),
    }).success).toBe(false);
    expect(studyGuideResponseSchema.parse({ title: "Biology review", text: literalEscapes }).text).toBe(literalEscapes);
  });
});
