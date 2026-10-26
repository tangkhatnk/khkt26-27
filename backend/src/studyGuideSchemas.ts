import { z } from "zod";
import { normalizeStudyGuideAiText } from "./studyGuideText.js";

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
    .transform(normalizeStudyGuideAiText)
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
    .transform(normalizeStudyGuideAiText)
    .transform(normalizeMarkdownHeadingLevels)
    .transform(value => value.trim())
    .pipe(z.string().max(STUDY_GUIDE_FIELD_LIMITS.verificationNote)),
  illustrations: studyGuideIllustrationsSchema.optional(),
}).strict();

export type StudyGuideProviderResponse = z.infer<typeof studyGuideProviderResponseSchema>;

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

const illustrationText = (description: string, maximumCharacters: number, minimumCharacters = 1) => ({
  type: "string" as const,
  description,
  minLength: minimumCharacters,
  maxLength: maximumCharacters,
});
const illustrationCoordinateJson = { type: "number" as const, minimum: -1_000_000, maximum: 1_000_000 };
const illustrationPointJson = {
  type: "array" as const,
  prefixItems: [illustrationCoordinateJson, illustrationCoordinateJson],
  minItems: 2,
  maxItems: 2,
};
const illustrationSectionJson = { type: "string" as const, enum: ["theory", "examples"] };
const sequenceIllustrationJson = {
  type: "object" as const,
  additionalProperties: false,
  required: ["kind", "afterSection", "title", "description", "steps"],
  properties: {
    kind: { type: "string" as const, enum: ["sequence"] },
    afterSection: illustrationSectionJson,
    title: illustrationText("Short diagram title.", 120),
    description: illustrationText("A concise accessible description.", 240),
    steps: {
      type: "array" as const,
      minItems: 2,
      maxItems: 8,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["label"],
        properties: {
          label: illustrationText("One step label.", 80),
          detail: illustrationText("Optional short step detail.", 240, 0),
        },
      },
    },
  },
};
const coordinatePlotIllustrationJson = {
  type: "object" as const,
  additionalProperties: false,
  required: ["kind", "afterSection", "title", "description", "xAxis", "yAxis", "series"],
  properties: {
    kind: { type: "string" as const, enum: ["coordinate-plot"] },
    afterSection: illustrationSectionJson,
    title: illustrationText("Short diagram title.", 120),
    description: illustrationText("A concise accessible description.", 240),
    xAxis: {
      type: "object" as const,
      additionalProperties: false,
      required: ["label", "min", "max"],
      properties: {
        label: illustrationText("Horizontal axis label.", 80),
        min: illustrationCoordinateJson,
        max: illustrationCoordinateJson,
      },
    },
    yAxis: {
      type: "object" as const,
      additionalProperties: false,
      required: ["label", "min", "max"],
      properties: {
        label: illustrationText("Vertical axis label.", 80),
        min: illustrationCoordinateJson,
        max: illustrationCoordinateJson,
      },
    },
    series: {
      type: "array" as const,
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["label", "points"],
        properties: {
          label: illustrationText("Series label.", 80),
          points: { type: "array" as const, minItems: 2, maxItems: 96, items: illustrationPointJson },
        },
      },
    },
    markers: {
      type: "array" as const,
      minItems: 0,
      maxItems: 8,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["x", "y", "label"],
        properties: {
          x: illustrationCoordinateJson,
          y: illustrationCoordinateJson,
          label: illustrationText("Point label.", 80),
        },
      },
    },
  },
};

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
      description: "Tối đa 3 hình minh họa phụ trợ. Chỉ trả về dữ liệu cho kind sequence hoặc coordinate-plot; không trả HTML, SVG, URL, đường dẫn, style, hàm hay biểu thức cần tính toán. Các hình mang tính minh họa và chưa được kiểm chứng.",
      items: { anyOf: [sequenceIllustrationJson, coordinatePlotIllustrationJson] },
    },
  },
};
