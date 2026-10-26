import { z } from "zod";
import { normalizeNewStudyGuideProviderText } from "./studyGuideText.js";

export const STUDY_GUIDE_BODY_LIMIT_BYTES = 20 * 1024;
export const STUDY_GUIDE_TEXT_LIMIT_CHARACTERS = 20_000;

export const STUDY_GUIDE_FIELD_LIMITS = {
  title: 120,
  keyPoints: 1_200,
  theory: 8_500,
  role: 1_200,
  comparison: 1_800,
  examples: 1_600,
  commonMisconceptions: 1_400,
  practicalQuestion: 250,
  answerHint: 400,
  verificationNote: 600,
  minQuestions: 3,
  maxQuestions: 5,
} as const;

const STUDY_GUIDE_MAX_ILLUSTRATIONS = 3;
const STUDY_GUIDE_MAX_ILLUSTRATION_POINTS = 192;
const STUDY_GUIDE_MAX_ILLUSTRATION_BYTES = 16 * 1024;
const illustrationTitle = z.string().trim().min(1).max(120);
const illustrationDescription = z.string().trim().min(1).max(240);
const illustrationLabel = z.string().trim().min(1).max(80);
const illustrationCoordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const illustrationSection = z.enum(["theory", "examples"]);

const sequenceIllustrationSchema = z.object({
  kind: z.literal("sequence"),
  afterSection: illustrationSection,
  title: illustrationTitle,
  description: illustrationDescription,
  steps: z.array(z.object({
    label: illustrationLabel,
    detail: z.string().trim().max(240).optional(),
  }).strict()).min(2).max(8),
}).strict();

const plotAxisSchema = z.object({
  label: illustrationLabel,
  min: illustrationCoordinate,
  max: illustrationCoordinate,
}).strict().refine(axis => axis.min < axis.max, "Axis minimum must be below its maximum.");

const coordinatePlotIllustrationSchema = z.object({
  kind: z.literal("coordinate-plot"),
  afterSection: illustrationSection,
  title: illustrationTitle,
  description: illustrationDescription,
  xAxis: plotAxisSchema,
  yAxis: plotAxisSchema,
  series: z.array(z.object({
    label: illustrationLabel,
    points: z.array(z.tuple([illustrationCoordinate, illustrationCoordinate])).min(2).max(96),
  }).strict()).min(1).max(3),
  markers: z.array(z.object({
    x: illustrationCoordinate,
    y: illustrationCoordinate,
    label: illustrationLabel,
  }).strict()).max(8).optional(),
}).strict().superRefine((plot, context) => {
  for (const [seriesIndex, series] of plot.series.entries()) {
    for (const [pointIndex, [x, y]] of series.points.entries()) {
      if (x < plot.xAxis.min || x > plot.xAxis.max || y < plot.yAxis.min || y > plot.yAxis.max)
        context.addIssue({ code: "custom", path: ["series", seriesIndex, "points", pointIndex], message: "Plot points must be within both axis ranges." });
    }
  }
  for (const [markerIndex, marker] of (plot.markers ?? []).entries()) {
    if (marker.x < plot.xAxis.min || marker.x > plot.xAxis.max || marker.y < plot.yAxis.min || marker.y > plot.yAxis.max)
      context.addIssue({ code: "custom", path: ["markers", markerIndex], message: "Plot markers must be within both axis ranges." });
  }
});

const studyGuideIllustrationSchema = z.discriminatedUnion("kind", [
  sequenceIllustrationSchema,
  coordinatePlotIllustrationSchema,
]);

const studyGuideIllustrationsSchema = z.array(studyGuideIllustrationSchema).max(STUDY_GUIDE_MAX_ILLUSTRATIONS)
  .superRefine((illustrations, context) => {
    const pointCount = illustrations.reduce((total, illustration) => total +
      (illustration.kind === "coordinate-plot"
        ? illustration.series.reduce((seriesTotal, series) => seriesTotal + series.points.length, 0)
        : 0), 0);
    if (pointCount > STUDY_GUIDE_MAX_ILLUSTRATION_POINTS)
      context.addIssue({ code: "custom", message: "Study-guide illustrations contain too many sampled points." });
    if (Buffer.byteLength(JSON.stringify(illustrations), "utf8") > STUDY_GUIDE_MAX_ILLUSTRATION_BYTES)
      context.addIssue({ code: "custom", message: "Study-guide illustrations exceed the byte limit." });
  });

// The provider fields total at most 19,550 characters; formatting adds at most 236.
// Field-level validation runs after heading normalization, keeping accepted drafts below 20,000.

export const studyGuideRequestSchema = z.object({
  topic: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(10).max(4000),
  goal: z.string().trim().min(1).max(500).optional(),
}).strict();

export type StudyGuideInput = z.infer<typeof studyGuideRequestSchema>;

function normalizeMarkdownHeadingLevels(value: string) {
  const lines = value.split(/\r?\n/u);
  const normalizedLines: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | undefined;

  for (const line of lines) {
    const fenceStart = line.match(/^[\t ]*(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const close = new RegExp(`^[\\t ]*${fence.marker}{${fence.length},}[\\t ]*$`, "u");
      if (close.test(line)) fence = undefined;
      normalizedLines.push(line);
      continue;
    }
    if (fenceStart) {
      fence = { marker: fenceStart[0] as "`" | "~", length: fenceStart.length };
      normalizedLines.push(line);
      continue;
    }

    const setextUnderline = /^ {0,3}(?:=+|-+)[\t ]*$/u.test(line);
    const precedingLine = normalizedLines.at(-1);
    if (setextUnderline && precedingLine?.trim()) {
      const prefix = precedingLine.match(/^([ \t]{0,3}(?:(?:>\s*)*)(?:(?:[-+*]|\d+[.)])\s+)?)(.*)$/u)?.[1] ?? "";
      const headingText = precedingLine.slice(prefix.length).trim();
      if (headingText && !/^#{1,6}(?:\s|$)/u.test(headingText)) {
        normalizedLines[normalizedLines.length - 1] = `${prefix}### ${headingText}`;
        normalizedLines.push("");
        continue;
      }
    }

    normalizedLines.push(line.replace(
      /^([ \t]*(?:(?:>\s*)*)(?:(?:[-+*]|\d+[.)])\s+)?)(#{1,2})(?=[\t ]|$)/u,
      "$1###",
    ));
  }

  return normalizedLines.join("\n");
}

function markdownBody(minimumCharacters: number, maximumCharacters: number) {
  return z.string().trim()
    .transform(normalizeNewStudyGuideProviderText)
    .transform(normalizeMarkdownHeadingLevels)
    .transform(value => value.trim())
    .pipe(z.string().min(minimumCharacters).max(maximumCharacters));
}

const sectionBody = (maximumCharacters: number) => markdownBody(100, maximumCharacters);
const question = markdownBody(20, STUDY_GUIDE_FIELD_LIMITS.practicalQuestion);
const answerHint = markdownBody(20, STUDY_GUIDE_FIELD_LIMITS.answerHint);

const practicePair = z.object({ question, answerHint }).strict();
const practice = z.array(practicePair)
  .min(STUDY_GUIDE_FIELD_LIMITS.minQuestions)
  .max(STUDY_GUIDE_FIELD_LIMITS.maxQuestions);

export const studyGuideProviderResponseSchema = z.object({
  title: z.string().trim().min(1).max(STUDY_GUIDE_FIELD_LIMITS.title),
  keyPoints: markdownBody(80, STUDY_GUIDE_FIELD_LIMITS.keyPoints),
  theory: markdownBody(500, STUDY_GUIDE_FIELD_LIMITS.theory),
  role: sectionBody(STUDY_GUIDE_FIELD_LIMITS.role),
  comparison: sectionBody(STUDY_GUIDE_FIELD_LIMITS.comparison),
  examples: sectionBody(STUDY_GUIDE_FIELD_LIMITS.examples),
  commonMisconceptions: sectionBody(STUDY_GUIDE_FIELD_LIMITS.commonMisconceptions),
  practice,
  verificationNote: z.string().trim()
    .transform(normalizeNewStudyGuideProviderText)
    .transform(normalizeMarkdownHeadingLevels)
    .transform(value => value.trim())
    .pipe(z.string().max(STUDY_GUIDE_FIELD_LIMITS.verificationNote)),
  illustrations: studyGuideIllustrationsSchema.optional(),
}).strict();

export type StudyGuideProviderResponse = z.infer<typeof studyGuideProviderResponseSchema>;

/** Decode one JSON string per illustration, then apply the unchanged strict contract. */
export function parseStudyGuideProviderResponse(value: unknown): StudyGuideProviderResponse {
  if (value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, "illustrations")) {
    const providerResponse = value as Record<string, unknown>;
    const encodedIllustrations = providerResponse.illustrations;
    if (!Array.isArray(encodedIllustrations) || encodedIllustrations.length > STUDY_GUIDE_MAX_ILLUSTRATIONS)
      throw new Error("Study-guide illustrations must be a bounded array of JSON strings.");
    let totalBytes = 0;
    const illustrations = encodedIllustrations.map(encodedIllustration => {
      if (typeof encodedIllustration !== "string")
        throw new Error("Each study-guide illustration must be a JSON string.");
      const bytes = Buffer.byteLength(encodedIllustration, "utf8");
      if (bytes > STUDY_GUIDE_MAX_ILLUSTRATION_BYTES)
        throw new Error("A study-guide illustration exceeds the byte limit.");
      totalBytes += bytes;
      if (totalBytes > STUDY_GUIDE_MAX_ILLUSTRATION_BYTES)
        throw new Error("Study-guide illustrations exceed the total byte limit.");
      return JSON.parse(encodedIllustration);
    });
    return studyGuideProviderResponseSchema.parse({
      ...providerResponse,
      illustrations,
    });
  }
  return studyGuideProviderResponseSchema.parse(value);
}

/** External API contract stays an editable Markdown draft with title and text. */
export const studyGuideResponseSchema = z.object({
  title: z.string().trim().min(1).max(STUDY_GUIDE_FIELD_LIMITS.title),
  text: z.string().trim().min(100).max(STUDY_GUIDE_TEXT_LIMIT_CHARACTERS),
  illustrations: studyGuideIllustrationsSchema.optional(),
}).strict();

function boundedText(description: string, maximumCharacters: number, minimumCharacters = 100) {
  return {
    type: "string" as const,
    description: `${description} Độ dài từ ${minimumCharacters.toLocaleString("en-US")} đến ${maximumCharacters.toLocaleString("en-US")} ký tự sau khi chuẩn hóa tiêu đề Markdown; máy chủ xác thực giới hạn này.`,
  };
}

export const STUDY_GUIDE_SEQUENCE_ILLUSTRATION_WIRE_EXAMPLE = JSON.stringify([JSON.stringify({
  kind: "sequence",
  afterSection: "theory",
  title: "Tiêu đề",
  description: "Mô tả sơ đồ.",
  steps: [{ label: "Nhãn 1" }, { label: "Nhãn 2" }],
})]);
export const STUDY_GUIDE_COORDINATE_PLOT_ILLUSTRATION_WIRE_EXAMPLE = JSON.stringify([JSON.stringify({
  kind: "coordinate-plot",
  afterSection: "theory",
  title: "Tiêu đề",
  description: "Mô tả sơ đồ.",
  xAxis: { label: "x", min: 0, max: 1 },
  yAxis: { label: "y", min: 0, max: 1 },
  series: [{ label: "Chuỗi 1", points: [[0, 0], [1, 1]] }],
})]);

export const STUDY_GUIDE_ILLUSTRATIONS_JSON_DESCRIPTION =
  `Trường illustrations là tùy chọn. Khi có ích, hãy trả về mảng 0–3 chuỗi JSON; mỗi chuỗi mã hóa đúng một đối tượng minh họa, tổng UTF-8 của tất cả chuỗi không quá 16 KiB và mỗi chuỗi cũng không quá 16 KiB. Nếu không có hình hữu ích, bỏ hẳn trường. Mọi hình bắt buộc có afterSection (chỉ theory hoặc examples), title (1–120 ký tự sau trim) và description (1–240 ký tự sau trim). Dạng sequence có đúng các khóa bắt buộc {kind: sequence, afterSection, title, description, steps}; steps có 2–8 phần tử, mỗi phần tử có label (1–80 ký tự) và detail tùy chọn (tối đa 240 ký tự). Ví dụ format-only hợp lệ cho sequence: ${STUDY_GUIDE_SEQUENCE_ILLUSTRATION_WIRE_EXAMPLE}. Dạng coordinate-plot có đúng các khóa bắt buộc {kind: coordinate-plot, afterSection, title, description, xAxis, yAxis, series}; mỗi trục có đúng {label, min, max}, label 1–80 ký tự, min và max là số hữu hạn trong [-1.000.000, 1.000.000] với min < max. series có 1–3 phần tử, mỗi phần tử có đúng {label, points}; label 1–80 ký tự và points có 2–96 cặp [x, y] hữu hạn trong khoảng của cả hai trục. Tổng số điểm trên mọi coordinate-plot tối đa 192 điểm. markers là khóa tùy chọn của coordinate-plot, tối đa 8 phần tử {x, y, label}; tọa độ hữu hạn và nằm trong khoảng trục, label 1–80 ký tự. Ví dụ format-only hợp lệ cho coordinate-plot: ${STUDY_GUIDE_COORDINATE_PLOT_ILLUSTRATION_WIRE_EXAMPLE}. Chỉ dùng đúng các khóa đã nêu, không trộn khóa giữa hai dạng; bỏ các khóa không áp dụng và khóa tùy chọn khi không dùng. Không HTML, SVG, URL, đường dẫn, style, hàm hoặc biểu thức cần tính toán; nhãn là văn bản thuần. Hình chỉ mang tính minh họa, chưa được kiểm chứng.`;

export const studyGuideProviderResponseJsonSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: [
    "title", "keyPoints", "theory", "role", "comparison", "examples",
    "commonMisconceptions", "practice", "verificationNote",
  ],
  properties: {
    title: boundedText("Tiêu đề tài liệu ôn tập.", STUDY_GUIDE_FIELD_LIMITS.title, 1),
    keyPoints: boundedText("Mục 1. Ý chính, viết gọn.", STUDY_GUIDE_FIELD_LIMITS.keyPoints, 80),
    theory: boundedText("Mục 2. Lý thuyết, phần trọng tâm và chi tiết nhất.", STUDY_GUIDE_FIELD_LIMITS.theory, 500),
    role: boundedText("Mục 3. Vai trò.", STUDY_GUIDE_FIELD_LIMITS.role),
    comparison: boundedText("Mục 4. So sánh.", STUDY_GUIDE_FIELD_LIMITS.comparison),
    examples: boundedText("Mục 5. Ví dụ minh họa.", STUDY_GUIDE_FIELD_LIMITS.examples),
    commonMisconceptions: boundedText("Mục 6. Nhầm lẫn thường gặp.", STUDY_GUIDE_FIELD_LIMITS.commonMisconceptions),
    practice: {
      type: "array" as const,
      minItems: STUDY_GUIDE_FIELD_LIMITS.minQuestions,
      maxItems: STUDY_GUIDE_FIELD_LIMITS.maxQuestions,
      description: "Mục 7 và 8. Từ 3 đến 5 cặp câu hỏi thực tế và gợi ý đáp án; mỗi gợi ý nằm trong cùng đối tượng với câu hỏi tương ứng.",
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["question", "answerHint"],
        properties: {
          question: boundedText("Mục 7. Một câu hỏi thực tế.", STUDY_GUIDE_FIELD_LIMITS.practicalQuestion, 20),
          answerHint: boundedText("Mục 8. Gợi ý lập luận cho câu hỏi này.", STUDY_GUIDE_FIELD_LIMITS.answerHint, 20),
        },
      },
    },
    verificationNote: boundedText("Ghi chú giả định hoặc thông tin cần kiểm chứng; để rỗng nếu không cần.", STUDY_GUIDE_FIELD_LIMITS.verificationNote, 0),
    illustrations: {
      type: "array" as const,
      minItems: 0,
      maxItems: STUDY_GUIDE_MAX_ILLUSTRATIONS,
      description: STUDY_GUIDE_ILLUSTRATIONS_JSON_DESCRIPTION,
      items: {
        type: "string" as const,
        description: "Một chuỗi JSON hợp lệ mã hóa đúng một đối tượng sequence hoặc coordinate-plot theo lược đồ mô tả ở trên.",
      },
    },
  },
};
