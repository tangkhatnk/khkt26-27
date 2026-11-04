import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import RedisMock from "ioredis-mock";
import { ZodError } from "zod";
import { ApiError } from "../src/errors.js";
import { guestAiRoutes } from "../src/guestAi.js";
import type { GuestAiWorkflowProviders } from "../src/guestAiWorkflows.js";
import type { StudyExerciseQuestion } from "../src/studyExerciseSchemas.js";

const sessionText = "A stack follows last-in, first-out (LIFO) order.";
const generatedQuiz = [{
  id: "provider-id", question: "Which rule describes a stack?", options: ["LIFO", "FIFO", "Random", "Sorted"],
  correctAnswerIndex: 0, explanation: "A stack follows last-in, first-out order.", knowledgePoint: "Stack",
}];
const exerciseQuestions = [{ prompt: "Explain the stack rule using LIFO.", evidenceExcerpt: sessionText }];
let app: ReturnType<typeof Fastify>;
let redis: RedisMock;
let providers: GuestAiWorkflowProviders;

beforeEach(async () => {
  vi.clearAllMocks();
  redis = new RedisMock();
  providers = {
    readMaterialDocument: vi.fn(async () => ({ text: "private material text" })),
    summarizeMaterialText: vi.fn(async () => ({ summary: "private summary" })),
    generateStudyGuide: vi.fn(async () => ({ title: "Guide", text: "Private guide content." })),
    generateGeminiQuiz: vi.fn(async () => generatedQuiz),
    generateStudyExerciseQuestions: vi.fn(async () => exerciseQuestions),
    generateStudyExerciseSolutions: vi.fn(async (_sourceText: string, exercises: readonly StudyExerciseQuestion[]) => ({
      exercises: exercises.map(exercise => ({ id: exercise.id, solution: "Use the stated rule.", explanation: "Apply LIFO." })),
    })),
  } as unknown as GuestAiWorkflowProviders;
  const queryDb = {
    $queryRaw: async () => [{ session: null, sessionOverride: null }],
  };
  const db = {
    ...queryDb,
    $transaction: async (callback: (tx: typeof queryDb) => unknown) => callback(queryDb),
  } as unknown as PrismaClient;
  app = Fastify({ logger: false });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof ZodError ? 400 : error instanceof ApiError ? error.status : 500;
    return reply.code(status).send({ status, detail: error.message });
  });
  guestAiRoutes(app, db, redis as unknown as Redis, providers);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  redis.disconnect();
});

async function issueCredential() {
  const response = await app.inject({ method: "POST", url: "/api/v1/ai/guest/credential", payload: {} });
  expect(response.statusCode).toBe(201);
  return (response.json() as { token: string }).token;
}

describe("guest AI workflows", () => {
  it("requires the private GuestAI credential and keeps document output no-store", async () => {
    const body = { mimeType: "application/pdf", data: Buffer.from("%PDF-").toString("base64") };
    const unauthorized = await app.inject({ method: "POST", url: "/api/v1/ai/guest/materials/read", payload: body });
    expect(unauthorized.statusCode).toBe(401);
    const token = await issueCredential();
    const response = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/materials/read",
      headers: { authorization: `GuestAI ${token}` }, payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({ text: "private material text" });
    expect(providers.readMaterialDocument).toHaveBeenCalledOnce();
  });

  it("rejects malformed guest quiz input before provider calls", async () => {
    const token = await issueCredential();
    const response = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/quizzes/generate",
      headers: { authorization: `GuestAI ${token}` },
      payload: { plannedSessionId: "00000000-0000-4000-8000-000000000001", topic: "invalid topic" },
    });
    expect(response.statusCode).toBe(400);
    expect(providers.generateGeminiQuiz).not.toHaveBeenCalled();
  });

  it("keeps quiz answers and feedback private while allowing generation from a summary session label", async () => {
    const token = await issueCredential();
    const plannedSessionId = "00000000-0000-4000-8000-000000000002";
    const generated = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/quizzes/generate",
      headers: { authorization: `GuestAI ${token}` },
      payload: { plannedSessionId, topic: "biology", documentText: sessionText, documentAttached: true, count: 1 },
    });
    expect(generated.statusCode).toBe(201);
    const deck = generated.json() as { id: string; questions: Array<{ id: string; correctAnswerIndex?: number; explanation?: string }> };
    expect(deck.questions).toHaveLength(1);
    expect(deck.questions[0]).not.toHaveProperty("correctAnswerIndex");
    expect(deck.questions[0]).not.toHaveProperty("explanation");
    expect(generated.headers["cache-control"]).toBe("no-store");

    const foreignToken = await issueCredential();
    const foreign = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/quizzes/generate",
      headers: { authorization: `GuestAI ${foreignToken}` },
      payload: { plannedSessionId, topic: "biology", documentText: sessionText, documentAttached: true, count: 1 },
    });
    expect(foreign.statusCode).toBe(201);
    const foreignRead = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/quizzes/${deck.id}/grade`,
      headers: { authorization: `GuestAI ${foreignToken}` },
      payload: { answers: [{ id: deck.questions[0]!.id, selected: 0 }] },
    });
    expect(foreignRead.statusCode).toBe(404);

    const grade = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/quizzes/${deck.id}/grade`,
      headers: { authorization: `GuestAI ${token}` },
      payload: { answers: [{ id: deck.questions[0]!.id, selected: 0 }] },
    });
    expect(grade.statusCode).toBe(200);
    expect(grade.json()).toMatchObject({ quizId: deck.id, score: 1, total: 1 });
    expect(await redis.keys("guest-ai:grade:*")).toHaveLength(1);
    expect(await redis.keys("guest-ai:grade:*").then(keys => redis.mget(...keys))).not.toContain(null);
  });

  it("isolates equal exercise request IDs across sessions and cancels only the selected draft", async () => {
    const token = await issueCredential();
    const otherToken = await issueCredential();
    const requestId = "00000000-0000-4000-8000-000000000010";
    const sessionIds = [
      "00000000-0000-4000-8000-000000000011",
      "00000000-0000-4000-8000-000000000012",
      "00000000-0000-4000-8000-000000000013",
    ];
    const [first, second] = await Promise.all(sessionIds.slice(0, 2).map(plannedSessionId => app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${token}` },
      payload: { requestId, plannedSessionId, mode: "generated", text: sessionText, count: 1 },
    })));
    const third = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${otherToken}` },
      payload: { requestId, plannedSessionId: sessionIds[2], mode: "generated", text: sessionText, count: 1 },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(third.statusCode).toBe(201);
    expect((first.json() as { id: string }).id).not.toBe(requestId);
    expect((second.json() as { id: string }).id).not.toBe((first.json() as { id: string }).id);
    expect((third.json() as { id: string }).id).not.toBe((second.json() as { id: string }).id);

    const cancelled = await app.inject({
      method: "DELETE", url: `/api/v1/ai/guest/study-exercises/session/${sessionIds[0]}/requests/${requestId}`,
      headers: { authorization: `GuestAI ${token}` }, payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    const foreignCancel = await app.inject({
      method: "DELETE", url: `/api/v1/ai/guest/study-exercises/session/${sessionIds[2]}/requests/${requestId}`,
      headers: { authorization: `GuestAI ${token}` }, payload: {},
    });
    expect(foreignCancel.statusCode).toBe(404);
    const surviving = await app.inject({
      method: "GET", url: `/api/v1/ai/guest/study-exercises/session/${sessionIds[1]}`,
      headers: { authorization: `GuestAI ${token}` },
    });
    expect(surviving.statusCode).toBe(200);
    expect(surviving.json()).toMatchObject({ plannedSessionId: sessionIds[1] });
    const foreignSurviving = await app.inject({
      method: "GET", url: `/api/v1/ai/guest/study-exercises/session/${sessionIds[2]}`,
      headers: { authorization: `GuestAI ${otherToken}` },
    });
    expect(foreignSurviving.statusCode).toBe(200);
  });

  it("returns the client request ID separately from the private exercise set ID", async () => {
    const token = await issueCredential();
    const requestId = "00000000-0000-4000-8000-000000000030";
    const plannedSessionId = "00000000-0000-4000-8000-000000000031";
    const prepared = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${token}` },
      payload: { requestId, plannedSessionId, mode: "provided", text: sessionText },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json()).toMatchObject({ requestId, plannedSessionId });
    expect(prepared.json().id).not.toBe(requestId);
  });

  it("does not let an unbound guest cancellation tombstone another learner's future request", async () => {
    const attackerToken = await issueCredential();
    const ownerToken = await issueCredential();
    const requestId = "00000000-0000-4000-8000-000000000035";
    const plannedSessionId = "00000000-0000-4000-8000-000000000036";
    const attackerCancel = await app.inject({
      method: "DELETE",
      url: `/api/v1/ai/guest/study-exercises/session/${plannedSessionId}/requests/${requestId}`,
      headers: { authorization: `GuestAI ${attackerToken}` }, payload: {},
    });
    expect(attackerCancel.statusCode).toBe(200);

    const ownerPreparation = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${ownerToken}` },
      payload: { requestId, plannedSessionId, mode: "provided", text: sessionText },
    });
    expect(ownerPreparation.statusCode).toBe(201);
  });

  it("does not replay an exercise request when its mode or requested composition changes", async () => {
    const token = await issueCredential();
    const requestId = "00000000-0000-4000-8000-000000000040";
    const plannedSessionId = "00000000-0000-4000-8000-000000000041";
    const first = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${token}` },
      payload: { requestId, plannedSessionId, mode: "generated", text: sessionText, count: 1 },
    });
    expect(first.statusCode).toBe(201);
    const changedCount = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${token}` },
      payload: { requestId, plannedSessionId, mode: "generated", text: sessionText, count: 2 },
    });
    expect(changedCount.statusCode).toBe(409);
  });

  it("serializes quiz grading and replacement so a graded deck cannot be replaced", async () => {
    const token = await issueCredential();
    const plannedSessionId = "00000000-0000-4000-8000-000000000050";
    const first = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/quizzes/generate",
      headers: { authorization: `GuestAI ${token}` },
      payload: { plannedSessionId, topic: "biology", documentText: sessionText, documentAttached: true, count: 1 },
    });
    expect(first.statusCode).toBe(201);
    const quizId = (first.json() as { id: string; questions: Array<{ id: string }> }).id;
    const questionId = (first.json() as { questions: Array<{ id: string }> }).questions[0]!.id;

    let providerStarted!: () => void;
    let finishProvider!: () => void;
    const started = new Promise<void>(resolve => { providerStarted = resolve; });
    const finish = new Promise<void>(resolve => { finishProvider = resolve; });
    let calls = 1;
    vi.mocked(providers.generateGeminiQuiz).mockImplementation(async () => {
      calls += 1;
      if (calls > 1) {
        providerStarted();
        await finish;
      }
      return generatedQuiz;
    });
    const replacementPromise = app.inject({
      method: "POST", url: "/api/v1/ai/guest/quizzes/generate",
      headers: { authorization: `GuestAI ${token}` },
      payload: { plannedSessionId, topic: "biology", goal: "Review cellular respiration", documentText: sessionText, documentAttached: true, count: 1 },
    });
    await started;
    const grade = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/quizzes/${quizId}/grade`,
      headers: { authorization: `GuestAI ${token}` },
      payload: { answers: [{ id: questionId, selected: 0 }] },
    });
    expect(grade.statusCode).toBe(200);
    finishProvider();
    const replacement = await replacementPromise;
    expect(replacement.statusCode).toBe(409);

    const staleGrade = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/quizzes/${quizId}/grade`,
      headers: { authorization: `GuestAI ${token}` },
      payload: { answers: [{ id: questionId, selected: 0 }] },
    });
    expect(staleGrade.statusCode).toBe(200);
  });

  it("does not start an AI exercise session before its prepared set is bound", async () => {
    const token = await issueCredential();
    const plannedSessionId = "00000000-0000-4000-8000-000000000020";
    const requestId = "00000000-0000-4000-8000-000000000021";
    const prepared = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/study-exercises",
      headers: { authorization: `GuestAI ${token}` },
      payload: { requestId, plannedSessionId, mode: "provided", text: sessionText },
    });
    expect(prepared.statusCode).toBe(201);

    const startBeforeBind = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/sessions/start",
      headers: { authorization: `GuestAI ${token}` }, payload: { id: plannedSessionId, target: 60 },
    });
    expect(startBeforeBind.statusCode).toBe(409);

    const bound = await app.inject({
      method: "POST", url: `/api/v1/ai/guest/study-exercises/session/${plannedSessionId}/bind`,
      headers: { authorization: `GuestAI ${token}` }, payload: {},
    });
    expect(bound.statusCode).toBe(200);
    const started = await app.inject({
      method: "POST", url: "/api/v1/ai/guest/sessions/start",
      headers: { authorization: `GuestAI ${token}` }, payload: { id: plannedSessionId, target: 60 },
    });
    expect(started.statusCode).toBe(200);
  });
});
