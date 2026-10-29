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

  it("bounds sampled points across all illustrations in one guide", () => {
    const series = (label: string) => ({
      label,
      points: Array.from({ length: 64 }, (_, index) => [index, index] as [number, number]),
    });
    const plot = {
      kind: "coordinate-plot" as const,
      afterSection: "theory" as const,
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

    const commandPrefix = parseStudyGuideProviderResponse({
      ...providerResponse,
      body: `${providerResponse.body}\n\n$${tab}riangleSuffix$`,
    });
    expect(commandPrefix.body).toContain(`$${tab}riangleSuffix$`);
    expect(commandPrefix.body).not.toContain("\\triangleSuffix");

    const unclosed = parseStudyGuideProviderResponse({
      ...providerResponse,
      body: `${providerResponse.body}\n\nUnclosed: $unfinished ${tab}riangle.\n\nCode: \`${tab}riangle\`.`,
    });
    expect(unclosed.body).toContain(`Unclosed: $unfinished ${tab}riangle.`);
    expect(unclosed.body).toContain(`Code: \`${tab}riangle\`.`);
  });

  it("preserves legacy and user-authored tabs in the public draft and display normalizer", () => {
    const tab = "\t";
    const text = `Legacy: $${tab}riangle U$; code: \`${tab}riangle\`; note: ${tab}riangle.\n${providerResponse.body}`;

    expect(studyGuideResponseSchema.parse({ title: "Legacy", text }).text).toBe(text);
    expect(normalizeStudyGuideAiText(text)).toBe(text);
  });

  it("repairs a JSON-decoded right arrow only inside closed provider math", () => {
    const backslash = String.fromCharCode(92);
    const carriageReturn = String.fromCharCode(13);
    const body = `${providerResponse.body} $A${backslash}rightarrow B$`;
    const rawJson = JSON.stringify({ ...providerResponse, body })
      .replace(`${backslash}${backslash}rightarrow`, `${backslash}rightarrow`);
    const decoded = JSON.parse(rawJson) as typeof providerResponse;

    expect(decoded.body).toContain(`$A${carriageReturn}ightarrow B$`);
    expect(studyGuideProviderResponseSchema.parse(decoded).body).toContain(`$A${backslash}rightarrow B$`);

    const literalLineFeed = `${providerResponse.body} $A\nightarrow B$`;
    expect(studyGuideProviderResponseSchema.parse({ ...providerResponse, body: literalLineFeed }).body)
      .toContain("$A\nightarrow B$");

    const nonBoundaryBody = `${providerResponse.body} $A${backslash}rightarrowx B$`;
    const nonBoundaryJson = JSON.stringify({ ...providerResponse, body: nonBoundaryBody })
      .replace(`${backslash}${backslash}rightarrowx`, `${backslash}rightarrowx`);
    expect(studyGuideProviderResponseSchema.parse(JSON.parse(nonBoundaryJson)).body)
      .toContain("$A\nightarrowx B$");

    const outsideMathBody = `${providerResponse.body} ${backslash}rightarrow B`;
    const outsideMathJson = JSON.stringify({ ...providerResponse, body: outsideMathBody })
      .replace(`${backslash}${backslash}rightarrow`, `${backslash}rightarrow`);
    expect(studyGuideProviderResponseSchema.parse(JSON.parse(outsideMathJson)).body)
      .toContain(`${String.fromCharCode(10)}ightarrow B`);

    const unclosedMath = `${providerResponse.body} $A${carriageReturn}ightarrow B`;
    expect(studyGuideProviderResponseSchema.parse({ ...providerResponse, body: unclosedMath }).body)
      .toContain("$A\nightarrow B");

    const fencedCode = `${providerResponse.body}\n\`\`\`tex\n$A${carriageReturn}ightarrow B$\n\`\`\``;
    expect(studyGuideProviderResponseSchema.parse({ ...providerResponse, body: fencedCode }).body)
      .toContain("$A\nightarrow B$");

    const fencedOnlyCloser = `${providerResponse.body} $A${backslash}rightarrow B\n\`\`\`tex\n$\n\`\`\``;
    const fencedOnlyCloserJson = JSON.stringify({ ...providerResponse, body: fencedOnlyCloser })
      .replace(`${backslash}${backslash}rightarrow`, `${backslash}rightarrow`);
    expect(studyGuideProviderResponseSchema.parse(JSON.parse(fencedOnlyCloserJson)).body)
      .toContain("$A\nightarrow B");

    const userText = `${providerResponse.body} $A${carriageReturn}ightarrow B$`;
    expect(studyGuideResponseSchema.parse({ title: "Legacy", text: userText }).text).toBe(userText);
    expect(normalizeStudyGuideAiText(userText)).toContain("$A\nightarrow B$");
    expect(normalizeStudyGuideAiText(userText)).not.toContain(`${backslash}rightarrow`);
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
