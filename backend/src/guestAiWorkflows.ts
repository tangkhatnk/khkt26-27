import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import { ApiError, missing } from "./errors.js";
import { reserveGuestAiBudget } from "./guestAiBudget.js";
import { estimateGuestAiProviderUnits } from "./guestAiCost.js";
import {
  bindGuestAiExercises,
  cancelGuestAiExercises,
  claimGuestAiFeature,
  completeGuestAiFeature,
  GUEST_AI_PRIVATE_TTL_SECONDS,
  readGuestAiGate,
  releaseGuestAiFeature,
} from "./guestAiGate.js";
import {
  assertGuestAiSessionAvailable,
  assertGuestAiSessionPending,
  requireCompletedGuestAiSession,
} from "./guestAiSessions.js";
import { readMaterialDocument, summarizeMaterialText } from "./materialReading.js";
import {
  materialReadRequestSchema,
  materialSummaryRequestSchema,
  MATERIAL_READ_BODY_LIMIT_BYTES,
  MATERIAL_SUMMARY_BODY_LIMIT_BYTES,
} from "./materialReadingSchemas.js";
import { generateStudyGuide } from "./studyGuide.js";
import { studyGuideRequestSchema, STUDY_GUIDE_BODY_LIMIT_BYTES } from "./studyGuideSchemas.js";
import { generateGeminiQuiz } from "./gemini.js";
import { geminiRequestSchema, type GeneratedQuizQuestion } from "./geminiSchemas.js";
import {
  parseGroundedStudyExercises,
  studyExercisePreparationRequestSchema,
  studyExercisePreparationResponseSchema,
  studyExerciseQuestionSchema,
  studyExerciseSolutionResponseSchema,
  type StudyExerciseQuestion,
} from "./studyExerciseSchemas.js";
import {
  generateStudyExerciseQuestions,
  generateStudyExerciseSolutions,
} from "./studyExerciseProvider.js";

const PRIVATE_TTL_SECONDS = GUEST_AI_PRIVATE_TTL_SECONDS;
const EXERCISE_BODY_LIMIT_BYTES = 256 * 1024;
const SESSION_PARAMS = z.object({ plannedSessionId: z.uuid() }).strict();
const REQUEST_PARAMS = z.object({ plannedSessionId: z.uuid(), requestId: z.uuid() }).strict();
const ID_PARAMS = z.object({ id: z.uuid() }).strict();
const QUIZ_ID_PARAMS = z.object({ quizId: z.uuid() }).strict();
const emptyBodySchema = z.object({}).strict();
const bindGuestExerciseBodySchema = z.object({ exerciseId: z.uuid() }).strict();
const guestQuizRequestSchema = z.object({
  plannedSessionId: z.uuid(),
  topic: geminiRequestSchema.shape.topic,
  goal: geminiRequestSchema.shape.goal,
  documentText: geminiRequestSchema.shape.documentText,
  documentAttached: geminiRequestSchema.shape.documentAttached,
  count: geminiRequestSchema.shape.count,
}).strict();
const guestQuizAnswersSchema = z.object({
  answers: z.array(z.object({ id: z.uuid(), selected: z.number().int().min(0).max(3) }).strict()).min(1).max(30),
}).strict();

const guestExerciseRecordSchema = z.object({
  principalId: z.uuid(),
  id: z.uuid(),
  plannedSessionId: z.uuid(),
  requestId: z.uuid(),
  mode: z.enum(["provided", "generated"]),
  sourceText: z.string().min(1).max(20_000),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  exercises: z.array(studyExerciseQuestionSchema).min(1).max(20),
  evidence: z.array(z.object({ questionId: z.uuid(), excerpt: z.string().min(5).max(2_000) }).strict()).max(20),
  expiresAt: z.number().int().positive(),
}).strict();
type GuestExerciseRecord = z.infer<typeof guestExerciseRecordSchema>;

const guestQuizQuestionSchema = z.object({
  id: z.uuid(),
  question: z.string().trim().min(1).max(2_000),
  options: z.array(z.string().trim().min(1).max(500)).length(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(4_000),
  knowledgePoint: z.string().trim().min(1).max(200).optional(),
}).strict();
const guestQuizRecordSchema = z.object({
  principalId: z.uuid(),
  id: z.uuid(),
  plannedSessionId: z.uuid(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  questions: z.array(guestQuizQuestionSchema).min(1).max(30),
  expiresAt: z.number().int().positive(),
}).strict();
type GuestQuizRecord = z.infer<typeof guestQuizRecordSchema>;

const quizGradeSchema = z.object({
  quizId: z.uuid(),
  score: z.number().int().min(0).max(30),
  total: z.number().int().min(1).max(30),
  questions: z.array(z.object({
    id: z.uuid(),
    selected: z.number().int().min(0).max(3),
    correct: z.boolean(),
    correctAnswerIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1).max(4_000),
  }).strict()).min(1).max(30),
}).strict();
type GuestQuizGrade = z.infer<typeof quizGradeSchema>;

const commitGuestQuizScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 1 end
local previousId = redis.call('HGET', KEYS[2], 'id')
if previousId and redis.call('EXISTS', ARGV[5] .. previousId) == 1 then return 2 end
redis.call('SET', KEYS[3], ARGV[3], 'EX', tonumber(ARGV[4]))
redis.call('HSET', KEYS[2], 'id', ARGV[2], 'fingerprint', ARGV[6])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
return 0
`;

const commitGuestQuizGradeScript = `
if redis.call('HGET', KEYS[1], 'id') ~= ARGV[1] then return 1 end
if redis.call('EXISTS', KEYS[2]) == 1 then return 2 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[3]), 'NX')
return 0
`;

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function privateKey(kind: "exercise" | "quiz", principalId: string, id: string) {
  return `guest-ai:${kind}:${principalId}:${id}`;
}

async function readPrivateRecord<T>(redis: Redis, key: string, schema: z.ZodType<T>): Promise<T> {
  let value: string | null;
  try { value = await redis.get(key); }
  catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
  if (!value) missing("Không tìm thấy nội dung AI khách hoặc nội dung đã hết hạn.");
  try { return schema.parse(JSON.parse(value)); }
  catch { throw new ApiError(503, "service-unavailable", "Guest AI private data is unavailable."); }
}

function requirePrincipal(recordPrincipalId: string, principalId: string) {
  if (recordPrincipalId !== principalId) missing("Không tìm thấy nội dung AI khách.");
}

function exerciseDto(record: GuestExerciseRecord) {
  return studyExercisePreparationResponseSchema.parse({
    id: record.id,
    requestId: record.requestId,
    plannedSessionId: record.plannedSessionId,
    mode: record.mode,
    ...(record.mode === "generated" ? { sourceFingerprint: record.sourceFingerprint } : {}),
    exercises: record.exercises,
  });
}

function publicQuizDto(record: GuestQuizRecord) {
  return {
    id: record.id,
    plannedSessionId: record.plannedSessionId,
    questions: record.questions.map(({ id, question, options, knowledgePoint }) => ({
      id, question, options, ...(knowledgePoint ? { knowledgePoint } : {}),
    })),
  };
}

export function signalForRequest(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const closed = () => { if (!reply.raw.writableEnded) abort(); };
  if (request.raw.aborted) abort();
  else request.raw.once("aborted", abort);
  if (!reply.raw.writableEnded && reply.raw.destroyed) abort();
  else if (!reply.raw.writableEnded) reply.raw.once("close", closed);
  return {
    signal: controller.signal,
    dispose: () => {
      request.raw.off("aborted", abort);
      reply.raw.off("close", closed);
    },
  };
}

async function reserve(
  redis: Redis,
  request: FastifyRequest,
  task: "document" | "tutor" | "question" | "evaluation",
  providerUnits: number,
) {
  await reserveGuestAiBudget(redis, {
    principalId: request.guestAiPrincipal!,
    remoteAddress: request.ip,
    task,
    providerUnits,
  });
}

export type GuestAiWorkflowProviders = {
  readMaterialDocument: typeof readMaterialDocument;
  summarizeMaterialText: typeof summarizeMaterialText;
  generateStudyGuide: typeof generateStudyGuide;
  generateGeminiQuiz: typeof generateGeminiQuiz;
  generateStudyExerciseQuestions: typeof generateStudyExerciseQuestions;
  generateStudyExerciseSolutions: typeof generateStudyExerciseSolutions;
};

const defaultProviders: GuestAiWorkflowProviders = {
  readMaterialDocument,
  summarizeMaterialText,
  generateStudyGuide,
  generateGeminiQuiz,
  generateStudyExerciseQuestions,
  generateStudyExerciseSolutions,
};

function featureConflict(status: string, text: string): never {
  if (status === "pending") throw new ApiError(409, "conflict", text);
  throw new ApiError(409, "conflict", "Đã có nội dung AI khác gắn với phiên học này.");
}

export function guestAiWorkflowRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  redis: Redis,
  authenticate: (request: FastifyRequest) => Promise<void>,
  providers: GuestAiWorkflowProviders = defaultProviders,
) {
  const authenticated = { preHandler: authenticate };

  app.post("/api/v1/ai/guest/materials/read", {
    ...authenticated,
    bodyLimit: MATERIAL_READ_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const input = materialReadRequestSchema.parse(request.body);
    await reserve(redis, request, "document", estimateGuestAiProviderUnits({ task: "document", operation: "read" }));
    const signal = signalForRequest(request, reply);
    try { return await providers.readMaterialDocument(input, signal.signal); }
    finally { signal.dispose(); }
  });

  app.post("/api/v1/ai/guest/materials/summarize", {
    ...authenticated,
    bodyLimit: MATERIAL_SUMMARY_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const input = materialSummaryRequestSchema.parse(request.body);
    await reserve(redis, request, "document", estimateGuestAiProviderUnits({ task: "document", operation: "summarize" }));
    const signal = signalForRequest(request, reply);
    try { return await providers.summarizeMaterialText(input, signal.signal); }
    finally { signal.dispose(); }
  });

  app.post("/api/v1/ai/guest/materials/generate", {
    ...authenticated,
    bodyLimit: STUDY_GUIDE_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const input = studyGuideRequestSchema.parse(request.body);
    await reserve(redis, request, "tutor", estimateGuestAiProviderUnits({ task: "tutor", operation: "study-guide" }));
    const signal = signalForRequest(request, reply);
    try { return await providers.generateStudyGuide(input, signal.signal); }
    finally { signal.dispose(); }
  });

  const generateGuestQuiz = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const input = guestQuizRequestSchema.parse(request.body);
    const { plannedSessionId, ...rawQuizInput } = input;
    const quizInput = geminiRequestSchema.parse(rawQuizInput);
    const fingerprint = hash(JSON.stringify(quizInput));
    const principalId = request.guestAiPrincipal!;
    const quizIndexKey = `guest-ai:quiz-index:${principalId}:${plannedSessionId}`;
    const quizLeaseKey = `guest-ai:quiz-lease:${principalId}:${plannedSessionId}`;
    const readIndex = async () => {
      let fields: Record<string, string>;
      try { fields = await redis.hgetall(quizIndexKey); }
      catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
      if (!Object.keys(fields).length) return null;
      try {
        return z.object({ id: z.uuid(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/u) }).strict().parse(fields);
      } catch { throw new ApiError(503, "service-unavailable", "Guest AI private data is unavailable."); }
    };
    let current = await readIndex();
    if (current?.fingerprint === fingerprint) {
      const cached = await readPrivateRecord(redis, privateKey("quiz", principalId, current.id), guestQuizRecordSchema);
      requirePrincipal(cached.principalId, principalId);
      await reserve(redis, request, "question", 0);
      return publicQuizDto(cached);
    }
    const leaseToken = randomUUID();
    let leased: string | null;
    try { leased = await redis.set(quizLeaseKey, leaseToken, "PX", 120_000, "NX"); }
    catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
    if (leased !== "OK") throw new ApiError(409, "conflict", "Quiz đang được chuẩn bị. Hãy thử lại sau.");
    try {
      current = await readIndex();
      if (current?.fingerprint === fingerprint) {
        const cached = await readPrivateRecord(redis, privateKey("quiz", principalId, current.id), guestQuizRecordSchema);
        requirePrincipal(cached.principalId, principalId);
        await reserve(redis, request, "question", 0);
        return publicQuizDto(cached);
      }
      if (current) {
        let graded: string | null;
        try { graded = await redis.get(`guest-ai:grade:${principalId}:${current.id}`); }
        catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
        if (graded) throw new ApiError(409, "conflict", "Quiz này đã được chấm. Hãy mở một phiên ôn tập mới.");
      }
      const id = randomUUID();
      await reserve(redis, request, "question", estimateGuestAiProviderUnits({ task: "question", operation: "quiz" }));
      const generated = await providers.generateGeminiQuiz(quizInput);
      const questions = generated.map((question: GeneratedQuizQuestion) => ({
        id: randomUUID(),
        question: question.question,
        options: question.options,
        correctAnswerIndex: question.correctAnswerIndex,
        explanation: question.explanation,
        ...(question.knowledgePoint ? { knowledgePoint: question.knowledgePoint } : {}),
      }));
      const record = guestQuizRecordSchema.parse({
        principalId, id, plannedSessionId, fingerprint, questions,
        expiresAt: Date.now() + PRIVATE_TTL_SECONDS * 1000,
      });
      const ttl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
      let committed: number;
      try {
        committed = Number(await redis.eval(
          commitGuestQuizScript, 3,
          quizLeaseKey, quizIndexKey, privateKey("quiz", principalId, id),
          leaseToken, id, JSON.stringify(record), ttl,
          `guest-ai:grade:${principalId}:`, fingerprint,
        ));
      } catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
      if (committed === 1)
        throw new ApiError(409, "conflict", "Yêu cầu tạo quiz đã hết hiệu lực. Hãy thử lại.");
      if (committed === 2)
        throw new ApiError(409, "conflict", "Quiz này đã được chấm. Hãy mở một phiên ôn tập mới.");
      reply.code(201);
      return publicQuizDto(record);
    } finally {
      try {
        await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", 1, quizLeaseKey, leaseToken);
      } catch { /* Lease expires after two minutes if Redis is temporarily unavailable. */ }
    }
  };

  app.post("/api/v1/ai/guest/quizzes/generate", {
    ...authenticated,
    bodyLimit: 256 * 1024,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, generateGuestQuiz);

  app.post("/api/v1/ai/guest/quizzes/:quizId/grade", {
    ...authenticated,
    bodyLimit: 8 * 1024,
    config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { quizId } = QUIZ_ID_PARAMS.parse(request.params);
    const { answers } = guestQuizAnswersSchema.parse(request.body);
    const principalId = request.guestAiPrincipal!;
    const record = await readPrivateRecord(redis, privateKey("quiz", principalId, quizId), guestQuizRecordSchema);
    requirePrincipal(record.principalId, principalId);
    const quizIndexKey = `guest-ai:quiz-index:${principalId}:${record.plannedSessionId}`;
    await reserve(redis, request, "evaluation", estimateGuestAiProviderUnits({ task: "evaluation", operation: "deterministic-grade" }));
    if (answers.length !== record.questions.length || new Set(answers.map(answer => answer.id)).size !== answers.length)
      throw new ApiError(400, "validation-error", "Hãy gửi đúng một đáp án cho từng câu hỏi.");
    const byId = new Map(record.questions.map(question => [question.id, question]));
    const submitted = new Map(answers.map(answer => [answer.id, answer]));
    if (record.questions.some(question => !submitted.has(question.id)))
      throw new ApiError(400, "validation-error", "Hãy gửi đúng một đáp án cho từng câu hỏi.");
    const questions = record.questions.map(question => {
      const answer = submitted.get(question.id)!;
      return {
        id: question.id,
        selected: answer.selected,
        correct: answer.selected === question.correctAnswerIndex,
        correctAnswerIndex: question.correctAnswerIndex,
        explanation: question.explanation,
      };
    });
    if (answers.some(answer => !byId.has(answer.id)))
      throw new ApiError(400, "validation-error", "Bộ đáp án không thuộc quiz này.");
    const answerFingerprint = hash(JSON.stringify([...answers].sort((left, right) => left.id.localeCompare(right.id))));
    const result: GuestQuizGrade = quizGradeSchema.parse({
      quizId,
      score: questions.filter(question => question.correct).length,
      total: questions.length,
      questions,
    });
    const gradeKey = `guest-ai:grade:${principalId}:${quizId}`;
    const gradeValue = JSON.stringify({ principalId, answerFingerprint, result });
    const ttl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
    let saved: number;
    try {
      saved = Number(await redis.eval(
        commitGuestQuizGradeScript, 2, quizIndexKey, gradeKey,
        quizId, gradeValue, ttl,
      ));
    } catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
    if (saved === 1)
      throw new ApiError(409, "conflict", "Quiz này không còn là bộ câu hỏi hiện tại.");
    if (saved === 2) {
      const cached = await readPrivateRecord(redis, gradeKey, z.object({
        principalId: z.uuid(), answerFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), result: quizGradeSchema,
      }).strict());
      requirePrincipal(cached.principalId, request.guestAiPrincipal!);
      if (cached.answerFingerprint !== answerFingerprint)
        throw new ApiError(409, "conflict", "Quiz này đã được chấm với bộ đáp án khác.");
      return cached.result;
    }
    return result;
  });

  app.post("/api/v1/ai/guest/study-exercises", {
    ...authenticated,
    bodyLimit: EXERCISE_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const input = studyExercisePreparationRequestSchema.parse(request.body);
    const sourceFingerprint = hash(input.text);
    const requestFingerprint = hash(JSON.stringify({
      mode: input.mode,
      text: input.text,
      ...(input.mode === "generated"
        ? ("counts" in input ? { counts: input.counts } : { count: input.count })
        : {}),
    }));
    await assertGuestAiSessionPending(db, input.plannedSessionId);
    const id = randomUUID();
    const claimInput = {
      principalId: request.guestAiPrincipal!, sessionId: input.plannedSessionId,
      feature: "exercise" as const, requestId: input.requestId,
      fingerprint: requestFingerprint, id,
    };
    const claim = await claimGuestAiFeature(redis, claimInput);
    if (claim.status === "replay") {
      const existing = await readPrivateRecord(redis, privateKey("exercise", request.guestAiPrincipal!, claim.id), guestExerciseRecordSchema);
      requirePrincipal(existing.principalId, request.guestAiPrincipal!);
      return exerciseDto(existing);
    }
    if (claim.status !== "claimed") featureConflict(claim.status, "Bộ bài tập đang được chuẩn bị. Hãy thử lại sau.");

    try {
      const providerUnits = input.mode === "generated"
        ? estimateGuestAiProviderUnits({ task: "question", operation: "exercise-generation" })
        : estimateGuestAiProviderUnits({ task: "question", operation: "provided-exercises" });
      await reserve(redis, request, "question", providerUnits);
      let exercises: StudyExerciseQuestion[];
      let evidence: GuestExerciseRecord["evidence"] = [];
      if (input.mode === "provided") {
        exercises = [studyExerciseQuestionSchema.parse({ id: randomUUID(), prompt: input.text })];
      } else {
        const signal = signalForRequest(request, reply);
        let generated;
        try {
          generated = await providers.generateStudyExerciseQuestions(
            input.text, "counts" in input ? input.counts : input.count, signal.signal,
          );
        } finally { signal.dispose(); }
        await assertGuestAiSessionPending(db, input.plannedSessionId);
        const expected = "counts" in input ? input.counts : input.count;
        let grounded;
        try { grounded = parseGroundedStudyExercises({ exercises: generated }, input.text, expected); }
        catch { throw new ApiError(502, "invalid-ai-output", "Gemini trả bài tập chưa bám sát nội dung đã xác nhận."); }
        exercises = grounded.map(exercise => studyExerciseQuestionSchema.parse({
          id: randomUUID(), prompt: exercise.prompt,
          ...(exercise.choices === undefined ? {} : { choices: exercise.choices }),
          ...(exercise.type === undefined ? {} : { type: exercise.type }),
        }));
        evidence = grounded.map((exercise, index) => ({ questionId: exercises[index]!.id, excerpt: exercise.evidenceExcerpt }));
      }
      await assertGuestAiSessionPending(db, input.plannedSessionId);
      const record = guestExerciseRecordSchema.parse({
        principalId: request.guestAiPrincipal!, id,
        plannedSessionId: input.plannedSessionId, requestId: input.requestId, mode: input.mode,
        sourceText: input.text, sourceFingerprint, exercises, evidence,
        expiresAt: Date.now() + PRIVATE_TTL_SECONDS * 1000,
      });
      await completeGuestAiFeature(redis, claimInput, record);
      reply.code(201);
      return exerciseDto(record);
    } catch (error) {
      await releaseGuestAiFeature(redis, claimInput).catch(() => undefined);
      throw error;
    }
  });

  app.get("/api/v1/ai/guest/study-exercises/:id", authenticated, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = ID_PARAMS.parse(request.params);
    const record = await readPrivateRecord(redis, privateKey("exercise", request.guestAiPrincipal!, id), guestExerciseRecordSchema);
    requirePrincipal(record.principalId, request.guestAiPrincipal!);
    await assertGuestAiSessionAvailable(db, record.plannedSessionId);
    return exerciseDto(record);
  });

  app.get("/api/v1/ai/guest/study-exercises/session/:plannedSessionId", authenticated, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { plannedSessionId } = SESSION_PARAMS.parse(request.params);
    const gate = await readGuestAiGate(redis, plannedSessionId);
    if (!gate || gate.principalId !== request.guestAiPrincipal! || !gate.exercise ||
        !["prepared", "bound"].includes(gate.exercise.status)) missing("Không tìm thấy bộ bài tập AI khách.");
    await assertGuestAiSessionAvailable(db, plannedSessionId);
    const record = await readPrivateRecord(redis, privateKey("exercise", request.guestAiPrincipal!, gate.exercise.id), guestExerciseRecordSchema);
    requirePrincipal(record.principalId, request.guestAiPrincipal!);
    return exerciseDto(record);
  });

  app.post("/api/v1/ai/guest/study-exercises/session/:plannedSessionId/bind", {
    ...authenticated,
    bodyLimit: 1024,
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { exerciseId } = bindGuestExerciseBodySchema.parse(request.body);
    const { plannedSessionId } = SESSION_PARAMS.parse(request.params);
    const principalId = request.guestAiPrincipal!;
    const record = await readPrivateRecord(
      redis, privateKey("exercise", principalId, exerciseId), guestExerciseRecordSchema,
    );
    requirePrincipal(record.principalId, principalId);
    if (record.plannedSessionId !== plannedSessionId) missing("Không tìm thấy bộ bài tập AI khách.");

    const gate = await readGuestAiGate(redis, plannedSessionId);
    if (!gate || gate.principalId !== principalId || gate.exercise?.id !== exerciseId)
      missing("Không tìm thấy bộ bài tập AI khách.");
    if (gate.exercise.status === "bound" && gate.started)
      await assertGuestAiSessionAvailable(db, plannedSessionId);
    else
      await assertGuestAiSessionPending(db, plannedSessionId);

    return bindGuestAiExercises(redis, principalId, plannedSessionId, exerciseId);
  });

  app.delete("/api/v1/ai/guest/study-exercises/session/:plannedSessionId/requests/:requestId", authenticated, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    emptyBodySchema.parse(request.body ?? {});
    const { plannedSessionId, requestId } = REQUEST_PARAMS.parse(request.params);
    return cancelGuestAiExercises(redis, request.guestAiPrincipal!, plannedSessionId, requestId);
  });

  app.post("/api/v1/ai/guest/study-exercises/:id/solution", {
    ...authenticated,
    bodyLimit: 1024,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    emptyBodySchema.parse(request.body ?? {});
    const { id } = ID_PARAMS.parse(request.params);
    const principalId = request.guestAiPrincipal!;
    const record = await readPrivateRecord(redis, privateKey("exercise", principalId, id), guestExerciseRecordSchema);
    requirePrincipal(record.principalId, request.guestAiPrincipal!);
    const gate = await readGuestAiGate(redis, record.plannedSessionId);
    if (!gate || gate.principalId !== request.guestAiPrincipal! || gate.exercise?.id !== id ||
        gate.exercise.status !== "bound" || !gate.started)
      throw new ApiError(409, "conflict", "Hãy bắt đầu phiên học bằng bộ bài tập đã xác nhận trước khi yêu cầu lời giải.");
    await requireCompletedGuestAiSession(redis, db, request.guestAiPrincipal!, record.plannedSessionId);

    const solutionsKey = `guest-ai:solutions:${principalId}:${id}`;
    const cached = await readPrivateRecord(redis, solutionsKey, z.object({
      principalId: z.uuid(), sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), result: studyExerciseSolutionResponseSchema,
    }).strict()).catch(error => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
    if (cached) {
      requirePrincipal(cached.principalId, principalId);
      if (cached.sourceFingerprint !== record.sourceFingerprint)
        throw new ApiError(409, "conflict", "Nguồn bài tập đã thay đổi. Hãy tạo lại bộ bài tập.");
      await requireCompletedGuestAiSession(redis, db, request.guestAiPrincipal!, record.plannedSessionId);
      await reserve(redis, request, "evaluation", 0);
      return cached.result;
    }

    const leaseKey = `guest-ai:solution-lease:${principalId}:${id}`;
    const leaseToken = randomUUID();
    let leased: string | null;
    try { leased = await redis.set(leaseKey, leaseToken, "PX", 120_000, "NX"); }
    catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
    if (leased !== "OK") throw new ApiError(409, "conflict", "Lời giải đang được tạo. Hãy thử lại sau.");

    try {
      await reserve(redis, request, "evaluation", estimateGuestAiProviderUnits({ task: "evaluation", operation: "exercise-solutions" }));
      const signal = signalForRequest(request, reply);
      let generated;
      try { generated = await providers.generateStudyExerciseSolutions(record.sourceText, record.exercises, signal.signal); }
      finally { signal.dispose(); }
      const result = studyExerciseSolutionResponseSchema.parse({ exercises: generated });
      await requireCompletedGuestAiSession(redis, db, request.guestAiPrincipal!, record.plannedSessionId);
      const current = await readPrivateRecord(redis, privateKey("exercise", principalId, id), guestExerciseRecordSchema);
      requirePrincipal(current.principalId, request.guestAiPrincipal!);
      if (current.sourceFingerprint !== record.sourceFingerprint)
        throw new ApiError(409, "conflict", "Nguồn bài tập đã thay đổi trong lúc tạo lời giải.");
      const value = JSON.stringify({ principalId: request.guestAiPrincipal!, sourceFingerprint: record.sourceFingerprint, result });
      const ttl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
      let saved: string | null;
      try { saved = await redis.set(solutionsKey, value, "EX", ttl, "NX"); }
      catch { throw new ApiError(503, "service-unavailable", "Guest AI private storage is unavailable."); }
      if (saved !== "OK") {
        const winner = await readPrivateRecord(redis, solutionsKey, z.object({
          principalId: z.uuid(), sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), result: studyExerciseSolutionResponseSchema,
        }).strict());
        requirePrincipal(winner.principalId, request.guestAiPrincipal!);
        if (winner.sourceFingerprint !== record.sourceFingerprint)
          throw new ApiError(409, "conflict", "Nguồn bài tập đã thay đổi trong lúc tạo lời giải.");
        await requireCompletedGuestAiSession(redis, db, request.guestAiPrincipal!, record.plannedSessionId);
        return winner.result;
      }
      await requireCompletedGuestAiSession(redis, db, request.guestAiPrincipal!, record.plannedSessionId);
      return result;
    } finally {
      try {
        await redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
          1, leaseKey, leaseToken,
        );
      } catch { /* Lease expires after two minutes if Redis is temporarily unavailable. */ }
    }
  });
}
