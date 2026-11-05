import { createHash } from "node:crypto";
import { z } from "zod";

export const STUDY_PLAN_REQUEST_BODY_LIMIT_BYTES = 256 * 1024;

const studyPlanStepSchema = z.object({
  title: z.string().trim().min(3).max(120),
  action: z.string().trim().min(3).max(400),
  outcome: z.string().trim().min(3).max(400),
  check: z.string().trim().min(3).max(400),
  sourceExcerpt: z.string().trim().min(5).max(500).optional(),
}).strict();

export const studyPlanRequestSchema = z.object({
  goal: z.string().trim().min(3).max(500),
  topic: z.string().trim().min(1).max(100).optional(),
  level: z.string().trim().min(1).max(100).optional(),
  preferredMinutes: z.number().int().min(1).max(240),
  sourceText: z.string().max(50_000).refine(
    value => Array.from(value).filter(character => !/\s/u.test(character)).length >= 10,
    "Source must contain at least 10 non-whitespace characters.",
  ).optional(),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/iu).optional(),
}).strict().superRefine((value, context) => {
  if ((value.sourceText === undefined) !== (value.sourceFingerprint === undefined)) {
    context.addIssue({
      code: "custom",
      path: [value.sourceText === undefined ? "sourceFingerprint" : "sourceText"],
      message: "Source text and fingerprint must be supplied together.",
    });
    return;
  }
  if (value.sourceText !== undefined && value.sourceFingerprint !== undefined) {
    const expected = createHash("sha256").update(value.sourceText, "utf8").digest("hex");
    if (value.sourceFingerprint.toLowerCase() !== expected) {
      context.addIssue({
        code: "custom",
        path: ["sourceFingerprint"],
        message: "Source fingerprint does not match the exact UTF-8 source text.",
      });
    }
  }
});

export type StudyPlanRequest = z.infer<typeof studyPlanRequestSchema>;

export const studyPlanResponseSchema = z.object({
  title: z.string().trim().min(3).max(120),
  steps: z.array(studyPlanStepSchema).min(3).max(8),
  finalCheck: z.string().trim().min(3).max(500).optional(),
  verificationNote: z.string().trim().min(3).max(500).optional(),
}).strict();

export type StudyPlanResponse = z.infer<typeof studyPlanResponseSchema>;

export const studyPlanProviderResponseJsonSchema = {
  type: "object" as const,
  additionalProperties: false,
  required: ["title", "steps"],
  properties: {
    title: { type: "string" as const, minLength: 3, maxLength: 120 },
    steps: {
      type: "array" as const,
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object" as const,
        additionalProperties: false,
        required: ["title", "action", "outcome", "check"],
        properties: {
          title: { type: "string" as const, minLength: 3, maxLength: 120 },
          action: { type: "string" as const, minLength: 3, maxLength: 400 },
          outcome: { type: "string" as const, minLength: 3, maxLength: 400 },
          check: { type: "string" as const, minLength: 3, maxLength: 400 },
          sourceExcerpt: { type: "string" as const, minLength: 5, maxLength: 500 },
        },
      },
    },
    finalCheck: { type: "string" as const, minLength: 3, maxLength: 500 },
    verificationNote: { type: "string" as const, minLength: 3, maxLength: 500 },
  },
};

/** Validate provider output in the context of the request that explicitly supplied its source. */
export function validateStudyPlanResponseForRequest(
  request: StudyPlanRequest,
  value: unknown,
): StudyPlanResponse {
  const response = studyPlanResponseSchema.parse(value);
  for (const [index, step] of response.steps.entries()) {
    if (!step.sourceExcerpt) continue;
    if (request.sourceText === undefined || !request.sourceText.includes(step.sourceExcerpt)) {
      throw new Error(`Study plan step ${index + 1} contains an excerpt outside the submitted source.`);
    }
  }
  return response;
}
