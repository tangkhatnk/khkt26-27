import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  STUDY_PLAN_REQUEST_BODY_LIMIT_BYTES,
  studyPlanRequestSchema,
  studyPlanResponseSchema,
  validateStudyPlanResponseForRequest,
} from "../src/studyPlanSchemas.js";

const sourceText = "Nội dung bài học về chu trình nước và sự bay hơi.";
const fingerprint = createHash("sha256").update(sourceText, "utf8").digest("hex");
const request = {
  goal: "Hiểu chu trình nước",
  topic: "Khoa học tự nhiên",
  level: "Lớp 6",
  preferredMinutes: 45,
};
const step = {
  title: "Nhận biết các giai đoạn",
  action: "Đọc phần mô tả về bay hơi, ngưng tụ và mưa.",
  outcome: "Nêu được thứ tự các giai đoạn chính.",
  check: "Tự giải thích vì sao hơi nước ngưng tụ.",
};
const secondStep = {
  ...step,
  title: "Vẽ chu trình",
  action: "Vẽ mũi tên thể hiện sự tuần hoàn của nước.",
  outcome: "Sắp xếp đúng các giai đoạn chính.",
  check: "So sánh sơ đồ với mô tả đã đọc.",
};
const thirdStep = {
  ...step,
  title: "Giải thích mưa",
  action: "Viết hai câu mô tả cách mây tạo thành mưa.",
  outcome: "Liên hệ được ngưng tụ với lượng mưa.",
  check: "Tự giải thích mà không nhìn ghi chú.",
};
const response = {
  title: "Tìm hiểu chu trình nước",
  steps: [step, secondStep, thirdStep],
};

describe("study plan schemas", () => {
  it("accepts bounded goal-only and source-backed requests without changing source bytes", () => {
    expect(studyPlanRequestSchema.parse(request)).toEqual(request);
    expect(studyPlanRequestSchema.parse({
      ...request,
      sourceText,
      sourceFingerprint: fingerprint,
    })).toMatchObject({ sourceText, sourceFingerprint: fingerprint });
    expect(STUDY_PLAN_REQUEST_BODY_LIMIT_BYTES).toBe(256 * 1024);
  });

  it("accepts the complete preferred-minute range but rejects invalid bounds and extra request fields", () => {
    for (const preferredMinutes of [1, 240])
      expect(studyPlanRequestSchema.safeParse({ ...request, preferredMinutes }).success).toBe(true);
    for (const preferredMinutes of [0, 241, 1.5, Number.NaN])
      expect(studyPlanRequestSchema.safeParse({ ...request, preferredMinutes }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({ ...request, confidence: 0.7 }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({ ...request, goal: " x " }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({ ...request, topic: " " }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({ ...request, level: " " }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({ ...request, level: "L".repeat(101) }).success).toBe(false);
  });

  it("requires paired source and exact UTF-8 fingerprint over unmodified text", () => {
    expect(studyPlanRequestSchema.safeParse({ ...request, sourceText }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({ ...request, sourceFingerprint: fingerprint }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({
      ...request,
      sourceText: `${sourceText} `,
      sourceFingerprint: fingerprint,
    }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({
      ...request,
      sourceText: "         ",
      sourceFingerprint: createHash("sha256").update("         ").digest("hex"),
    }).success).toBe(false);
    expect(studyPlanRequestSchema.safeParse({
      ...request,
      sourceText: "x".repeat(50_001),
      sourceFingerprint: createHash("sha256").update("x".repeat(50_001)).digest("hex"),
    }).success).toBe(false);
  });

  it("bounds and strictly validates a three-to-eight-step response", () => {
    expect(studyPlanResponseSchema.parse(response)).toEqual(response);
    expect(studyPlanResponseSchema.safeParse({ ...response, steps: [step, step] }).success).toBe(false);
    expect(studyPlanResponseSchema.safeParse({
      ...response,
      steps: Array.from({ length: 9 }, () => step),
    }).success).toBe(false);
    expect(studyPlanResponseSchema.safeParse({ ...response, providerMetadata: { model: "x" } }).success).toBe(false);
    expect(studyPlanResponseSchema.safeParse({
      ...response,
      steps: [{ ...step, action: "x" }, step, step],
    }).success).toBe(false);
  });

  it("allows only exact source excerpts and rejects excerpts without a source", () => {
    const backedRequest = studyPlanRequestSchema.parse({
      ...request,
      sourceText,
      sourceFingerprint: fingerprint,
    });
    const grounded = {
      ...response,
      steps: [
        { ...step, sourceExcerpt: "chu trình nước và sự bay hơi" },
        secondStep,
        thirdStep,
      ],
    };
    expect(validateStudyPlanResponseForRequest(backedRequest, grounded)).toEqual(grounded);
    expect(() => validateStudyPlanResponseForRequest(backedRequest, {
      ...grounded,
      steps: [{ ...grounded.steps[0], sourceExcerpt: "sự bay hơi và ngưng tụ" }, secondStep, thirdStep],
    })).toThrow();
    expect(() => validateStudyPlanResponseForRequest(studyPlanRequestSchema.parse(request), grounded)).toThrow();
    expect(() => validateStudyPlanResponseForRequest(backedRequest, {
      ...grounded,
      steps: [{ ...grounded.steps[0], sourceExcerpt: "tiny" }, secondStep, thirdStep],
    })).toThrow();
  });
});
