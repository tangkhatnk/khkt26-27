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
  title: "Từ vựng thể thao",
  body: "## Từ vựng\n- *football*: bóng đá\n- *swimming*: bơi lội\n- *volleyball*: bóng chuyền",
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
  it("accepts concise free-form Markdown without fixed sections or a verification note", () => {
    expect(studyGuideProviderResponseSchema.parse(providerResponse)).toEqual({
      ...providerResponse,
      body: "### Từ vựng\n- *football*: bóng đá\n- *swimming*: bơi lội\n- *volleyball*: bóng chuyền",
    });
    expect(studyGuideProviderResponseJsonSchema.required).toEqual(["title", "body"]);
    expect(studyGuideProviderResponseJsonSchema.properties.body.description).toMatch(/10.*19,300/u);
    expect(studyGuideProviderResponseSchema.parse({
      ...providerResponse,
      verificationNote: "Kiểm tra cách viết tên giải đấu theo nguồn hiện hành.",
    }).verificationNote).toBe("Kiểm tra cách viết tên giải đấu theo nguồn hiện hành.");
  });

  it("rejects missing, brief, oversized, and unexpected provider fields", () => {
    expect(studyGuideProviderResponseSchema.safeParse({ title: providerResponse.title }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({ ...providerResponse, body: "short" }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({ ...providerResponse, body: "x".repeat(19_301) }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({ ...providerResponse, extra: true }).success).toBe(false);
    expect(studyGuideProviderResponseSchema.safeParse({ ...providerResponse, verificationNote: "n".repeat(601) }).success).toBe(false);
  });

  it("decodes bounded illustration objects while keeping illustration metadata optional", () => {
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

    const properties = studyGuideProviderResponseJsonSchema.properties;
    expect(properties.illustrations).toMatchObject({ type: "array", maxItems: 3 });
    expect(properties.illustrations.items.type).toBe("string");
    expect(properties.illustrations.description).toMatch(/mảng.*chuỗi JSON.*16 KiB/iu);
  });

  it.each([
    ["malformed illustration JSON", ["["]],
    ["an illustration item over the byte limit", [" ".repeat(16 * 1024 + 1)]],
    ["a non-array illustration value", JSON.stringify(illustrations)],
    ["a non-string illustration item", [illustrations[0]]],
    ["a diagram rejected by the strict union", [JSON.stringify({ ...illustrations[0], svg: "<svg/>" })]],
  ])("rejects %s instead of dropping or wrapping provider data", (_name, value) => {
    expect(() => parseStudyGuideProviderResponse({ ...providerResponse, illustrations: value })).toThrow();
  });

  it("normalizes provider Markdown headings and escaped line breaks without changing code or TeX", () => {
    const backslash = String.fromCharCode(92);
    const escapedBreak = `${backslash}n`;
    const body = [
      "Vocabulary", "", "# Match terms", "## Example", "Setext heading", "===", "", "```js",
      `const marker = "line${backslash}nnext";`, "```", `Formula: $${backslash}nu$.`,
    ].join(escapedBreak);

    const parsed = studyGuideProviderResponseSchema.parse({ ...providerResponse, body });

    expect(parsed.body).toContain("### Match terms\n### Example\n### Setext heading");
    expect(parsed.body).toContain(`const marker = "line${backslash}nnext";`);
    expect(parsed.body).toContain(`Formula: $${backslash}nu$.`);
    expect(parsed.body).not.toContain(`${backslash}n###`);
  });

  it("repairs an under-escaped triangle only inside closed provider math", () => {
    const tab = "\t";
    const parsed = parseStudyGuideProviderResponse({
      ...providerResponse,
      body: `${providerResponse.body}\n\n$${tab}riangle U = A + Q$`,
    });
    expect(parsed.body).toContain("$\\triangle U = A + Q$");
    expect(parsed.body).not.toContain(`$${tab}riangle U = A + Q$`);

    const unclosed = parseStudyGuideProviderResponse({
      ...providerResponse,
      body: `${providerResponse.body}\n\nUnclosed: $unfinished ${tab}riangle.\n\nCode: \`${tab}riangle\`.`,
    });
    expect(unclosed.body).toContain(`Unclosed: $unfinished ${tab}riangle.`);
    expect(unclosed.body).toContain(`Code: \`${tab}riangle\`.`);
  });

  it("keeps the public editable title and text contract bounded and accepts short requested content", () => {
    const text = "- football: bóng đá\n- swimming: bơi lội";
    const literalEscapes = `User text ${String.fromCharCode(92)}n stays unchanged.`;
    expect(studyGuideResponseSchema.parse({ title: "Sports vocabulary", text }).text).toBe(text);
    expect(studyGuideResponseSchema.safeParse({ title: "Sports", text: "short" }).success).toBe(false);
    expect(studyGuideResponseSchema.safeParse({ title: "x".repeat(121), text }).success).toBe(false);
    expect(studyGuideResponseSchema.safeParse({ title: "Sports", text: "x".repeat(20_001) }).success).toBe(false);
    expect(studyGuideResponseSchema.parse({ title: "Sports", text: literalEscapes }).text).toBe(literalEscapes);
    expect(normalizeStudyGuideAiText(literalEscapes)).toBe("User text \n stays unchanged.");
  });
});
