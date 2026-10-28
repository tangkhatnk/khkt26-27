import { adventureRoutes } from "./adventure/routes.js";
import { experimentRoutes } from "./experiments.js";
import { publicMaterialSummaryRoutes } from "./publicMaterialSummaries.js";
import { publicReportRoutes } from "./publicReport.js";
import { studyExerciseRoutes } from "./studyExercises.js";
import { adminRoutes } from "./admin.js";
import { localRead, verifyLocalUrl } from "./localStorage.js";
import { Metrics } from "./metrics.js";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { createRedis } from "./redis.js";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { ApiError, missing } from "./errors.js";
import {
  hashToken,
  issueTokens,
  rotateToken,
  verifyActiveAccess,
  verifyOAuth,
  publicUser,
  userSelect,
} from "./auth.js";
import {
  registerSchema,
  loginSchema,
  sessionSchema,
  listSchema,
  uuid,
  topicId,
  name,
  difficulty,
  generateSchema,
  fileLimits,
} from "./schemas.js";
import { computeStats } from "./stats.js";
import {
  uploadFile,
  deleteFile,
  documentDto,
  storageHealth,
  matchesMime,
} from "./storage.js";
import { generateQuestions } from "./ai.js";
import { generateOwnedQuiz } from "./quizGeneration.js";
import {
  materialReadRequestSchema,
  materialSummaryRequestSchema,
  MATERIAL_READ_BODY_LIMIT_BYTES,
  MATERIAL_SUMMARY_BODY_LIMIT_BYTES,
  type MaterialReadInput,
} from "./materialReadingSchemas.js";
import { readMaterialDocument, summarizeMaterialText } from "./materialReading.js";
import { STUDY_GUIDE_BODY_LIMIT_BYTES, studyGuideRequestSchema } from "./studyGuideSchemas.js";
import { generateStudyGuide } from "./studyGuide.js";
import { geminiRequestSchema } from "./geminiSchemas.js";
import { realtime } from "./realtime.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}
export async function buildApp(deps?: {
  db?: PrismaClient;
  redis?: Redis;
  logger?: boolean;
  storageHealth?: () => Promise<unknown>;
  onStartupStep?: (step: string) => void;
  verifyOAuth?: typeof verifyOAuth;
}) {
  deps?.onStartupStep?.("1. Initializing DB client...");
  const db = deps?.db ?? new PrismaClient();
  const verifyOAuthIdentity = deps?.verifyOAuth ?? verifyOAuth;
  deps?.onStartupStep?.("1.1. Initializing Redis client...");
  const redis = deps?.redis ?? createRedis(config.REDIS_URL);
  const app = Fastify({
    logger: deps?.logger ?? {
      redact: ["req.headers.authorization", "req.body", "req.url"],
      serializers: {
        req: (req) => ({
          method: req.method,
          url: req.url?.split("?")[0],
          id: req.id,
        }),
      },
    },
    bodyLimit: 1024 * 1024,
    requestTimeout: 120000,
    genReqId: () => randomUUID(),
  });
  deps?.onStartupStep?.("2. Registering CORS plugin...");
  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
    strictPreflight: false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Requested-With",
      "Accept",
      "X-Request-ID",
      "Idempotency-Key",
    ],
    exposedHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
  });
  const metrics = new Metrics();
  app.addHook("onResponse", async (req, reply) =>
    metrics.record(
      req.method,
      req.routeOptions.url ?? "unmatched",
      reply.statusCode,
      reply.elapsedTime / 1000,
    ),
  );
  app.decorateRequest("userId", "");
  app.addHook("onClose", async () => {
    try {
      if (!deps?.db) await db.$disconnect();
    } finally {
      if (!deps?.redis) redis.disconnect();
    }
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Request-ID", req.id)
      .header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      )
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("X-XSS-Protection", "1; mode=block")
      .header("Content-Security-Policy", "default-src 'none'");
  });
  deps?.onStartupStep?.("2.1. Registering multipart plugin...");
  await app.register(multipart, {
    limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 1, parts: 2 },
  });
  deps?.onStartupStep?.("2.2. Registering rate-limit plugin...");
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
    redis,
    nameSpace: "rate:",
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
  });
  deps?.onStartupStep?.("2.3. Registering WebSocket plugin...");
  await app.register(websocket, { options: { maxPayload: 4096 } });
  app.addHook("onSend", async (_req, reply, payload) => {
    const reset = Number(reply.getHeader("x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0 && reset < 1000000000)
      reply.header("x-ratelimit-reset", Math.ceil(Date.now() / 1000) + reset);
    return payload;
  });
  app.setErrorHandler((err, req, reply) => {
    const error = err as Error & { statusCode?: number; code?: string };
    const status =
      err instanceof ZodError
        ? 400
        : err instanceof ApiError
          ? err.status
          : error.code === "P2002"
            ? 409
            : (error.statusCode ?? 500);
    const kind =
      err instanceof ApiError
        ? err.kind
        : status === 429
          ? "rate-limit-exceeded"
          : status === 409
            ? "conflict"
            : status < 500
              ? "validation-error"
              : "internal-error";
    const title = kind === "session-removed"
      ? "Phiên học đã bị gỡ."
      : kind === "conflict"
        ? "Dữ liệu đã thay đổi."
        : kind === "validation-error"
          ? "Dữ liệu không hợp lệ."
          : kind.replaceAll("-", " ");
    if (status >= 500) req.log.error({ err }, "Request failed");
    reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: `https://api.pomodoro-focus.com/errors/${kind}`,
        title,
        status,
        detail:
          status >= 500 && !(err instanceof ApiError)
            ? "Service temporarily unavailable"
            : status === 409
              ? "Dữ liệu đã thay đổi hoặc tồn tại. Hãy tải lại rồi thử lại."
              : error.message,
        instance: req.url.split("?")[0],
        ...(status === 429
          ? { retry_after: Number(reply.getHeader("retry-after") ?? 60) }
          : {}),
        ...(err instanceof ZodError
          ? {
              errors: err.issues.map((i) => ({
                field: i.path.join("."),
                message: i.message,
              })),
            }
          : {}),
      });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .type("application/problem+json")
      .send({
        type: "https://api.pomodoro-focus.com/errors/not-found",
        title: "Not found",
        status: 404,
        detail: "Route not found",
        instance: req.url.split("?")[0],
      }),
  );
  deps?.onStartupStep?.("2.4. Registering API routes...");
  const authenticate = async (req: FastifyRequest) => {
    req.userId = await verifyActiveAccess(db,
      req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : undefined,
    );
  };
  adminRoutes(app, db, authenticate);
  adventureRoutes(app, db, authenticate);
  experimentRoutes(app, db);
  publicReportRoutes(app, db);
  publicMaterialSummaryRoutes(app, db, authenticate);
  studyExerciseRoutes(app, db, authenticate);
  const authLimits = { rateLimit: { max: 10, timeWindow: "1 minute" } };
  if (config.STORAGE_DRIVER === "local")
    app.get("/files/:id", async (req, reply) => {
      const { id } = z.object({ id: uuid }).parse(req.params);
      const { expires, signature } = z
        .object({
          expires: z.coerce.number().int(),
          signature: z.string().length(64),
        })
        .parse(req.query);
      if (!verifyLocalUrl(id, expires, signature))
        throw new ApiError(
          403,
          "authorization-error",
          "Download URL expired or invalid",
        );
      const doc = await db.document.findUnique({ where: { id } });
      if (!doc) missing();
      return reply
        .type(doc.mime_type)
        .header(
          "Content-Disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        )
        .send(await localRead(doc.storage_key));
    });
  app.get("/metrics", async (req, reply) => {
    if (!config.METRICS_TOKEN)
      throw new ApiError(
        503,
        "service-unavailable",
        "Metrics are not configured",
      );
    if (req.headers.authorization !== `Bearer ${config.METRICS_TOKEN}`)
      throw new ApiError(
        401,
        "authentication-error",
        "Invalid metrics credentials",
      );
    let cursor = "0";
    let active = 0;
    do {
      const result = await redis.scan(cursor, "MATCH", "focus:*", "COUNT", 100);
      cursor = result[0];
      if (result[1].length) {
        const values = await redis.mget(...result[1]);
        active += values.filter(
          (value) => value && Number(JSON.parse(value).deadline) > Date.now(),
        ).length;
      }
    } while (cursor !== "0");
    return reply.type("text/plain; version=0.0.4").send(metrics.render(active));
  });
  app.get("/health", async (_req, reply) => {
    const checks = await Promise.allSettled([
      db.$queryRaw`SELECT 1`,
      redis.ping(),
      config.STORAGE_DRIVER === "disabled" ? Promise.resolve() : (deps?.storageHealth ?? storageHealth)(),
    ]);
    const services = Object.fromEntries(
      [
        "database",
        "redis",
        config.STORAGE_DRIVER === "local" ? "local_storage" : config.STORAGE_DRIVER === "disabled" ? "document_storage" : "s3",
      ].map((k, i) => [k, i === 2 && config.STORAGE_DRIVER === "disabled"
        ? "disabled" : checks[i].status === "fulfilled" ? "up" : "down"]),
    );
    const healthy = checks.every((c) => c.status === "fulfilled");
    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? "healthy" : "degraded",
      mode:
        config.STORAGE_DRIVER === "local"
          ? "local-development"
          : config.NODE_ENV,
      version: "1.0.0",
      uptime: Math.floor(process.uptime()),
      services,
    });
  });
  app.post(
    "/api/v1/auth/register",
    { config: authLimits },
    async (req, reply) => {
      const body = registerSchema.parse(req.body);
      if (
        await db.user.findUnique({
          where: { email: body.email },
          select: { id: true },
        })
      )
        throw new ApiError(409, "conflict", "Email already registered");
      const user = await db.user.create({
        data: {
          email: body.email,
          name: body.name,
          password_hash: await bcrypt.hash(body.password, 12),
        },
      });
      return reply
        .code(201)
        .send({ user: publicUser(user), tokens: await issueTokens(db, user) });
    },
  );
  app.post("/api/v1/auth/login", { config: authLimits }, async (req) => {
    const body = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: body.email } });
    // Perform password hashing even for absent users to avoid a fast user enumeration path.
    const valid = await bcrypt.compare(
      body.password,
      user?.password_hash ??
        "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
    );
    if (!user || !valid || !user.password_hash)
      throw new ApiError(
        401,
        "authentication-error",
        "Invalid email or password",
      );
    return { user: publicUser(user), tokens: await issueTokens(db, user) };
  });
  app.post(
    "/api/v1/auth/oauth/:provider",
    { config: authLimits },
    async (req) => {
      const { provider } = z
        .object({ provider: z.enum(["google", "apple"]) })
        .parse(req.params);
      const { id_token } = z
        .object({ id_token: z.string().min(1).max(16000) })
        .parse(req.body);
      const identity = await verifyOAuthIdentity(provider, id_token);
      let user = await db.user.findUnique({
        where: {
          auth_provider_auth_provider_id: {
            auth_provider: provider,
            auth_provider_id: identity.id,
          },
        },
      });
      if (!user) {
        if (await db.user.findUnique({ where: { email: identity.email } }))
          throw new ApiError(
            409,
            "conflict",
            "Sign in using the original provider; automatic account linking is disabled",
          );
        user = await db.user.create({
          data: {
            email: identity.email,
            name: identity.name.slice(0, 100),
            auth_provider: provider,
            auth_provider_id: identity.id,
          },
        });
      }
      return { user: publicUser(user), tokens: await issueTokens(db, user) };
    },
  );
  app.post("/api/v1/auth/refresh", { config: authLimits }, async (req) =>
    rotateToken(
      db,
      z.object({ refresh_token: z.string().min(1).max(256) }).parse(req.body)
        .refresh_token,
    ),
  );
  await app.register(
    async (api) => {
      api.addHook("onRequest", authenticate);
      api.post("/auth/logout", async (req, reply) => {
        await db.refreshToken.deleteMany({ where: { user_id: req.userId } });
        return reply.code(204).send();
      });
      api.get("/users/me", (req) =>
        db.user.findUniqueOrThrow({
          where: { id: req.userId },
          select: userSelect,
        }),
      );
      api.put("/users/me", (req) =>
        db.user.update({
          where: { id: req.userId },
          data: z
            .object({
              name: name.optional(),
              avatar_url: z.url().max(2048).nullable().optional(),
            })
            .parse(req.body),
          select: userSelect,
        }),
      );
      api.get("/topics", async (req) => ({
        topics: await db.topic
          .findMany({
            select: {
              id: true,
              name: true,
              icon: true,
              _count: {
                select: {
                  questions: {
                    where: {
                      OR: [{ owner_id: null }, { owner_id: req.userId }],
                    },
                  },
                },
              },
            },
          })
          .then((rows) =>
            rows.map((t) => ({
              id: t.id,
              name: t.name,
              icon: t.icon,
              question_count: t._count.questions,
            })),
          ),
      }));
      api.post("/sessions", async (req, reply) => {
        const body = sessionSchema.parse(req.body);
        if (body.client_id) {
          const existing = await db.studySession.findUnique({
            where: {
              user_id_client_id: {
                user_id: req.userId,
                client_id: body.client_id,
              },
            },
          });
          if (existing) return reply.code(200).send(existing);
        }
        if (!(await db.topic.findUnique({ where: { id: body.topic_id } })))
          missing("Topic not found");
        const documents = await db.document.findMany({
          where: {
            id: { in: body.documents.map((d) => d.id) },
            user_id: req.userId,
          },
        });
        if (documents.length !== body.documents.length)
          missing("Document not found");
        // Never persist arbitrary client document URLs; metadata comes from owned objects.
        const canonical = await Promise.all(documents.map(documentDto));
        const data = {
          ...body,
          user_id: req.userId,
          documents: canonical.map((d) => ({
            id: d.id,
            name: d.name,
            url: d.url,
            thumbnail_url: d.thumbnail_url,
          })),
        };
        const row = body.client_id
          ? await db.studySession.upsert({
              where: {
                user_id_client_id: {
                  user_id: req.userId,
                  client_id: body.client_id,
                },
              },
              create: data,
              update: {},
            })
          : await db.studySession.create({ data });
        return reply.code(201).send(row);
      });
      api.get("/sessions", async (req) => {
        const q = listSchema.parse(req.query);
        const where = {
          user_id: req.userId,
          topic_id: q.topic_id,
          is_completed: q.is_completed,
        };
        const [data, total] = await db.$transaction([
          db.studySession.findMany({
            where,
            skip: (q.page - 1) * q.limit,
            take: q.limit,
            orderBy: { created_at: q.sort.endsWith("asc") ? "asc" : "desc" },
          }),
          db.studySession.count({ where }),
        ]);
        return {
          data,
          pagination: {
            page: q.page,
            limit: q.limit,
            total,
            total_pages: Math.ceil(total / q.limit),
          },
        };
      });
      api.get("/sessions/stats", async (req) => {
        const q = z
          .object({
            period: z
              .enum(["day", "week", "month", "year", "all"])
              .default("all"),
          })
          .parse(req.query);
        const days = { day: 1, week: 7, month: 30, year: 365, all: 0 }[
          q.period
        ];
        return computeStats(
          await db.studySession.findMany({
            where: {
              user_id: req.userId,
              ...(days
                ? {
                    created_at: { gte: new Date(Date.now() - days * 86400000) },
                  }
                : {}),
            },
          }),
        );
      });
      api.get("/sessions/:id", async (req) => {
        const { id } = z.object({ id: uuid }).parse(req.params);
        const row = await db.studySession.findFirst({
          where: { id, user_id: req.userId },
          include: { answers: true },
        });
        if (!row) missing();
        const documents = row.documents as { id: string }[];
        return {
          ...row,
          documents: await Promise.all(
            (
              await db.document.findMany({
                where: {
                  user_id: req.userId,
                  id: { in: documents.map((d) => d.id) },
                },
              })
            ).map(documentDto),
          ),
        };
      });
      api.get("/quizzes", async (req) => {
        const q = z
          .object({
            topic_id: topicId,
            limit: z.coerce.number().int().min(1).max(50).default(10),
            difficulty: difficulty.optional(),
          })
          .parse(req.query);
        const questions = await db.quizQuestion.findMany({
          where: {
            topic_id: q.topic_id,
            difficulty: q.difficulty,
            owner_id: req.userId,
            source: { in: ["gemini_generated", "ai_generated"] },
          },
          take: q.limit,
          orderBy: { created_at: "desc" },
        });
        return { topic_id: q.topic_id, questions };
      });
      api.post("/quizzes/answer", async (req, reply) => {
        const body = z
          .object({
            session_id: uuid,
            question_id: uuid,
            selected_index: z.number().int().min(0).max(3),
          })
          .parse(req.body);
        const answer = await db.$transaction(async (tx) => {
          // Lock the parent so concurrent submissions cannot race score updates.
          const owned = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM study_sessions WHERE id=${body.session_id}::uuid AND user_id=${req.userId}::uuid FOR UPDATE`;
          if (!owned.length) missing();
          const session = await tx.studySession.findUniqueOrThrow({
            where: { id: body.session_id },
          });
          const question = await tx.quizQuestion.findFirst({
            where: {
              id: body.question_id,
              topic_id: session.topic_id,
              owner_id: req.userId,
              source: { in: ["gemini_generated", "ai_generated"] },
            },
          });
          if (!question) missing("Question not found");
          const old = await tx.quizAnswer.findUnique({
            where: {
              session_id_question_id: {
                session_id: body.session_id,
                question_id: body.question_id,
              },
            },
          });
          if (old) return old;
          if (
            (await tx.quizAnswer.count({
              where: { session_id: body.session_id },
            })) >= 50
          )
            throw new ApiError(
              422,
              "validation-error",
              "Maximum 50 answers per session",
            );
          const row = await tx.quizAnswer.create({
            data: {
              ...body,
              is_correct: question.correct_index === body.selected_index,
            },
          });
          const answers = await tx.quizAnswer.findMany({
            where: { session_id: body.session_id },
          });
          await tx.studySession.update({
            where: { id: body.session_id },
            data: {
              quiz_score: answers.filter((a) => a.is_correct).length,
              total_quiz_questions: answers.length,
            },
          });
          return row;
        });
        return reply.code(201).send(answer);
      });
      api.post("/materials/read", {
        bodyLimit: MATERIAL_READ_BODY_LIMIT_BYTES,
        config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      }, async (req, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const closed = () => { if (!reply.raw.writableEnded) abort(); };
        req.raw.once("aborted", abort);
        reply.raw.once("close", closed);
        try {
          const body = req.body as MaterialReadInput;
          materialReadRequestSchema.parse(body);
          return await readMaterialDocument(body, controller.signal);
        }
        finally { req.raw.off("aborted", abort); reply.raw.off("close", closed); }
      });
      api.post("/materials/summarize", {
        bodyLimit: MATERIAL_SUMMARY_BODY_LIMIT_BYTES,
        config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      }, async (req, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const closed = () => { if (!reply.raw.writableEnded) abort(); };
        req.raw.once("aborted", abort);
        reply.raw.once("close", closed);
        try {
          const body = materialSummaryRequestSchema.parse(req.body);
          return await summarizeMaterialText(body, controller.signal);
        } finally {
          req.raw.off("aborted", abort);
          reply.raw.off("close", closed);
        }
      });
      api.post("/materials/generate", {
        bodyLimit: STUDY_GUIDE_BODY_LIMIT_BYTES,
        config: { rateLimit: { max: 3, timeWindow: "1 minute" } },
      }, async (req, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const closed = () => { if (!reply.raw.writableEnded) abort(); };
        req.raw.once("aborted", abort);
        reply.raw.once("close", closed);
        try {
          const body = studyGuideRequestSchema.parse(req.body);
          return await generateStudyGuide(body, controller.signal);
        } finally {
          req.raw.off("aborted", abort);
          reply.raw.off("close", closed);
        }
      });
      api.post("/quiz/generate", {
        bodyLimit: 256 * 1024,
        config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      }, async (req, reply) => {
        const body = geminiRequestSchema.parse(req.body);
        const started = performance.now();
        const questions = await generateOwnedQuiz(db, req.userId, body)
          .finally(() => metrics.recordQuiz((performance.now() - started) / 1000));
        return reply.code(201).send(questions);
      });
      api.post(
        "/quizzes/generate",
        { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
        async (req) => {
          const body = generateSchema.parse(req.body);
          if (!(await db.topic.findUnique({ where: { id: body.topic_id } })))
            missing("Topic not found");
          const ids = [...new Set(body.document_ids)];
          const documents = await db.document.findMany({
            where: { id: { in: ids }, user_id: req.userId },
          });
          if (documents.length !== ids.length) missing("Document not found");
          const started = performance.now();
          const questions = await generateQuestions(
            documents,
            body.topic_id,
            body.question_count,
            body.difficulty,
          ).finally(() =>
            metrics.recordQuiz((performance.now() - started) / 1000),
          );
          return {
            generated_questions: await db.$transaction(
              questions.map((q) =>
                db.quizQuestion.create({
                  data: {
                    ...q,
                    topic_id: body.topic_id,
                    owner_id: req.userId,
                    difficulty: body.difficulty,
                    source: "ai_generated",
                  },
                }),
              ),
            ),
          };
        },
      );
      api.post(
        "/documents/upload",
        { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
        async (req, reply) => {
          const file = await req.file();
          if (!file || file.fieldname !== "file")
            throw new ApiError(
              400,
              "validation-error",
              "A file field is required",
            );
          const limit = fileLimits[file.mimetype];
          if (!limit)
            throw new ApiError(
              400,
              "validation-error",
              "Unsupported file type",
            );
          const buffer = await file.toBuffer();
          if (
            !buffer.length ||
            buffer.length > limit ||
            file.file.truncated ||
            !matchesMime(buffer, file.mimetype)
          )
            throw new ApiError(
              400,
              "validation-error",
              "Invalid file contents or file exceeds size limit",
            );
          const field = file.fields.name;
          const displayName =
            field && !Array.isArray(field) && "value" in field
              ? String(field.value)
              : file.filename;
          const filename = z.string().trim().min(1).max(255).parse(displayName);
          const id = randomUUID();
          const key = `documents/${req.userId}/${id}`;
          await uploadFile(key, buffer, file.mimetype);
          try {
            const doc = await db.document.create({
              data: {
                id,
                user_id: req.userId,
                name: filename,
                storage_key: key,
                mime_type: file.mimetype,
                size_bytes: buffer.length,
              },
            });
            return reply.code(201).send(await documentDto(doc));
          } catch (err) {
            await deleteFile(key);
            throw err;
          }
        },
      );
      api.delete("/documents/:id", async (req, reply) => {
        const { id } = z.object({ id: uuid }).parse(req.params);
        const doc = await db.document.findFirst({
          where: { id, user_id: req.userId },
        });
        if (!doc) missing();
        await deleteFile(doc.storage_key);
        await db.document.delete({ where: { id } });
        return reply.code(204).send();
      });
    },
    { prefix: "/api/v1" },
  );
  realtime(app, redis, db);
  return app;
}
