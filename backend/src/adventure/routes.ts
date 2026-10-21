import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { journey, person, settle, snapshot, type World } from "./domain.js";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const text = z.string().trim().min(1).max(60);
const sessionSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid().nullable(),
  goal: z.string().trim().min(3).max(500),
  topic: z.string().min(1).max(100),
  started: z.number().int().nonnegative(),
  ended: z.number().int().nonnegative(),
  target: z.number().int().min(60).max(14400),
  distractions: z.number().int().min(0).max(10000).optional(),
  segments: z
    .array(
      z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        kind: z.enum(["focus", "material", "break", "distraction"]),
      }),
    )
    .max(2000),
});
export function adventureRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  authenticate: (r: FastifyRequest) => Promise<void>,
) {
  const atomic = <T>(run: (w: World) => T | Promise<T>) =>
    db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { state: World }[]
        >`SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
        if (!rows[0])
          throw new ApiError(
            503,
            "service-unavailable",
            "Chưa chạy migration hành trình.",
          );
        const world = rows[0].state;
        world.revision = (world.revision ?? 0) + 1;
        const output = await run(world);
        await tx.$executeRaw`UPDATE adventure_state SET state = ${JSON.stringify(world)}::jsonb WHERE id = 1`;
        return output;
      },
      { timeout: 15000 },
    );
  const opts = { preHandler: authenticate };
  app.get("/api/v1/adventure", opts, (req) =>
    atomic((w) => snapshot(w, req.userId, Date.now())),
  );
  app.post("/api/v1/adventure/carriage", opts, async (req) => {
    const value = z
      .object({
        name: text,
        color: z.enum(["#398575", "#d98b55", "#7384b3", "#b97186"]),
        decor: z.enum(["plant", "books", "stars"]),
      })
      .parse(req.body);
    return atomic((w) => {
      Object.assign(person(w, req.userId), value);
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/groups", opts, async (req) => {
    const value = z
      .object({ name: text, timezone: z.string().max(100) })
      .parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format();
    } catch {
      throw new ApiError(400, "validation-error", "Múi giờ không hợp lệ.");
    }
    return atomic((w) => {
      const p = person(w, req.userId);
      if (p.groupId)
        throw new ApiError(400, "validation-error", "Bạn đã ở trong một đoàn.");
      const id = randomUUID();
      w.groups[id] = {
        id,
        name: value.name,
        timezone: value.timezone,
        owner: req.userId,
        members: [req.userId],
        archived: false,
        journey: journey(),
        daily: {},
        membershipHistory: {
          [req.userId]: [{ joined: Date.now(), left: null }],
        },
      };
      p.groupId = id;
      p.joinedAt = Date.now();
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/invite", opts, (req) =>
    atomic((w) => {
      const p = person(w, req.userId),
        g = p.groupId ? w.groups[p.groupId] : null;
      if (!g || g.owner !== req.userId)
        throw new ApiError(
          403,
          "forbidden",
          "Chỉ chủ đoàn có thể tạo lời mời.",
        );
      // Rotating the code revokes all prior invitations.
      for (const invite of Object.values(w.invites))
        if (invite.groupId === g.id) invite.revoked = true;
      const token = randomBytes(18).toString("base64url");
      const expires = Date.now() + 86400000;
      w.invites[hash(token)] = { groupId: g.id, expires, revoked: false };
      return { token, expires };
    }),
  );
  app.post("/api/v1/adventure/invite/revoke", opts, (req) =>
    atomic((w) => {
      const p = person(w, req.userId),
        g = p.groupId ? w.groups[p.groupId] : null;
      if (!g || g.owner !== req.userId)
        throw new ApiError(403, "forbidden", "Chỉ chủ đoàn có thể thu hồi.");
      for (const invite of Object.values(w.invites))
        if (invite.groupId === g.id) invite.revoked = true;
      return { ok: true };
    }),
  );
  app.post(
    "/api/v1/adventure/join",
    { ...opts, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const { token } = z
        .object({ token: z.string().min(16).max(100) })
        .parse(req.body);
      return atomic((w) => {
        const invite = w.invites[hash(token)],
          p = person(w, req.userId);
        if (!invite || invite.revoked || invite.expires <= Date.now())
          throw new ApiError(
            400,
            "validation-error",
            "Lời mời hết hạn hoặc đã thu hồi.",
          );
        const g = w.groups[invite.groupId];
        if (p.groupId === g.id) return snapshot(w, req.userId, Date.now());
        if (p.groupId || g.archived || g.members.length >= 6)
          throw new ApiError(
            400,
            "validation-error",
            "Đoàn đã đủ 6 người hoặc bạn đã thuộc một đoàn.",
          );
        g.members.push(req.userId);
        p.groupId = g.id;
        p.joinedAt = Date.now();
        g.membershipHistory ??= {};
        (g.membershipHistory[req.userId] ??= []).push({
          joined: p.joinedAt,
          left: null,
        });
        return snapshot(w, req.userId, Date.now());
      });
    },
  );
  app.post("/api/v1/adventure/leave", opts, (req) =>
    atomic((w) => {
      const p = person(w, req.userId),
        g = p.groupId ? w.groups[p.groupId] : null;
      if (g) {
        g.membershipHistory ??= {};
        const history = (g.membershipHistory[req.userId] ??= [
          { joined: p.joinedAt, left: null },
        ]);
        const currentMembership = history
          .slice()
          .reverse()
          .find((m) => m.left === null);
        if (currentMembership) currentMembership.left = Date.now();
        g.members = g.members.filter((id) => id !== req.userId);
        delete g.journey.votes[req.userId];
        if (g.owner === req.userId) g.owner = g.members[0] ?? "";
        if (!g.members.length) g.archived = true;
        // Invitations are authority granted by the old owner; rotate after leaving.
        for (const invite of Object.values(w.invites))
          if (invite.groupId === g.id) invite.revoked = true;
      }
      p.groupId = null;
      return snapshot(w, req.userId, Date.now());
    }),
  );
  app.post("/api/v1/adventure/transfer", opts, async (req) => {
    const { userId } = z.object({ userId: z.uuid() }).parse(req.body);
    return atomic((w) => {
      const p = person(w, req.userId),
        g = p.groupId ? w.groups[p.groupId] : null;
      if (!g || g.owner !== req.userId || !g.members.includes(userId))
        throw new ApiError(
          403,
          "forbidden",
          "Không thể chuyển quyền cho thành viên này.",
        );
      g.owner = userId;
      for (const invite of Object.values(w.invites))
        if (invite.groupId === g.id) invite.revoked = true;
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/vote", opts, async (req) => {
    const { mode, branch } = z
      .object({
        mode: z.enum(["solo", "group"]),
        branch: z.enum(["mountain", "coast"]),
      })
      .parse(req.body);
    return atomic((w) => {
      const p = person(w, req.userId),
        j =
          mode === "group" && p.groupId
            ? w.groups[p.groupId].journey
            : mode === "solo"
              ? p.journey
              : null;
      if (!j || j.voteUntil === null || j.voteUntil <= Date.now())
        throw new ApiError(
          400,
          "validation-error",
          "Chưa có ngã rẽ đang mở bình chọn.",
        );
      j.votes[req.userId] = branch;
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/sessions", opts, async (req) => {
    const input = sessionSchema.parse(req.body);
    return atomic((w) => {
      try {
        settle(w, { ...input, userId: req.userId }, Date.now());
      } catch (error) {
        throw new ApiError(
          400,
          "validation-error",
          error instanceof Error ? error.message : "Không lưu được phiên.",
        );
      }
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/quiz", opts, async (req) => {
    const value = z
      .object({
        sessionId: z.uuid(),
        answers: z
          .array(
            z.object({
              id: z.uuid(),
              selected: z.number().int().min(0).max(3),
            }),
          )
          .min(1)
          .max(10),
      })
      .parse(req.body);
    if (new Set(value.answers.map((a) => a.id)).size !== value.answers.length)
      throw new ApiError(400, "validation-error", "Câu hỏi trùng.");
    const questions = await db.quizQuestion.findMany({
      where: {
        id: { in: value.answers.map((a) => a.id) },
        OR: [{ owner_id: null }, { owner_id: req.userId }],
      },
    });
    if (questions.length !== value.answers.length)
      throw new ApiError(403, "forbidden", "Không có quyền đọc câu hỏi.");
    return atomic((w) => {
      const s = w.sessions[value.sessionId];
      if (!s || s.userId !== req.userId)
        throw new ApiError(404, "not-found", "Không tìm thấy phiên.");
      if (questions.some((q) => q.topic_id !== s.topic))
        throw new ApiError(
          400,
          "validation-error",
          "Quiz không thuộc chủ đề phiên.",
        );
      s.quiz ??= {
        score: value.answers.filter(
          (a) =>
            questions.find((q) => q.id === a.id)?.correct_index === a.selected,
        ).length,
        total: value.answers.length,
      };
      return snapshot(w, req.userId, Date.now());
    });
  });
}
