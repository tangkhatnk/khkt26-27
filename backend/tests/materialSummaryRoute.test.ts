import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});

import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let redis: RedisMock;
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
  const userId = randomUUID();
  authorization = `Bearer ${await accessToken(userId)}`;
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({
      id: userId,
      suspended_at: null,
      admin_state_version: 0,
    }) },
  } as unknown as PrismaClient;
  redis = new RedisMock();
  await redis.flushall();
  app = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
  await app.ready();
  generateContent.mockReset();
  generateContent.mockResolvedValue({ text: JSON.stringify({ summary: "Tóm tắt nguồn học tập." }) });
  config.GEMINI_API_KEY = "test-only-private-key";
});

afterEach(async () => {
  await app.close();
  redis.disconnect();
  vi.resetAllMocks();
});

describe("POST /api/v1/materials/summarize", () => {
  it("requires authentication and returns a validated summary from the exact submitted text", async () => {
    const source = "  Nội dung nguyên văn đủ dài để tạo bản tóm tắt.  \n";
    const unauthenticated = await app.inject({
      method: "POST", url: "/api/v1/materials/summarize", payload: { text: source },
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(generateContent).not.toHaveBeenCalled();

    const response = await app.inject({
      method: "POST", url: "/api/v1/materials/summarize",
      headers: { authorization }, payload: { text: source },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ summary: "Tóm tắt nguồn học tập." });
    const request = generateContent.mock.calls[0][0];
    expect(JSON.parse(request.contents)).toEqual({ sourceText: source });
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("rejects short, oversized, and non-strict request bodies before calling Gemini", async () => {
    const short = await app.inject({
      method: "POST", url: "/api/v1/materials/summarize",
      headers: { authorization }, payload: { text: "   abcdefghi   " },
    });
    expect(short.statusCode).toBe(400);

    const extra = await app.inject({
      method: "POST", url: "/api/v1/materials/summarize",
      headers: { authorization }, payload: { text: "Nội dung nguồn đủ dài.", ownerId: "other" },
    });
    expect(extra.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST", url: "/api/v1/materials/summarize",
      headers: { authorization }, payload: { text: "x".repeat(50_001) },
    });
    expect(oversized.statusCode).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("applies the 512 KiB body cap and three-request per-minute limit", async () => {
    const tooLarge = await app.inject({
      method: "POST", url: "/api/v1/materials/summarize",
      headers: { authorization }, payload: { text: "x".repeat(600 * 1024) },
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(generateContent).not.toHaveBeenCalled();
    await redis.flushall();

    const payload = { text: "Nội dung nguồn đủ dài để tạo bản tóm tắt." };
    const responses = [];
    for (let index = 0; index < 4; index++) {
      responses.push(await app.inject({
        method: "POST", url: "/api/v1/materials/summarize",
        headers: { authorization }, payload,
      }));
    }
    expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200, 429]);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });
});
