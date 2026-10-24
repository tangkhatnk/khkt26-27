import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { verifyActiveAccess } from "./auth.js";
import { ApiError } from "./errors.js";
import { uuid, topicId } from "./schemas.js";
export function realtime(app: FastifyInstance, redis: Redis, db: PrismaClient) {
  app.get(
    "/ws/v1",
    {
      websocket: true,
      preValidation: async (req) => {
        const { token } = z
          .object({ token: z.string().min(1) })
          .parse(req.query);
        req.userId = await verifyActiveAccess(db, token);
      },
    },
    (socket, req) => {
      let busy = false;
      const send = (event: string, payload: unknown) => {
        if (socket.readyState === 1)
          socket.send(JSON.stringify({ event, payload }));
      };
      // Revalidate access on every frame and tick; expired connections close promptly.
      const token = (req.query as { token: string }).token;
      const key = `focus:${req.userId}`;
      const tick = async () => {
        await verifyActiveAccess(db, token);
        const raw = await redis.get(key);
        if (!raw) return;
        const state = JSON.parse(raw) as {
          session_id: string;
          deadline: number;
        };
        const remaining = Math.max(
          0,
          Math.ceil((state.deadline - Date.now()) / 1000),
        );
        send(remaining ? "session:tick" : "session:complete", {
          session_id: state.session_id,
          ...(remaining ? { remaining_seconds: remaining } : {}),
        });
        if (!remaining) await redis.del(key);
      };
      const timer = setInterval(() => {
        void tick().catch(() =>
          socket.close(1008, "Authentication or service unavailable"),
        );
      }, 30000);
      socket.on("close", () => clearInterval(timer));
      socket.on("message", (data) => {
        if (busy) return;
        busy = true;
        void (async () => {
          await verifyActiveAccess(db, token);
          const hits = await redis.incr(`ws-rate:${req.userId}`);
          if (hits === 1) await redis.expire(`ws-rate:${req.userId}`, 60);
          if (hits > 100) throw new Error("Too many events");
          const msg = z
            .object({
              event: z.enum([
                "session:start",
                "distraction:attempt",
                "session:end",
              ]),
              payload: z.unknown(),
            })
            .parse(JSON.parse(data.toString()));
          if (msg.event === "session:start") {
            const payload = z
              .object({
                session_id: uuid,
                topic_id: topicId,
                target_duration: z.number().int().min(60).max(72000),
              })
              .parse(msg.payload);
            // ID is a client lifecycle UUID, or an owned persisted session UUID.
            const persisted = await db.studySession.findUnique({
              where: { id: payload.session_id },
            });
            if (persisted && persisted.user_id !== req.userId)
              throw new Error("Session unavailable");
            if (
              !(await db.topic.findUnique({ where: { id: payload.topic_id } }))
            )
              throw new Error("Topic unavailable");
            await redis.set(
              key,
              JSON.stringify({
                ...payload,
                deadline: Date.now() + payload.target_duration * 1000,
                attempts: 0,
              }),
              "EX",
              payload.target_duration + 120,
              "NX",
            );
            await tick();
          } else {
            const raw = await redis.get(key);
            if (!raw) throw new Error("No active session");
            const state = JSON.parse(raw) as {
              session_id: string;
              attempts: number;
              deadline: number;
            };
            const payload = z
              .object({
                session_id: uuid,
                app_id: z.string().max(100).optional(),
                timestamp: z.iso.datetime().optional(),
                actual_duration: z.number().int().min(0).max(72000).optional(),
                is_completed: z.boolean().optional(),
              })
              .parse(msg.payload);
            if (state.session_id !== payload.session_id)
              throw new Error("Session mismatch");
            if (msg.event === "session:end") await redis.del(key);
            else {
              state.attempts++;
              await redis.set(key, JSON.stringify(state), "KEEPTTL");
              send("distraction:warning", {
                session_id: state.session_id,
                message: "Quay lại mục tiêu học tập của bạn.",
              });
            }
          }
        })()
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 401) {
              socket.close(1008, "Authentication required");
              return;
            }
            send("error", {
              message: "Invalid event, expired token, or service unavailable",
            });
          })
          .finally(() => {
            busy = false;
          });
      });
    },
  );
}
