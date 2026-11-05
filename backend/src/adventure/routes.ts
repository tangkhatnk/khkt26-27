import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { config } from "../config.js";
import { tripIdentity } from "../experiments.js";
import {
  DEVICE_CATEGORIES,
  isSessionRemoved,
  person,
  projectSessionMetrics,
  settle,
  snapshot,
  type Group,
  type World,
} from "./domain.js";
const text = z.string().trim().min(1).max(60);
function retiredGroupMutation(): never {
  throw new ApiError(410, "feature-retired", "Tính năng nhóm không còn được hỗ trợ.");
}
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
  if (!group.trip || group.trip.status !== "departed" || group.trip.mode === "synchronized") return;
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
    delete group.trip.participants[userId]!.sessionId;
    endGroupMembership(group, world, userId, now);
  }
}
function skipTripMember(world: World, group: Group, userId: string, now: number) {
  const trip = group.trip;
  const participant = trip?.participants[userId];
  if (!trip || !participant || !group.members.includes(userId))
    throw new ApiError(400, "validation-error", "Bạn không thuộc chuyến này.");
  if (participant.status === "bound") {
    if (trip.mode === "synchronized") {
      endGroupMembership(group, world, userId, now);
      return;
    }
    throw new ApiError(
      409,
      "conflict",
      "Hãy kết thúc phiên và đồng bộ trước khi rời chuyến.",
      true,
    );
  }
  if (participant.status === "completed" || participant.status === "skipped") return;
  participant.status = "skipped";
  if (trip.status === "waiting") {
    group.members = group.members.filter((memberId) => memberId !== userId);
    delete participant.sessionId;
  }
  endGroupMembership(group, world, userId, now);
  closeTripWhenTerminal(group);
}
function closeExpiredSynchronizedTrips(world: World, now: number) {
  for (const group of Object.values(world.groups)) {
    const trip = group.trip;
    if (trip?.mode !== "synchronized" || trip.status !== "departed" ||
      trip.endsAt === undefined || now < trip.endsAt) continue;
    trip.status = "closed";
    group.archived = true;
    revokeGroupInvites(world, group.id);
    for (const userId of Object.keys(trip.participants)) {
      if (world.people[userId]?.groupId === group.id)
        endGroupMembership(group, world, userId, trip.endsAt);
    }
  }
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
        closeExpiredSynchronizedTrips(world, Date.now());
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
  // Keep retired mutation paths registered so old clients receive a stable response.
  app.post("/api/v1/adventure/groups", opts, () => retiredGroupMutation());
  app.post("/api/v1/adventure/trips", opts, () => retiredGroupMutation());
  app.post("/api/v1/adventure/trips/synchronized", opts, () => retiredGroupMutation());
  app.post("/api/v1/adventure/invite", opts, () => retiredGroupMutation());
  app.post("/api/v1/adventure/invite/revoke", opts, () => retiredGroupMutation());
  app.post("/api/v1/adventure/join", {
    ...opts,
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, () => retiredGroupMutation());
  app.post("/api/v1/adventure/trip/ready", opts, () => retiredGroupMutation());
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
  app.post("/api/v1/adventure/transfer", opts, () => retiredGroupMutation());
  app.post("/api/v1/adventure/trip/start", opts, async (req) => {
    const { groupId, sessionId } = z
      .object({ groupId: z.uuid(), sessionId: z.uuid() })
      .strict()
      .parse(req.body);
    return atomic((world) => {
      const group = world.groups[groupId];
      const trip = group?.trip;
      if (!group || !trip)
        throw new ApiError(410, "feature-retired", "Tính năng nhóm không còn được hỗ trợ.");
      const participant = trip.participants[req.userId];
      if (!participant || !group.members.includes(req.userId))
        throw new ApiError(403, "forbidden", "Bạn không thuộc chuyến này.");
      if (participant.sessionId !== sessionId) {
        if (participant.status === "ready" || participant.status === "not-ready")
          retiredGroupMutation();
        throw new ApiError(409, "conflict", "Chuyến đã được liên kết với phiên khác.");
      }
      if (participant.status !== "bound" && participant.status !== "completed")
        throw new ApiError(409, "conflict", "Phiên này chưa được liên kết với chuyến.");
      if (isSessionRemoved(world, sessionId))
        throw new ApiError(410, "session-removed", "Phiên học này đã được quản trị viên gỡ khỏi lịch sử.");

      const saved = world.sessions[sessionId];
      if (saved && (saved.id !== sessionId || saved.userId !== req.userId || saved.groupId !== groupId))
        throw new ApiError(409, "conflict", "Phiên đã được lưu với chủ sở hữu hoặc chuyến khác.");
      if (participant.status === "completed" && !saved)
        throw new ApiError(409, "conflict", "Không tìm thấy phiên đã hoàn tất.");
      if (participant.status === "bound" && saved)
        throw new ApiError(409, "conflict", "Phiên đã lưu nhưng chuyến chưa được cập nhật.");

      if (trip.mode === "synchronized") {
        if ((trip.status !== "departed" && trip.status !== "closed") ||
          !Number.isSafeInteger(trip.startedAt) || !Number.isSafeInteger(trip.endsAt) ||
          trip.endsAt! <= trip.startedAt!)
          throw new ApiError(409, "conflict", "Chuyến chưa có thời gian bắt đầu hợp lệ.");
        if (saved && (saved.started !== trip.startedAt || saved.ended > trip.endsAt! || saved.target !== trip.target ||
          JSON.stringify(saved.breakPlan ?? null) !== JSON.stringify(trip.breakPlan ?? null)))
          throw new ApiError(409, "conflict", "Phiên đã lưu không khớp với thời gian chung của chuyến.");
        return {
          ...snapshot(world, req.userId, Date.now()),
          tripStart: { sessionId, startedAt: trip.startedAt, endsAt: trip.endsAt },
        };
      }

      if (saved && (saved.goal !== trip.goal || saved.topic !== trip.topic || saved.target !== trip.target))
        throw new ApiError(409, "conflict", "Phiên đã lưu không khớp với chuyến legacy.");
      if (participant.status === "bound" &&
        (trip.status !== "departed" || group.archived || world.people[req.userId]?.groupId !== groupId))
        throw new ApiError(409, "conflict", "Chuyến không còn mở cho phiên đang liên kết.");
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
    if (mode === "group") retiredGroupMutation();
    return atomic((w) => {
      const p = person(w, req.userId),
        j = p.journey;
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
