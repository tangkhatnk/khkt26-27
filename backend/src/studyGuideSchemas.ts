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
}).strict();

export type StudyGuideProviderResponse = z.infer<typeof studyGuideProviderResponseSchema>;

/** External API contract stays an editable Markdown draft with title and text. */
export const studyGuideResponseSchema = z.object({
  title: z.string().trim().min(1).max(STUDY_GUIDE_FIELD_LIMITS.title),
  text: z.string().trim().min(100).max(STUDY_GUIDE_TEXT_LIMIT_CHARACTERS),
}).strict();

function boundedText(description: string, maximumCharacters: number, minimumCharacters = 100) {
  return {
    type: "string" as const,
    description: `${description} Độ dài từ ${minimumCharacters.toLocaleString("en-US")} đến ${maximumCharacters.toLocaleString("en-US")} ký tự sau khi chuẩn hóa tiêu đề Markdown; máy chủ xác thực giới hạn này.`,
  };
}

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
  },
};
