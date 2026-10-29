import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { config } from "../config.js";
import { tripIdentity } from "../experiments.js";
import {
  DEVICE_CATEGORIES,
  isSessionRemoved,
  journey,
  person,
  projectSessionMetrics,
  settle,
  snapshot,
  type Group,
  type World,
} from "./domain.js";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const text = z.string().trim().min(1).max(60);
function revokeGroupInvites(world: World, groupId: string) {
  for (const invite of Object.values(world.invites))
    if (invite.groupId === groupId) invite.revoked = true;
}
function endGroupMembership(group: Group, world: World, userId: string, now: number) {
  group.membershipHistory ??= {};
  const history = (group.membershipHistory[userId] ??= []);
  const currentMembership = history.slice().reverse().find((item) => item.left === null);
  if (currentMembership) currentMembership.left = now;
  const member = world.people[userId];
  if (member?.groupId === group.id) member.groupId = null;
}
function closeTripWhenTerminal(group: Group) {
  if (!group.trip || group.trip.status !== "departed") return;
  if (Object.values(group.trip.participants).every((member) =>
    member.status === "completed" || member.status === "skipped",
  )) {
    group.trip.status = "closed";
    group.archived = true;
  }
}
function cancelWaitingTrip(world: World, group: Group, now: number) {
  if (!group.trip || group.trip.status !== "waiting")
    throw new ApiError(409, "conflict", "Chuyến đã khởi hành hoặc đã đóng.");
  group.trip.status = "closed";
  group.archived = true;
  revokeGroupInvites(world, group.id);
  for (const userId of Object.keys(group.trip.participants)) {
    group.trip.participants[userId]!.status = "skipped";
    endGroupMembership(group, world, userId, now);
  }
}
function skipTripMember(world: World, group: Group, userId: string, now: number) {
  const trip = group.trip;
  const participant = trip?.participants[userId];
  if (!trip || !participant || !group.members.includes(userId))
    throw new ApiError(400, "validation-error", "Bạn không thuộc chuyến này.");
  if (participant.status === "bound")
    throw new ApiError(
      409,
      "conflict",
      "Hãy kết thúc phiên và đồng bộ trước khi rời chuyến.",
      true,
    );
  if (participant.status === "completed" || participant.status === "skipped") return;
  participant.status = "skipped";
  if (trip.status === "waiting") group.members = group.members.filter((memberId) => memberId !== userId);
  endGroupMembership(group, world, userId, now);
  closeTripWhenTerminal(group);
}
const sessionSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid().nullable(),
  goal: z.string().trim().min(3).max(500),
  topic: z.string().min(1).max(100),
  started: z.number().int().nonnegative(),
  ended: z.number().int().nonnegative(),
  target: z.number().int().min(60).max(14400),
  breakPlan: z.object({count:z.number().int().min(0).max(10),seconds:z.number().int().min(60).max(1800)}).strict().optional(),
  deviceCategory: z.enum(DEVICE_CATEGORIES).optional(),
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
  const atomic = <T>(run: (w: World, tx: Prisma.TransactionClient) => T | Promise<T>) =>
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
        const output = await run(world, tx);
        await tx.$executeRaw`UPDATE adventure_state SET state = ${JSON.stringify(world)}::jsonb WHERE id = 1`;
        return output;
      },
      { timeout: 15000 },
    );
  const opts = { preHandler: authenticate };
  app.post("/api/v1/adventure/trip-code", {
    bodyLimit: 512,
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async req => {
    const { id } = z.object({ id: z.uuid() }).strict().parse(req.body);
    const authenticated = req.headers.authorization !== undefined;
    if (authenticated) await authenticate(req);
    const owner = authenticated ? req.userId : `guest:${id}`;
    // Preview only: the same identity is used when the session is later saved.
    // Nothing is published and no progress is awarded by issuing this code.
    return { tripCode: tripIdentity(owner, id, config.JWT_SECRET).tripCode };
  });
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
  // Backward-compatible endpoint for old clients. The current app creates planned trips at /trips.
  app.post("/api/v1/adventure/groups", opts, async (req, reply) => {
    reply.header("Deprecation", "true");
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
  app.post("/api/v1/adventure/trips", opts, async (req) => {
    const value = z.object({
      name: text,
      timezone: z.string().max(100),
      goal: z.string().trim().min(3).max(500),
      topic: z.string().trim().min(1).max(100),
      target: z.number().int().min(60).max(14400),
    }).strict().parse(req.body);
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format();
    } catch {
      throw new ApiError(400, "validation-error", "Múi giờ không hợp lệ.");
    }
    return atomic((world) => {
      const member = person(world, req.userId);
      if (member.groupId)
        throw new ApiError(400, "validation-error", "Hãy rời chuyến hiện tại trước khi lập chuyến mới.");
      const id = randomUUID();
      const joined = Date.now();
      world.groups[id] = {
        id,
        name: value.name,
        owner: req.userId,
        members: [req.userId],
        timezone: value.timezone,
        archived: false,
        journey: journey(),
        daily: {},
        membershipHistory: { [req.userId]: [{ joined, left: null }] },
        trip: {
          status: "waiting",
          goal: value.goal,
          topic: value.topic,
          target: value.target,
          participants: { [req.userId]: { status: "ready" } },
        },
      };
      member.groupId = id;
      member.joinedAt = joined;
      return snapshot(world, req.userId, joined);
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
      if (!g.trip)
        throw new ApiError(409, "conflict", "Chỉ có thể tạo lời mời cho chuyến học đã lập.");
      if (g.trip.status !== "waiting" || g.archived)
        throw new ApiError(409, "conflict", "Chuyến đã khởi hành hoặc đã đóng.");
      // Rotating the code revokes all prior invitations.
      revokeGroupInvites(w, g.id);
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
      if (g.trip && (g.trip.status !== "waiting" || g.archived))
        throw new ApiError(409, "conflict", "Chuyến đã khởi hành hoặc đã đóng.");
      revokeGroupInvites(w, g.id);
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
        if (!g)
          throw new ApiError(400, "validation-error", "Lời mời hết hạn hoặc đã thu hồi.");
        if (!g.trip)
          throw new ApiError(400, "validation-error", "Lời mời không thuộc chuyến học hợp lệ.");
        if (g.trip.status !== "waiting" || g.archived)
          throw new ApiError(400, "validation-error", "Chuyến đã khởi hành hoặc đã đóng.");
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
        if (g.trip) g.trip.participants[req.userId] = { status: "ready" };
        return snapshot(w, req.userId, Date.now());
      });
    },
  );
  app.post("/api/v1/adventure/leave", opts, (req) =>
    atomic((w) => {
      const p = person(w, req.userId),
        g = p.groupId ? w.groups[p.groupId] : null;
      if (g) {
        if (g.trip) {
          if (g.owner === req.userId && g.trip.status === "waiting") {
            cancelWaitingTrip(w, g, Date.now());
          } else {
            skipTripMember(w, g, req.userId, Date.now());
          }
          return snapshot(w, req.userId, Date.now());
        }
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
      if (g.trip && (g.trip.status !== "waiting" || g.archived))
        throw new ApiError(409, "conflict", "Không thể chuyển quyền sau khi chuyến khởi hành.");
      g.owner = userId;
      if (g.trip && g.trip.participants[userId])
        g.trip.participants[req.userId]!.status = "ready";
      revokeGroupInvites(w, g.id);
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/trip/start", opts, async (req) => {
    const { sessionId } = z.object({ sessionId: z.uuid() }).strict().parse(req.body);
    return atomic((world) => {
      const member = person(world, req.userId);
      const group = member.groupId ? world.groups[member.groupId] : null;
      const trip = group?.trip;
      if (!group || !trip || group.archived || trip.status === "closed")
        throw new ApiError(409, "conflict", "Không có chuyến đang mở để bắt đầu.");
      const participant = trip.participants[req.userId];
      if (!participant || !group.members.includes(req.userId))
        throw new ApiError(403, "forbidden", "Bạn không thuộc chuyến này.");
      if (participant.status === "bound" && participant.sessionId === sessionId)
        return {
          ...snapshot(world, req.userId, Date.now()),
          tripStart: { sessionId },
        };
      if (trip.status === "waiting") {
        if (group.owner !== req.userId)
          throw new ApiError(409, "conflict", "Chủ chuyến cần khởi hành trước.");
        trip.status = "departed";
        revokeGroupInvites(world, group.id);
      }
      if (participant.status !== "ready")
        throw new ApiError(409, "conflict", "Bạn đã bắt đầu hoặc hoàn tất phiên của chuyến này.");
      if (world.sessions[sessionId] || Object.values(world.groups).some((candidate) =>
        Object.values(candidate.trip?.participants ?? {}).some((bound) => bound.sessionId === sessionId),
      ))
        throw new ApiError(409, "conflict", "Mã phiên đã được sử dụng.");
      participant.status = "bound";
      participant.sessionId = sessionId;
      return { ...snapshot(world, req.userId, Date.now()), tripStart: { sessionId } };
    });
  });
  app.post("/api/v1/adventure/trip/cancel", opts, (req) =>
    atomic((world) => {
      const member = person(world, req.userId);
      const group = member.groupId ? world.groups[member.groupId] : null;
      if (!group?.trip || group.owner !== req.userId)
        throw new ApiError(403, "forbidden", "Chỉ chủ chuyến mới có thể hủy chuyến.");
      cancelWaitingTrip(world, group, Date.now());
      return snapshot(world, req.userId, Date.now());
    }),
  );
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
    return atomic(async (w, tx) => {
      const prior = w.sessions[input.id];
      if (prior && prior.userId !== req.userId)
        throw new ApiError(409, "conflict", "Mã phiên đã được sử dụng.");
      if (isSessionRemoved(w, input.id))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      try {
        settle(w, { ...input, userId: req.userId }, Date.now());
      } catch (error) {
        throw new ApiError(
          400,
          "validation-error",
          error instanceof Error ? error.message : "Không lưu được phiên.",
        );
      }
      await tx.studyExerciseSet.updateMany({
        where: {
          user_id: req.userId,
          planned_session_id: input.id,
          status: "ready",
          bound_at: null,
          expires_at: { gt: new Date(input.started) },
        },
        data: { bound_at: new Date(), expires_at: null },
      });
      return snapshot(w, req.userId, Date.now());
    });
  });
  app.post("/api/v1/adventure/guest-sessions", {
    bodyLimit: 256 * 1024,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async req => {
    const input = sessionSchema.parse(req.body);
    const owner = `guest:${input.id}`;
    return atomic(world => {
      const prior = world.sessions[input.id];
      if (prior && prior.userId !== owner)
        throw new ApiError(409, "conflict", "Mã phiên đã được sử dụng.");
      if (isSessionRemoved(world, input.id))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      try {
        const session = settle(world, { ...input, userId: owner, groupId: null }, Date.now());
        return { tripCode: tripIdentity(session.userId, session.id, config.JWT_SECRET).tripCode };
      } catch (error) {
        throw new ApiError(400, "validation-error", error instanceof Error ? error.message : "Không lưu được phiên.");
      }
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
          .max(30),
      })
      .parse(req.body);
    if (new Set(value.answers.map((a) => a.id)).size !== value.answers.length)
      throw new ApiError(400, "validation-error", "Câu hỏi trùng.");
    const questions = await db.quizQuestion.findMany({
      where: {
        id: { in: value.answers.map((a) => a.id) },
        owner_id: req.userId,
        source: { in: ["gemini_generated", "ai_generated"] },
      },
    });
    if (questions.length !== value.answers.length)
      throw new ApiError(403, "forbidden", "Không có quyền đọc câu hỏi.");
    return atomic((w) => {
      const s = w.sessions[value.sessionId];
      if (!s || s.userId !== req.userId)
        throw new ApiError(404, "not-found", "Không tìm thấy phiên.");
      if (isSessionRemoved(w, value.sessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");
      if (s.quiz) return snapshot(w, req.userId, Date.now());
      const effectiveTopic = projectSessionMetrics(s, w.sessionOverrides?.[value.sessionId]).topic;
      if (questions.some((q) => q.topic_id !== effectiveTopic)) {
        if (effectiveTopic !== s.topic)
          throw new ApiError(409, "conflict", "Chủ đề phiên học đã thay đổi. Hãy tải lại trước khi chấm bài.");
        throw new ApiError(400, "validation-error", "Quiz không thuộc chủ đề phiên.");
      }
      s.quiz ??= {
        score: value.answers.filter(
          (answer) =>
            questions.find((question) => question.id === answer.id)?.correct_index === answer.selected,
        ).length,
        total: value.answers.length,
        feedback: value.answers.map((answer) => {
          const question = questions.find((item) => item.id === answer.id)!;
          const options = z.array(z.string()).parse(question.options);
          return {
            questionId: question.id,
            question: question.question,
            options,
            selected: answer.selected,
            correctIndex: question.correct_index,
            correct: question.correct_index === answer.selected,
            explanation: question.explanation,
            knowledgePoint: question.knowledge_point ?? question.question,
          };
        }),
      };
      return snapshot(w, req.userId, Date.now());
    });
  });
}
