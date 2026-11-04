import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { z } from "zod";
import { issueGuestAiCredential, verifyGuestAiCredential } from "./guestAiAuth.js";
import { reserveGuestAiBudget } from "./guestAiBudget.js";
import { reserveGuestAiSessionStart } from "./guestAiSessions.js";
import { guestAiWorkflowRoutes, type GuestAiWorkflowProviders } from "./guestAiWorkflows.js";

declare module "fastify" {
  interface FastifyRequest {
    guestAiPrincipal: string | null;
  }
}

export function guestAiRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  redis: Redis,
  providers?: GuestAiWorkflowProviders,
) {
  app.decorateRequest("guestAiPrincipal", null);

  app.post("/api/v1/ai/guest/credential", {
    bodyLimit: 128,
    config: { rateLimit: { max: 500, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    z.object({}).strict().parse(request.body ?? {});
    reply.header("Cache-Control", "no-store");
    return reply.code(201).send(await issueGuestAiCredential(redis, request.ip));
  });

  const authenticateGuestAi = async (request: FastifyRequest) => {
    request.guestAiPrincipal = await verifyGuestAiCredential(
      redis,
      request.headers.authorization,
    );
  };

  app.post("/api/v1/ai/guest/sessions/start", {
    bodyLimit: 1024,
    preHandler: authenticateGuestAi,
    config: { rateLimit: { max: 500, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    await reserveGuestAiBudget(redis, {
      principalId: request.guestAiPrincipal!,
      remoteAddress: request.ip,
      task: "session",
      providerUnits: 0,
    });
    const record = await reserveGuestAiSessionStart(
      redis,
      db,
      request.guestAiPrincipal!,
      request.body as { id: string; target: number; breakPlan?: { count: number; seconds: number } },
    );
    reply.header("Cache-Control", "no-store");
    return {
      sessionId: record.sessionId,
      startedAt: record.startedAt,
      serverNow: Date.now(),
      target: record.target,
      ...(record.breakPlan ? { breakPlan: record.breakPlan } : {}),
    };
  });

  guestAiWorkflowRoutes(app, db, redis, authenticateGuestAi, providers);

  return { authenticateGuestAi };
}
