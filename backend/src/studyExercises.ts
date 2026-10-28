import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError, missing } from "./errors.js";
import {
  isSessionRemoved,
  projectSessionMetrics,
  type Session,
  type World,
} from "./adventure/domain.js";
import {
  parseGroundedStudyExercises,
  studyExercisePreparationRequestSchema,
  studyExercisePreparationResponseSchema,
  studyExerciseQuestionSchema,
  studyExerciseSolutionResponseSchema,
  type StudyExerciseQuestion,
  type StudyExerciseProviderQuestion,
  type StudyExercisePreparationResponse,
  type StudyExerciseSolutionResponse,
} from "./studyExerciseSchemas.js";
import {
  generateStudyExerciseQuestions,
  generateStudyExerciseSolutions,
} from "./studyExerciseProvider.js";

export const STUDY_EXERCISE_BODY_LIMIT_BYTES = 256 * 1024;
const UNBOUND_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GENERATION_LEASE_MS = 2 * 60 * 1000;
const plannedSessionParamsSchema = z.object({ plannedSessionId: z.uuid() }).strict();

export type StudyExerciseProviders = {
  generateQuestions: typeof generateStudyExerciseQuestions;
  generateSolutions: typeof generateStudyExerciseSolutions;
};

type ExerciseSetRow = Prisma.StudyExerciseSetGetPayload<Record<string, never>>;
type SolutionReservation =
  | { cached: StudyExerciseSolutionResponse }
  | {
      cached: null;
      generationToken: string;
      sourceText: string;
      sourceFingerprint: string;
      plannedSessionId: string;
      questions: StudyExerciseQuestion[];
    };

function fingerprint(sourceText: string) {
  return createHash("sha256").update(sourceText, "utf8").digest("hex");
}

function conflict(message: string): never {
  throw new ApiError(409, "conflict", message);
}

function unavailableAccount(): never {
  throw new ApiError(401, "authentication-error", "Account is unavailable");
}

async function lockWorldAndRequireActiveAccount(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<World> {
  const states = await tx.$queryRaw<{ state: World }[]>`
    SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
  const world = states[0]?.state;
  if (!world)
    throw new ApiError(503, "service-unavailable", "Adventure state is unavailable");

  // Read account status after the world lock without acquiring a competing
  // users-row lock. Other privacy routes may lock the user before the world.
  const users = await tx.$queryRaw<Array<{
    id: string;
    suspended_at: Date | null;
    deleted_at: Date | null;
  }>>`SELECT id, suspended_at, deleted_at FROM users WHERE id = ${userId}::uuid`;
  const user = users[0];
  if (!user || user.suspended_at || user.deleted_at) unavailableAccount();
  return world;
}

async function lockExerciseSet(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
) {
  await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM study_exercise_sets
    WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
    FOR UPDATE`;
  return tx.studyExerciseSet.findFirst({ where: { id, user_id: userId } });
}

function savedSessionForOwner(world: World, sessionId: string, userId: string) {
  const session = world.sessions?.[sessionId];
  if (session && session.userId !== userId) missing("Không tìm thấy bộ bài tập.");
  if (isSessionRemoved(world, sessionId))
    throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
  return session ?? null;
}

function preparationDto(row: ExerciseSetRow): StudyExercisePreparationResponse {
  if (row.status !== "ready")
    conflict(row.status === "preparing"
      ? "Bộ bài tập đang được tạo. Hãy thử tải lại sau."
      : "Bộ bài tập không còn khả dụng. Hãy tạo lại từ nguồn đã xác nhận.");
  try {
    return studyExercisePreparationResponseSchema.parse({
      id: row.id,
      plannedSessionId: row.planned_session_id,
      mode: row.mode,
      ...(row.mode === "generated" ? { sourceFingerprint: row.source_fingerprint } : {}),
      exercises: row.exercises,
    });
  } catch {
    throw new ApiError(500, "internal-error", "Study exercise data is unavailable");
  }
}

function solutionDto(value: unknown): StudyExerciseSolutionResponse {
  try {
    return studyExerciseSolutionResponseSchema.parse(value);
  } catch {
    throw new ApiError(500, "internal-error", "Study exercise solution is unavailable");
  }
}

function generatedQuestions(
  providerQuestions: StudyExerciseProviderQuestion[],
  sourceText: string,
  count: number,
) {
  const grounded = parseGroundedStudyExercises(
    { exercises: providerQuestions },
    sourceText,
    count,
  );
  const questions = grounded.map((exercise) => studyExerciseQuestionSchema.parse({
    id: randomUUID(),
    prompt: exercise.prompt,
    ...(exercise.choices === undefined ? {} : { choices: exercise.choices }),
  }));
  return {
    questions,
    evidence: grounded.map((exercise, index) => ({
      questionId: questions[index]!.id,
      excerpt: exercise.evidenceExcerpt,
    })),
  };
}

function signalForRequest(request: FastifyRequest) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.raw.aborted) abort();
  else request.raw.once("aborted", abort);
  return {
    signal: controller.signal,
    dispose: () => request.raw.off("aborted", abort),
  };
}

async function tombstoneRequest(
  tx: Prisma.TransactionClient,
  userId: string,
  plannedSessionId: string,
  requestId: string,
) {
  const key = {
    user_id_planned_session_id_request_id: {
      user_id: userId,
      planned_session_id: plannedSessionId,
      request_id: requestId,
    },
  };
  await tx.studyExerciseInvalidation.upsert({
    where: key,
    create: {
      user_id: userId,
      planned_session_id: plannedSessionId,
      request_id: requestId,
      expires_at: new Date(Date.now() + UNBOUND_DRAFT_TTL_MS),
    },
    update: { expires_at: new Date(Date.now() + UNBOUND_DRAFT_TTL_MS) },
  });
}

async function expireUnboundIfNeeded(
  tx: Prisma.TransactionClient,
  row: ExerciseSetRow,
  savedSession: Session | null,
) {
  const expiresAt = row.expires_at?.getTime();
  const startedBeforeExpiry = savedSession !== null && expiresAt !== undefined &&
    savedSession.started < expiresAt;
  const expiredBeforeStart = savedSession !== null && expiresAt !== undefined && !startedBeforeExpiry;
  const expiredUnstarted = savedSession === null && expiresAt !== undefined && expiresAt <= Date.now();
  if (row.bound_at === null && (expiredBeforeStart || expiredUnstarted)) {
    await tx.studyExerciseSet.delete({ where: { id: row.id } });
    return true;
  }
  if (savedSession !== null && row.bound_at === null) {
    await tx.studyExerciseSet.update({
      where: { id: row.id },
      data: { bound_at: new Date(), expires_at: null },
    });
    return false;
  }
  return false;
}

export function studyExerciseRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (request: FastifyRequest) => Promise<void>,
  providers: StudyExerciseProviders = {
    generateQuestions: generateStudyExerciseQuestions,
    generateSolutions: generateStudyExerciseSolutions,
  },
) {
  const authenticated = { preHandler: authenticate };

  app.post("/api/v1/study-exercises", {
    ...authenticated,
    bodyLimit: STUDY_EXERCISE_BODY_LIMIT_BYTES,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const input = studyExercisePreparationRequestSchema.parse(request.body);
    const sourceFingerprint = fingerprint(input.text);
    const setId = input.requestId;
    const generationToken = input.mode === "generated" ? randomUUID() : null;
    const now = new Date();

    const reserved = await db.$transaction(async (tx) => {
      const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
      const existingSession = world.sessions?.[input.plannedSessionId];
      if (existingSession) {
        if (existingSession.userId !== request.userId) missing("Không tìm thấy phiên học.");
        if (isSessionRemoved(world, input.plannedSessionId))
          throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
        conflict("Chỉ có thể chuẩn bị bài tập trước khi phiên học được lưu.");
      }
      if (isSessionRemoved(world, input.plannedSessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");

      await tx.studyExerciseInvalidation.deleteMany({ where: { expires_at: { lte: now } } });
      const invalidation = await tx.studyExerciseInvalidation.findUnique({
        where: {
          user_id_planned_session_id_request_id: {
            user_id: request.userId,
            planned_session_id: input.plannedSessionId,
            request_id: input.requestId,
          },
        },
      });
      if (invalidation) conflict("Yêu cầu tạo bộ bài tập đã bị hủy.");

      const priorRequest = await tx.studyExerciseSet.findUnique({ where: { id: setId } });
      if (priorRequest) {
        if (priorRequest.user_id !== request.userId || priorRequest.planned_session_id !== input.plannedSessionId)
          conflict("Yêu cầu tạo bộ bài tập không hợp lệ.");
        const expectedCount = input.mode === "generated" ? input.count : null;
        if (priorRequest.mode !== input.mode || priorRequest.source_fingerprint !== sourceFingerprint ||
            priorRequest.requested_count !== expectedCount)
          conflict("Mã yêu cầu đã được dùng cho nội dung khác.");
        if (priorRequest.bound_at === null && priorRequest.expires_at !== null &&
            priorRequest.expires_at.getTime() <= now.getTime()) {
          await tx.studyExerciseSet.delete({ where: { id: priorRequest.id } });
          await tombstoneRequest(tx, request.userId, input.plannedSessionId, input.requestId);
          return { expired: true as const };
        }
        if (priorRequest.status === "ready") return { row: priorRequest, generate: false };
        conflict(priorRequest.status === "preparing"
          ? "Bộ bài tập đang được tạo. Hãy thử tải lại sau."
          : "Yêu cầu tạo bộ bài tập không còn khả dụng.");
      }

      // Expire unbound rows and request tombstones opportunistically; bound rows have no expiry.
      await tx.studyExerciseSet.deleteMany({
        where: { expires_at: { lte: now }, bound_at: null },
      });
      const previousSets = await tx.studyExerciseSet.findMany({
        where: {
          user_id: request.userId,
          planned_session_id: input.plannedSessionId,
          status: { in: ["preparing", "ready", "failed"] },
        },
      });
      if (previousSets.some((set) => set.bound_at !== null))
        conflict("Phiên học đã bắt đầu; không thể thay nguồn bài tập.");
      for (const previous of previousSets) {
        await tombstoneRequest(tx, request.userId, input.plannedSessionId, previous.id);
        await tx.studyExerciseSet.delete({ where: { id: previous.id } });
      }
      const row = await tx.studyExerciseSet.create({
        data: {
          id: setId,
          user_id: request.userId,
          planned_session_id: input.plannedSessionId,
          mode: input.mode,
          requested_count: input.mode === "generated" ? input.count : null,
          status: input.mode === "provided" ? "ready" : "preparing",
          source_text: input.text,
          source_fingerprint: sourceFingerprint,
          exercises: input.mode === "provided"
            ? [{ id: randomUUID(), prompt: input.text }]
            : [],
          evidence: [],
          generation_token: generationToken,
          generation_lease_expires_at: generationToken
            ? new Date(now.getTime() + GENERATION_LEASE_MS)
            : null,
          expires_at: new Date(now.getTime() + UNBOUND_DRAFT_TTL_MS),
        },
      });
      return { row, generate: input.mode === "generated" };
    }, { timeout: 15_000 });

    if ("expired" in reserved) missing("Bộ bài tập đã hết hạn. Hãy tạo yêu cầu mới.");
    if (input.mode !== "generated" || !reserved.generate)
      return preparationDto(reserved.row);

    const requestSignal = signalForRequest(request);
    try {
      const providerQuestions = await providers.generateQuestions(
        input.text,
        input.count,
        requestSignal.signal,
      );
      const prepared = generatedQuestions(providerQuestions, input.text, input.count);
      const finalized = await db.$transaction(async (tx) => {
        const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
        const current = await lockExerciseSet(tx, setId, request.userId);
        if (!current || current.status !== "preparing" || current.generation_token !== generationToken ||
            current.source_fingerprint !== sourceFingerprint)
          conflict("Nguồn hoặc bộ bài tập đã thay đổi trong lúc tạo. Hãy tải lại.");
        const saved = world.sessions?.[input.plannedSessionId];
        if (saved && saved.userId !== request.userId) missing("Không tìm thấy bộ bài tập.");
        if (isSessionRemoved(world, input.plannedSessionId))
          throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
        const updated = await tx.studyExerciseSet.update({
          where: { id: setId },
          data: {
            status: "ready",
            exercises: prepared.questions,
            evidence: prepared.evidence,
            generation_token: null,
            generation_lease_expires_at: null,
            ...(saved ? { bound_at: new Date(), expires_at: null } : {}),
          },
        });
        return updated;
      }, { timeout: 15_000 });
      return preparationDto(finalized);
    } catch (error) {
      await db.$transaction(async (tx) => {
        await lockWorldAndRequireActiveAccount(tx, request.userId);
        const current = await lockExerciseSet(tx, setId, request.userId);
        if (current?.status === "preparing" && current.generation_token === generationToken) {
          await tx.studyExerciseSet.update({
            where: { id: setId },
            data: {
              status: "failed",
              generation_token: null,
              generation_lease_expires_at: null,
            },
          });
        }
      }, { timeout: 15_000 }).catch(() => undefined);
      throw error;
    } finally {
      requestSignal.dispose();
    }
  });

  app.get("/api/v1/study-exercises/:id", authenticated, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.params);
    const result = await db.$transaction(async (tx) => {
      const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
      const row = await lockExerciseSet(tx, id, request.userId);
      if (!row || row.status === "invalidated") return { expired: false, response: null };
      const saved = savedSessionForOwner(world, row.planned_session_id, request.userId);
      if (await expireUnboundIfNeeded(tx, row, saved))
        return { expired: true, response: null };
      return { expired: false, response: preparationDto(row) };
    }, { timeout: 15_000 });
    if (!result.response) missing(result.expired ? "Bộ bài tập đã hết hạn." : "Không tìm thấy bộ bài tập.");
    return result.response;
  });

  app.get("/api/v1/study-exercises/session/:plannedSessionId", authenticated, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { plannedSessionId } = plannedSessionParamsSchema.parse(request.params);
    const result = await db.$transaction(async (tx) => {
      const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
      const saved = savedSessionForOwner(world, plannedSessionId, request.userId);
      if (isSessionRemoved(world, plannedSessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      const row = await tx.studyExerciseSet.findFirst({
        where: { user_id: request.userId, planned_session_id: plannedSessionId, status: "ready" },
        orderBy: { created_at: "desc" },
      });
      if (!row) return { expired: false, response: null };
      const locked = await lockExerciseSet(tx, row.id, request.userId);
      if (!locked || locked.status !== "ready") return { expired: false, response: null };
      if (await expireUnboundIfNeeded(tx, locked, saved))
        return { expired: true, response: null };
      return { expired: false, response: preparationDto(locked) };
    }, { timeout: 15_000 });
    if (!result.response) missing(result.expired ? "Bộ bài tập đã hết hạn." : "Không tìm thấy bộ bài tập.");
    return result.response;
  });

  app.post("/api/v1/study-exercises/session/:plannedSessionId/bind", {
    ...authenticated,
    bodyLimit: 1024,
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { plannedSessionId } = plannedSessionParamsSchema.parse(request.params);
    const result = await db.$transaction(async (tx) => {
      const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
      const saved = savedSessionForOwner(world, plannedSessionId, request.userId);
      if (isSessionRemoved(world, plannedSessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      const candidate = await tx.studyExerciseSet.findFirst({
        where: { user_id: request.userId, planned_session_id: plannedSessionId, status: "ready" },
        orderBy: { created_at: "desc" },
      });
      if (!candidate) return { expired: false };
      const row = await lockExerciseSet(tx, candidate.id, request.userId);
      if (!row || row.status !== "ready") return { expired: false };
      if (await expireUnboundIfNeeded(tx, row, saved))
        return { expired: true };
      if (row.bound_at === null) {
        await tx.studyExerciseSet.update({
          where: { id: row.id },
          data: { bound_at: new Date(), expires_at: null },
        });
      }
      return { expired: false };
    }, { timeout: 15_000 });
    if (result.expired) missing("Bộ bài tập đã hết hạn.");
    return { ok: true };
  });

  app.delete("/api/v1/study-exercises/session/:plannedSessionId/requests/:requestId", authenticated, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { plannedSessionId, requestId } = z.object({
      plannedSessionId: z.uuid(),
      requestId: z.uuid(),
    }).strict().parse(request.params);
    await db.$transaction(async (tx) => {
      const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
      savedSessionForOwner(world, plannedSessionId, request.userId);
      if (isSessionRemoved(world, plannedSessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      const row = await lockExerciseSet(tx, requestId, request.userId);
      if (row?.planned_session_id === plannedSessionId)
        await tx.studyExerciseSet.delete({ where: { id: requestId } });
      await tombstoneRequest(tx, request.userId, plannedSessionId, requestId);
    }, { timeout: 15_000 });
    return { ok: true };
  });

  app.post("/api/v1/study-exercises/:id/solution", {
    ...authenticated,
    bodyLimit: 1024,
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.params);
    const reservation = await db.$transaction<SolutionReservation>(async (tx) => {
      const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
      const row = await lockExerciseSet(tx, id, request.userId);
      if (!row || row.status === "invalidated") missing("Không tìm thấy bộ bài tập.");
      const session = savedSessionForOwner(world, row.planned_session_id, request.userId);
      if (!session) conflict("Lời giải chỉ mở sau khi phiên học đã được lưu và hoàn tất.");
      if (await expireUnboundIfNeeded(tx, row, session))
        missing("Bộ bài tập đã hết hạn.");
      if (row.status !== "ready")
        conflict("Bộ bài tập chưa sẵn sàng. Hãy tải lại trước khi yêu cầu lời giải.");
      if (fingerprint(row.source_text) !== row.source_fingerprint)
        conflict("Nguồn bài tập đã thay đổi. Hãy tạo lại bộ bài tập.");
      if (!projectSessionMetrics(session, world.sessionOverrides?.[row.planned_session_id]).effectiveMetrics.completed)
        conflict("Lời giải chỉ mở sau khi phiên học đạt đủ mục tiêu.");

      if (row.solution !== null) return { cached: solutionDto(row.solution) };
      if (row.solution_generation_token && row.solution_lease_expires_at &&
          row.solution_lease_expires_at.getTime() > Date.now())
        conflict("Lời giải đang được tạo. Hãy thử lại sau.");

      const questions = (() => {
        try {
          return studyExercisePreparationResponseSchema.parse({
            id: row.id,
            plannedSessionId: row.planned_session_id,
            mode: row.mode,
            ...(row.mode === "generated" ? { sourceFingerprint: row.source_fingerprint } : {}),
            exercises: row.exercises,
          }).exercises;
        } catch {
          throw new ApiError(500, "internal-error", "Study exercise data is unavailable");
        }
      })();
      const generationToken = randomUUID();
      await tx.studyExerciseSet.update({
        where: { id: row.id },
        data: {
          solution_generation_token: generationToken,
          solution_lease_expires_at: new Date(Date.now() + GENERATION_LEASE_MS),
        },
      });
      return {
        cached: null,
        generationToken,
        sourceText: row.source_text,
        sourceFingerprint: row.source_fingerprint,
        plannedSessionId: row.planned_session_id,
        questions,
      };
    }, { timeout: 15_000 });

    if (reservation.cached !== null) return reservation.cached;
    const requestSignal = signalForRequest(request);
    try {
      const generated = await providers.generateSolutions(
        reservation.sourceText,
        reservation.questions,
        requestSignal.signal,
      );
      const solutions = solutionDto({ exercises: generated });
      const final = await db.$transaction(async (tx) => {
        const world = await lockWorldAndRequireActiveAccount(tx, request.userId);
        const row = await lockExerciseSet(tx, id, request.userId);
        if (!row || row.status !== "ready" || row.solution_generation_token !== reservation.generationToken ||
            row.source_fingerprint !== reservation.sourceFingerprint || fingerprint(row.source_text) !== reservation.sourceFingerprint)
          conflict("Nguồn hoặc bộ bài tập đã thay đổi trong lúc tạo lời giải.");
        const session = savedSessionForOwner(world, reservation.plannedSessionId, request.userId);
        if (!session) conflict("Phiên học không còn khả dụng.");
        if (!projectSessionMetrics(session, world.sessionOverrides?.[reservation.plannedSessionId]).effectiveMetrics.completed)
          conflict("Phiên học không còn đạt đủ mục tiêu.");
        const updated = await tx.studyExerciseSet.update({
          where: { id },
          data: {
            solution: solutions,
            solution_generation_token: null,
            solution_lease_expires_at: null,
          },
        });
        return solutionDto(updated.solution);
      }, { timeout: 15_000 });
      return final;
    } catch (error) {
      await db.$transaction(async (tx) => {
        await lockWorldAndRequireActiveAccount(tx, request.userId);
        const row = await lockExerciseSet(tx, id, request.userId);
        if (row?.solution_generation_token === reservation.generationToken) {
          await tx.studyExerciseSet.update({
            where: { id },
            data: { solution_generation_token: null, solution_lease_expires_at: null },
          });
        }
      }, { timeout: 15_000 }).catch(() => undefined);
      throw error;
    } finally {
      requestSignal.dispose();
    }
  });
}
