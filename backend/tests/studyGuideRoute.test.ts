import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { buildApp } from "../src/app.js";
import { ApiError } from "../src/errors.js";
import { config } from "../src/config.js";
const { generateStudyGuide } = vi.hoisted(() => ({ generateStudyGuide: vi.fn() }));
vi.mock("../src/studyGuide.js", () => ({ generateStudyGuide }));

const draft = {
  title: "Ôn tập sinh học",
  text: "## Ý chính\nQuang hợp chuyển năng lượng ánh sáng thành năng lượng hóa học.\n## Giả định và điểm cần kiểm chứng\nĐối chiếu với giáo trình.",
};
let app: Awaited<ReturnType<typeof buildApp>>;
let redis: RedisMock;
let userId: string;
let authorization: string;

async function accessToken(subject: string) {
  return new SignJWT({ email: "learner@example.com", name: "Learner", type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer("pomodoro-api")
    .setAudience("pomodoro-mobile")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(config.JWT_SECRET));
}

beforeEach(async () => {
  userId = randomUUID();
  authorization = `Bearer ${await accessToken(userId)}`;
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({
      id: userId,
      suspended_at: null,
      admin_state_version: 0,
    }) },
  } as unknown as PrismaClient;
  redis = new RedisMock();
  app = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
  await app.ready();
  generateStudyGuide.mockReset();
  generateStudyGuide.mockResolvedValue(draft);
});

afterEach(async () => {
  await app.close();
  redis.disconnect();
});

describe("POST /api/v1/materials/generate", () => {
  it("requires authentication and validates the prompt before calling the provider", async () => {
    const payload = { topic: "biology", prompt: "Explain photosynthesis for a beginner." };
    const unauthenticated = await app.inject({ method: "POST", url: "/api/v1/materials/generate", payload });
    expect(unauthenticated.statusCode).toBe(401);
    expect(generateStudyGuide).not.toHaveBeenCalled();

    const invalid = await app.inject({
      method: "POST", url: "/api/v1/materials/generate", headers: { authorization },
      payload: { ...payload, prompt: "short" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(generateStudyGuide).not.toHaveBeenCalled();

    const response = await app.inject({
      method: "POST", url: "/api/v1/materials/generate", headers: { authorization }, payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(draft);
    expect(generateStudyGuide).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
  });

  it("preserves mapped provider errors without exposing provider details", async () => {
    generateStudyGuide.mockRejectedValueOnce(
      new ApiError(429, "provider-quota-exceeded", "Gemini đã vượt hạn mức."),
    );
    const response = await app.inject({
      method: "POST", url: "/api/v1/materials/generate", headers: { authorization },
      payload: { topic: "biology", prompt: "Explain photosynthesis for a beginner." },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json().detail).toBe("Gemini đã vượt hạn mức.");
    expect(response.body).not.toContain("private provider details");
  });
});
