import { z } from "zod";

/** Contract for the singular /quiz/generate endpoint. */
export const geminiRequestSchema = z.object({
  topic: z.string().trim().min(1).max(50).regex(/^[a-z0-9-]+$/),
  goal: z.string().trim().min(1).max(500).optional(),
  documentText: z.string().trim().min(10).max(50000).optional(),
  documentAttached: z.boolean().default(false),
  count: z.number().int().min(1).max(30).default(3),
}).strict().superRefine((value, context) => {
  if (value.documentAttached && !value.documentText)
    context.addIssue({
      code: "custom",
      path: ["documentText"],
      message: "An attached study file must have recognized source text",
    });
});

function optionUniquenessKey(option: string) {
  const normalized = option.trim().replace(/\s+/gu, " ");
  if (splitDelimitedMath(normalized).some(part => part.kind === "math"))
    return normalizeExcerptEvidence(normalized);
  return hasExplicitMathSyntax(normalized) ? normalized : normalized.toLocaleLowerCase("vi");
}

export const geminiQuestionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(500)).length(4)
    .refine(options => new Set(options.map(optionUniquenessKey)).size === 4,
      "Answer options must be distinct"),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(4000),
  knowledgePoint: z.string().trim().min(1).max(200).optional(),
  sourceExcerpt: z.string().trim().min(5).max(1000).optional(),
}).strict();

export type GenerateQuizInput = z.input<typeof geminiRequestSchema>;
export type GeneratedQuizQuestion = z.infer<typeof geminiQuestionSchema>;

export class QuizGroundingError extends Error {
  constructor(public reason: "missing-excerpt" | "ungrounded-answer") {
    super(reason === "missing-excerpt"
      ? "AI question has no exact source excerpt"
      : "AI question is not grounded in its source excerpt");
  }
}

export type GroundedQuizCandidates = {
  questions: GeneratedQuizQuestion[];
  groundingFailure?: QuizGroundingError["reason"];
};

function normalizeEvidence(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("vi").replace(/đ/gu, "d")
    .replace(/\s+/g, " ").trim();
}

type EvidencePart = { kind: "text" | "math"; value: string };

function splitDelimitedMath(text: string): EvidencePart[] {
  const parts: EvidencePart[] = [];
  const mathDelimiters = /\$\$([\s\S]*?)\$\$|\$(?!\$)([^$\n]+?)\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/gu;
  let cursor = 0;
  for (const match of text.matchAll(mathDelimiters)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", value: text.slice(cursor, index) });
    const expression = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    parts.push({ kind: "math", value: expression.trim() });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "text", value: text.slice(cursor) });
  return parts;
}

function markReferenceMath(parts: EvidencePart[], expressions: readonly string[]) {
  let result = parts;
  for (const expression of expressions) {
    if (!expression) continue;
    const next: EvidencePart[] = [];
    for (const part of result) {
      if (part.kind === "math") {
        next.push(part);
        continue;
      }
      let cursor = 0;
      let index = part.value.indexOf(expression, cursor);
      while (index >= 0) {
        if (!hasMathTokenBoundaries(part.value, index, expression)) {
          index = part.value.indexOf(expression, index + 1);
          continue;
        }
        if (index > cursor) next.push({ kind: "text", value: part.value.slice(cursor, index) });
        next.push({ kind: "math", value: expression });
        cursor = index + expression.length;
        index = part.value.indexOf(expression, cursor);
      }
      if (cursor < part.value.length) next.push({ kind: "text", value: part.value.slice(cursor) });
    }
    result = next;
  }
  return result;
}

function isWordCharacter(character: string | undefined) {
  return character !== undefined && /[\p{L}\p{N}_]/u.test(character);
}

function hasMathTokenBoundaries(text: string, index: number, expression: string) {
  const first = Array.from(expression)[0];
  const last = Array.from(expression).at(-1);
  const previous = Array.from(text.slice(0, index)).at(-1);
  const next = Array.from(text.slice(index + expression.length))[0];
  return (!isWordCharacter(first) || !isWordCharacter(previous)) &&
    (!isWordCharacter(last) || !isWordCharacter(next));
}

const sourceMathTokenPattern = /\\[A-Za-z]+|[\p{L}]+|\d+(?:[.,]\d+)?|[=<>≤≥≠≈+\-−±×÷*/^_'()[\]{}|]/gu;
const inlineMathAtom = String.raw`(?:\\[A-Za-z]+(?:\s*(?:\([^()\n]*\)|\{[^{}\n]*\}|\|[^|\n]*\|))*|\p{L}\s*\([^()\n]*\)|\p{L}|\d+(?:[.,]\d+)?)`;
const inlineMathFormulaPattern = new RegExp(
  `(?<![\\p{L}\\p{N}_])${inlineMathAtom}(?:\\s*[=<>≤≥≠≈+\\-−±×÷*/^_]\\s*${inlineMathAtom})+(?![\\p{L}\\p{N}_])`,
  "gu",
);
const inlineMathTokenPattern = /(?<![\p{L}\p{N}_])(?:\\[A-Za-z]+(?:\s*(?:\([^()\n]*\)|\{[^{}\n]*\}|\|[^|\n]*\|))*|\p{L}\s*\([^()\n]*\))(?![\p{L}\p{N}_])/gu;

function markInlineMathSyntax(parts: EvidencePart[]) {
  return parts.flatMap(part => {
    if (part.kind === "math") return [part];
    const marked: EvidencePart[] = [];
    let cursor = 0;
    const matches = [
      ...part.value.matchAll(inlineMathFormulaPattern),
      ...part.value.matchAll(inlineMathTokenPattern),
    ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0) || right[0].length - left[0].length);
    for (const match of matches) {
      const index = match.index ?? 0;
      if (index < cursor) continue;
      if (index > cursor) marked.push({ kind: "text", value: part.value.slice(cursor, index) });
      marked.push({ kind: "math", value: match[0] });
      cursor = index + match[0].length;
    }
    if (cursor < part.value.length) marked.push({ kind: "text", value: part.value.slice(cursor) });
    return marked;
  });
}

function normalizeEvidenceSegment(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("vi").replace(/đ/gu, "d")
    .replace(/\s+/gu, " ");
}

function normalizeExactExcerptWhitespace(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

function normalizeExcerptEvidence(text: string, referenceMathExpressions: readonly string[] = []) {
  let parts = markInlineMathSyntax(splitDelimitedMath(text));
  if (referenceMathExpressions.length) {
    const tokens = referenceMathExpressions.flatMap(expression => expression.match(sourceMathTokenPattern) ?? []);
    const caseVariants = tokens.flatMap(token => /^\p{L}$/u.test(token)
      ? [token, token.toLocaleLowerCase("vi"), token.toLocaleUpperCase("vi")]
      : [token]);
    const expressions = Array.from(new Set([...referenceMathExpressions, ...caseVariants]))
      .sort((a, b) => b.length - a.length);
    parts = markReferenceMath(parts, expressions);
  }
  return parts.map(part => part.kind === "math"
    ? part.value
    : normalizeEvidenceSegment(part.value)).join("").trim();
}

function hasExplicitMathSyntax(text: string) {
  return splitDelimitedMath(text).some(part => part.kind === "math") ||
    /\\(?:[A-Za-z]+|[()[\]])/u.test(text) ||
    /(?<![\p{L}\p{N}_])(?:\p{L}\s*\([^()\n]*\)|\p{L}|\d+(?:[.,]\d+)?)\s*(?:[=<>≤≥≠≈+\-−±×÷*/^_])\s*(?:\p{L}\s*\([^()\n]*\)|\p{L}|\d+(?:[.,]\d+)?)(?![\p{L}\p{N}_])/u.test(text);
}

const evidenceStopWords = new Set([
  "about", "after", "again", "also", "among", "and", "are", "because", "before", "between", "but", "can", "could", "does", "for", "from", "had", "has", "have", "her", "his", "into", "its", "more", "most", "not", "other", "should", "their", "there", "these", "they", "this", "those", "the", "through", "under", "using", "was", "which", "while", "with", "would", "you",
  "cac", "cua", "cho", "dang", "day", "den", "duoc", "hay", "khi", "khong", "la", "ma", "mot", "nay", "nen", "nhu", "nhung", "theo", "thi", "trong", "tu", "va", "voi",
]);

function hasSourceGrounding(
  question: GeneratedQuizQuestion,
  sourceExcerpt: string,
  sourceMathExpressions: readonly string[],
) {
  const normalizedExcerpt = normalizeExcerptEvidence(sourceExcerpt, sourceMathExpressions);
  const normalizedExcerptForTerms = normalizeEvidence(sourceExcerpt);
  const answer = question.options[question.correctAnswerIndex];
  const answerIsMath = hasExplicitMathSyntax(answer);
  const normalizedAnswer = normalizeExcerptEvidence(answer, sourceMathExpressions);
  const escapedAnswer = normalizedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A phrase must stand on its own: "art" inside "partial chart" is not evidence.
  const answerIsQuoted = normalizedAnswer.length >= (answerIsMath ? 1 : 2) &&
    new RegExp(`(?<![\\p{L}\\p{N}_])${escapedAnswer}(?![\\p{L}\\p{N}_])`, "u").test(normalizedExcerpt);
  const evidenceTerms = normalizedExcerptForTerms.match(/[a-z0-9]+/g) ?? [];
  const reasoningTerms = new Set(
    normalizeEvidence(`${question.question} ${question.explanation}`).match(/[a-z0-9]+/g) ?? [],
  );
  const overlappingKeyTerms = new Set(evidenceTerms.filter(term =>
    !evidenceStopWords.has(term) && reasoningTerms.has(term),
  ));
  const mentionsLongKeyTerm = Array.from(overlappingKeyTerms).some(term => term.length >= 4);
  // Short words are weak evidence alone; Vietnamese math excerpts often need two terms such as "dao" and "ham".
  const mentionsMultipleShortKeyTerms = Array.from(overlappingKeyTerms).filter(term => term.length === 3).length >= 2;
  const mentionsKeyTerm = mentionsLongKeyTerm || mentionsMultipleShortKeyTerms;
  return answerIsQuoted && mentionsKeyTerm;
}

function parseQuestionBatch(text: string, count: number) {
  if (Buffer.byteLength(text, "utf8") > 512 * 1024)
    throw new Error("AI output exceeds size limit");
  const questions = z.array(geminiQuestionSchema).length(count).parse(JSON.parse(text));
  if (new Set(questions.map(question => question.id)).size !== questions.length)
    throw new Error("AI question IDs must be distinct");
  return questions;
}

/** Parses one complete batch and keeps only questions that independently pass source validation. */
export function parseGroundedQuizCandidates(
  text: string,
  count: number,
  sourceText: string,
): GroundedQuizCandidates {
  const questions = parseQuestionBatch(text, count);
  const sourceMathExpressions = splitDelimitedMath(sourceText)
    .filter(part => part.kind === "math").map(part => part.value);
  const normalizedSource = normalizeExcerptEvidence(sourceText);
  const exactSource = normalizeExactExcerptWhitespace(sourceText);
  const groundedQuestions: GeneratedQuizQuestion[] = [];
  let groundingFailure: GroundedQuizCandidates["groundingFailure"];
  for (const question of questions) {
    const excerpt = question.sourceExcerpt;
    const exactExcerpt = excerpt ? normalizeExactExcerptWhitespace(excerpt) : "";
    const exactSourceMatch = exactExcerpt.length > 0 && exactSource.includes(exactExcerpt);
    const presentationMatch = excerpt !== undefined &&
      normalizedSource.includes(normalizeExcerptEvidence(excerpt, sourceMathExpressions));
    if (!excerpt || (!exactSourceMatch && !presentationMatch)) {
      groundingFailure ??= "missing-excerpt";
      continue;
    }
    if (!hasSourceGrounding(question, excerpt, sourceMathExpressions)) {
      groundingFailure ??= "ungrounded-answer";
      continue;
    }
    groundedQuestions.push(question);
  }
  return { questions: groundedQuestions, groundingFailure };
}

export function parseGeneratedQuiz(text: string, count: number, sourceText?: string): GeneratedQuizQuestion[] {
  if (!sourceText) return parseQuestionBatch(text, count);
  const result = parseGroundedQuizCandidates(text, count, sourceText);
  if (result.groundingFailure) throw new QuizGroundingError(result.groundingFailure);
  return result.questions;
}
