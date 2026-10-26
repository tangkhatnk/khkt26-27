import { describe, expect, it } from "vitest";
import {
  STUDY_GUIDE_COORDINATE_PLOT_ILLUSTRATION_WIRE_EXAMPLE,
  STUDY_GUIDE_SEQUENCE_ILLUSTRATION_WIRE_EXAMPLE,
  parseStudyGuideProviderResponse,
  studyGuideProviderResponseJsonSchema,
  studyGuideProviderResponseSchema,
  studyGuideRequestSchema,
  studyGuideResponseSchema,
} from "../src/studyGuideSchemas.js";
import { normalizeStudyGuideAiText } from "../src/studyGuideText.js";

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
const illustrations = [
  {
    kind: "sequence",
    afterSection: "examples",
    title: "Các bước giải",
    description: "Làm theo thứ tự.",
    steps: [{ label: "Tính giá trị" }, { label: "Tính hệ số góc", detail: "Lấy đạo hàm tại điểm." }],
  },
  {
    kind: "coordinate-plot",
    afterSection: "theory",
    title: "Đạo hàm tại một điểm",
    description: "Đường tiếp tuyến biểu diễn tốc độ thay đổi tại điểm được chọn.",
    xAxis: { label: "x", min: -2, max: 2 },
    yAxis: { label: "y", min: -2, max: 3 },
    series: [{ label: "f(x)", points: [[-2, 2], [-1, -1], [0, 0], [1, 1], [2, 2]] }],
    markers: [{ x: 1, y: 1, label: "Tiếp điểm" }],
  },
];

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

  it("accepts bounded typed illustrations while keeping them optional on provider and API responses", () => {
    const text = "Nội dung Markdown đủ dài để lưu tài liệu ôn tập. ".repeat(3);
    expect(studyGuideProviderResponseSchema.parse({ ...providerResponse, illustrations }).illustrations).toEqual(illustrations);
    expect(studyGuideProviderResponseSchema.parse(providerResponse)).not.toHaveProperty("illustrations");
    expect(studyGuideResponseSchema.parse({ title: "Ôn tập", text, illustrations }).illustrations).toEqual(illustrations);
    expect(studyGuideResponseSchema.parse({ title: "Ôn tập", text })).not.toHaveProperty("illustrations");
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.type).toBe("array");
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.maxItems).toBe(3);
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.items.type).toBe("string");
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.description).toMatch(/mảng.*chuỗi JSON.*16 KiB/iu);
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.description).toMatch(/sequence.*steps.*2.*8.*coordinate-plot.*xAxis.*yAxis.*series/iu);
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.description).toMatch(/afterSection.*theory.*examples.*192.*markers.*8/iu);
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.description).toContain(STUDY_GUIDE_SEQUENCE_ILLUSTRATION_WIRE_EXAMPLE);
    expect(studyGuideProviderResponseJsonSchema.properties.illustrations.description).toContain(STUDY_GUIDE_COORDINATE_PLOT_ILLUSTRATION_WIRE_EXAMPLE);
  });

  it("decodes one JSON object per illustration string before applying the strict provider schema", () => {
    const parsed = parseStudyGuideProviderResponse({
      ...providerResponse,
      illustrations: illustrations.map(value => JSON.stringify(value)),
    });

    expect(parsed.illustrations).toEqual(illustrations);
    expect(parseStudyGuideProviderResponse(providerResponse)).not.toHaveProperty("illustrations");
    expect(parseStudyGuideProviderResponse({
      ...providerResponse,
      illustrations: JSON.parse(STUDY_GUIDE_SEQUENCE_ILLUSTRATION_WIRE_EXAMPLE),
    }).illustrations?.[0]?.kind).toBe("sequence");
    expect(parseStudyGuideProviderResponse({
      ...providerResponse,
      illustrations: JSON.parse(STUDY_GUIDE_COORDINATE_PLOT_ILLUSTRATION_WIRE_EXAMPLE),
    }).illustrations?.[0]?.kind).toBe("coordinate-plot");
  });

  it.each([
    { name: "inline dollar", open: "$", close: "$" },
    { name: "display dollar", open: "$$", close: "$$" },
    { name: "inline parenthesis", open: "\\(", close: "\\)" },
    { name: "display bracket", open: "\\[", close: "\\]" },
  ])("repairs the under-escaped triangle only inside $name math", ({ open, close }) => {
    const tab = "\t";
    const parsed = parseStudyGuideProviderResponse({
      ...providerResponse,
      theory: `${providerResponse.theory}\n\n${open}${tab}riangle U${close}`,
    });

    expect(parsed.theory).toContain(`${open}\\triangle U${close}`);
    expect(parsed.theory).not.toContain(`${open}${tab}riangle U${close}`);
  });

  it("does not repair an unclosed math marker, including tabs in following code", () => {
    const tab = "\t";
    const unclosed = [
      `${providerResponse.theory}\n\nUnclosed formula: $unfinished ${tab}riangle.`,
      `Inline code: \`${tab}riangle\`.`,
      `\`\`\`text\n${tab}riangle $\n\`\`\``,
    ].join("\n");
    const parsed = parseStudyGuideProviderResponse({ ...providerResponse, theory: unclosed });

    expect(parsed.theory).toContain(`Unclosed formula: $unfinished ${tab}riangle.`);
    expect(parsed.theory).toContain(`Inline code: \`${tab}riangle\`.`);
    expect(parsed.theory).toContain(`\`\`\`text\n${tab}riangle $\n\`\`\``);
    expect(parsed.theory).not.toContain("\\triangle");
  });

  it("preserves triangle-like TeX command prefixes without a command boundary", () => {
    const tab = "\t";
    const suffix = `$${tab}riangleSuffix$`;
    const parsed = parseStudyGuideProviderResponse({
      ...providerResponse,
      theory: `${providerResponse.theory}\n\n${suffix}`,
    });

    expect(parsed.theory).toContain(suffix);
    expect(parsed.theory).not.toContain("\\triangleSuffix");
  });

  it.each([
    { name: "malformed JSON", value: ["["] },
    { name: "a non-string item", value: [illustrations[0]] },
    { name: "a non-array wire value", value: JSON.stringify(illustrations) },
    { name: "more than three items", value: Array.from({ length: 4 }, () => JSON.stringify(illustrations[0])) },
    { name: "an individual item over the UTF-8 byte limit", value: [" ".repeat(16 * 1024 + 1)] },
    { name: "a diagram rejected by the strict union", value: [JSON.stringify({ ...illustrations[0], svg: "<svg/>" })] },
  ])("rejects $name instead of dropping or wrapping provider data", ({ value }) => {
    expect(() => parseStudyGuideProviderResponse({ ...providerResponse, illustrations: value })).toThrow();
  });

  it("rejects aggregate illustration JSON text over the UTF-8 byte limit", () => {
    const encodedIllustration = JSON.stringify({
      kind: "sequence",
      afterSection: "theory",
      title: "Đ".repeat(120),
      description: "ế".repeat(240),
      steps: Array.from({ length: 8 }, () => ({ label: "ậ".repeat(80), detail: "ừ".repeat(240) })),
    });
    expect(Buffer.byteLength(encodedIllustration, "utf8")).toBeLessThan(16 * 1024);
    expect(Buffer.byteLength(encodedIllustration.repeat(2), "utf8")).toBeGreaterThan(16 * 1024);

    expect(() => parseStudyGuideProviderResponse({
      ...providerResponse,
      illustrations: [encodedIllustration, encodedIllustration],
    })).toThrow();
  });

  it.each([
    { illustrations: Array.from({ length: 4 }, () => illustrations[0]) },
    { illustrations: [{ ...illustrations[0], steps: [{ label: "Chỉ một bước" }] }] },
    { illustrations: [{ ...illustrations[1], xAxis: { ...illustrations[1].xAxis, max: Infinity } }] },
    { illustrations: [{ ...illustrations[1], series: [{ label: "f(x)", points: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [11, 11], [12, 12], [13, 13], [14, 14], [15, 15], [16, 16], [17, 17], [18, 18], [19, 19], [20, 20], [21, 21], [22, 22], [23, 23], [24, 24], [25, 25], [26, 26], [27, 27], [28, 28], [29, 29], [30, 30], [31, 31], [32, 32], [33, 33], [34, 34], [35, 35], [36, 36], [37, 37], [38, 38], [39, 39], [40, 40], [41, 41], [42, 42], [43, 43], [44, 44], [45, 45], [46, 46], [47, 47], [48, 48], [49, 49], [50, 50], [51, 51], [52, 52], [53, 53], [54, 54], [55, 55], [56, 56], [57, 57], [58, 58], [59, 59], [60, 60], [61, 61], [62, 62], [63, 63], [64, 64], [65, 65]] }] }] },
    { illustrations: [{ ...illustrations[0], svg: "<svg onload=alert(1)>" }] },
    { illustrations: [{ ...illustrations[1], imageUrl: "https://example.com/diagram.svg" }] },
    { illustrations: Array.from({ length: 3 }, () => ({
      ...illustrations[0],
      steps: Array.from({ length: 8 }, () => ({ label: "á".repeat(80), detail: "ừ".repeat(240) })),
    })) },
  ])("rejects invalid illustration input %j", invalid => {
    expect(studyGuideProviderResponseSchema.safeParse({ ...providerResponse, ...invalid }).success).toBe(false);
  });

  it("bounds sampled points across all illustrations in one guide", () => {
    const series = (label: string) => ({
      label,
      points: Array.from({ length: 64 }, (_, index) => [index, index] as [number, number]),
    });
    const plot = {
      kind: "coordinate-plot",
      afterSection: "theory",
      title: "Đồ thị",
      description: "Mẫu điểm trên hai trục.",
      xAxis: { label: "x", min: 0, max: 63 },
      yAxis: { label: "y", min: 0, max: 63 },
      series: [series("a"), series("b"), series("c")],
    };
    const overBudget = [
      plot,
      { ...plot, series: [{ label: "d", points: [[0, 0], [1, 1]] as [number, number][] }] },
    ];

    expect(studyGuideProviderResponseSchema.safeParse({ ...providerResponse, illustrations: overBudget }).success).toBe(false);
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

  it("preserves legacy and user-authored tab text in the API schema and display normalizer", () => {
    const tab = "\t";
    const text = (`Ghi chú cũ: $${tab}riangle U$; mã: \`${tab}riangle\`; ngoài công thức: ${tab}riangle. `).repeat(4).trimEnd();

    expect(studyGuideResponseSchema.parse({ title: "Biology review", text }).text).toBe(text);
    expect(normalizeStudyGuideAiText(text)).toBe(text);
  });
});
