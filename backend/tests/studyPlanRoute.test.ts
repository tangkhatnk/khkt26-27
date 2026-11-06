import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";

const { generateStudyPlan } = vi.hoisted(() => ({ generateStudyPlan: vi.fn() }));
vi.mock("../src/studyPlan.js", () => ({ generateStudyPlan }));

const plan = {
  title: "Ôn tập chu trình nước",
  steps: [
    { title: "Xem các giai đoạn", action: "Đọc nội dung về bay hơi và ngưng tụ.", outcome: "Nêu được thứ tự các giai đoạn.", check: "Tự kể lại quá trình bằng lời." },
    { title: "Vẽ sơ đồ", action: "Vẽ mũi tên cho chu trình nước.", outcome: "Thể hiện được vòng tuần hoàn.", check: "Đối chiếu từng mũi tên với nội dung." },
    { title: "Tự giải thích", action: "Viết hai câu về cách mưa hình thành.", outcome: "Liên hệ được ngưng tụ với mưa.", check: "Giải thích lại mà không nhìn ghi chú." },
  ],
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
  await redis.flushall();
  app = await buildApp({ db, redis: redis as unknown as Redis, logger: false });
  await app.ready();
  generateStudyPlan.mockReset();
  generateStudyPlan.mockResolvedValue(plan);
});

afterEach(async () => {
  await app.close();
  redis.disconnect();
  vi.restoreAllMocks();
});

async function issueGuestCredential() {
  const response = await app.inject({ method: "POST", url: "/api/v1/ai/guest/credential", payload: {} });
  expect(response.statusCode).toBe(201);
  return (response.json() as { token: string }).token;
}

describe("study plan routes", () => {
  it("keeps the account route authenticated and validates before calling the tutor", async () => {
    const payload = { goal: "Hiểu chu trình nước", preferredMinutes: 45 };
    const unauthorized = await app.inject({ method: "POST", url: "/api/v1/study-plans", payload });
    expect(unauthorized.statusCode).toBe(401);
    expect(generateStudyPlan).not.toHaveBeenCalled();

    const invalid = await app.inject({
      method: "POST", url: "/api/v1/study-plans", headers: { authorization },
      payload: { ...payload, unexpected: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(generateStudyPlan).not.toHaveBeenCalled();

    const response = await app.inject({
      method: "POST", url: "/api/v1/study-plans", headers: { authorization }, payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(plan);
    expect(generateStudyPlan).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
  });

  it("allows the bounded 50,000-character Unicode source for a credentialed guest and reserves tutor budget", async () => {
    const token = await issueGuestCredential();
    const sourceText = "ế".repeat(50_000);
    const sourceFingerprint = createHash("sha256").update(sourceText, "utf8").digest("hex");
    const payload = {
      goal: "Hiểu chu trình nước",
      topic: "Khoa học",
      preferredMinutes: 45,
      sourceText,
      sourceFingerprint,
    };

    const response = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-plans",
      headers: { authorization: `GuestAI ${token}` }, payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual(plan);
    expect(generateStudyPlan).toHaveBeenCalledWith(payload, expect.any(AbortSignal));
    const principalTaskKeys = await redis.keys("guest-ai:quota:principal:*:task:tutor");
    expect(principalTaskKeys).toHaveLength(1);
    expect(await redis.get(principalTaskKeys[0]!)).toBe("1");
    const providerUnitsKeys = await redis.keys("guest-ai:quota:principal:*:units");
    expect(await redis.get(providerUnitsKeys[0]!)).toBe("8000");
    expect(await redis.keys("guest-ai:study-plan:*" )).toHaveLength(0);
  });

  it("rejects requests without the GuestAI credential and keeps account tokens out of guest auth", async () => {
    const payload = { goal: "Hiểu chu trình nước", preferredMinutes: 45 };
    const missing = await app.inject({ method: "POST", url: "/api/v1/ai/guest/study-plans", payload });
    const wrongScheme = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-plans",
      headers: { authorization }, payload,
    });
    expect(missing.statusCode).toBe(401);
    expect(wrongScheme.statusCode).toBe(401);
    expect(generateStudyPlan).not.toHaveBeenCalled();
  });

  it.each(["account", "guest"] as const)("applies a 3-per-minute route cap to %s planning", async route => {
    const guestToken = route === "guest" ? await issueGuestCredential() : undefined;
    const url = route === "account" ? "/api/v1/study-plans" : "/api/v1/ai/guest/study-plans";
    const headers = route === "account"
      ? { authorization }
      : { authorization: `GuestAI ${guestToken}` };
    const responses = [];
    for (let index = 0; index < 4; index++) {
      responses.push(await app.inject({
        method: "POST", url, headers,
        payload: { goal: "Hiểu chu trình nước", preferredMinutes: 45 },
      }));
    }

    expect(responses.map(response => response.statusCode)).toEqual([200, 200, 200, 429]);
    expect(generateStudyPlan).toHaveBeenCalledTimes(3);
  });

  it.each(["account", "guest"] as const)("cancels %s provider work when the response stream closes", async route => {
    const guestToken = route === "guest" ? await issueGuestCredential() : undefined;
    const url = route === "account" ? "/api/v1/study-plans" : "/api/v1/ai/guest/study-plans";
    const headers = route === "account"
      ? { authorization, "content-type": "application/json" }
      : { authorization: `GuestAI ${guestToken}`, "content-type": "application/json" };
    let startProvider!: () => void;
    const providerStarted = new Promise<void>(resolve => { startProvider = resolve; });
    let providerSignal: AbortSignal | undefined;
    generateStudyPlan.mockImplementation((_input, signal) => {
      providerSignal = signal as AbortSignal;
      startProvider();
      return new Promise((_resolve, reject) => {
        providerSignal!.addEventListener("abort", () => reject(new Error("provider cancelled")), { once: true });
      });
    });

    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const pending = fetch(`${baseUrl}${url}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ goal: "Hiểu chu trình nước", preferredMinutes: 45 }),
      signal: controller.signal,
    });
    try {
      await providerStarted;
      expect(providerSignal?.aborted).toBe(false);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true));
      expect(generateStudyPlan).toHaveBeenCalledOnce();
    } finally {
      controller.abort();
    }
  });
});
