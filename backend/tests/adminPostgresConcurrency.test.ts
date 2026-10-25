import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { adminRoutes } from "../src/admin.js";
import { experimentRoutes, tripIdentity } from "../src/experiments.js";
import { hashToken, issueTokens, rotateToken, verifyActiveAccess } from "../src/auth.js";
import { config } from "../src/config.js";
import { ApiError } from "../src/errors.js";

function checkedDatabaseUrl() {
  const value = process.env.ADMIN_TEST_DATABASE_URL;
  if (!value) throw new Error("ADMIN_TEST_DATABASE_URL is required for native admin concurrency tests");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ADMIN_TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" || url.port !== "15435" || url.pathname !== "/admin_concurrency")
    throw new Error("Native admin tests are restricted to 127.0.0.1:15435/admin_concurrency");
  url.searchParams.set("connection_limit", "8");
  return url.toString();
}

const databaseUrl = checkedDatabaseUrl();
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const secondDb = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
let bootstrapId: string;
let firstApp: ReturnType<typeof Fastify>;
let secondApp: ReturnType<typeof Fastify>;

async function createUser(options: { admin?: boolean } = {}) {
  const id = randomUUID();
  const user = await db.user.create({
    data: {
      id,
      email: `native-admin-${randomUUID()}@example.test`,
      name: "Synthetic native admin fixture",
    },
  });
  if (options.admin) await db.adminGrant.create({ data: { user_id: id, is_active: true } });
  return user;
}

function makeApp(client: PrismaClient, bootstrapIds: readonly string[]) {
  const app = Fastify({ logger: false });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ detail: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ detail: "validation error" });
    return reply.code(500).send({ detail: "internal error" });
  });
  const authenticate = async (request: FastifyRequest) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      throw new ApiError(401, "authentication-error", "Authentication required");
    request.userId = authorization.slice("Bearer ".length);
  };
  adminRoutes(app, client, authenticate, bootstrapIds);
  experimentRoutes(app, client, authenticate);
  return app;
}

async function holdControlRow(client: PrismaClient) {
  let release!: () => void;
  let acquired!: () => void;
  const lockAcquired = new Promise<void>((resolve) => { acquired = resolve; });
  const transaction = client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM admin_control WHERE id = 1 FOR UPDATE`;
    acquired();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await lockAcquired;
  return { release: () => release(), done: transaction };
}

async function holdUserRow(client: PrismaClient, userId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const lockAcquired = new Promise<void>((resolve) => { acquired = resolve; });
  const transaction = client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    acquired();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await lockAcquired;
  return { release: () => release(), done: transaction };
}

async function holdAdventureState(client: PrismaClient) {
  let release!: () => void;
  let acquired!: () => void;
  const lockAcquired = new Promise<void>((resolve) => { acquired = resolve; });
  const transaction = client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
    acquired();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await lockAcquired;
  return { release: () => release(), done: transaction };
}

async function holdTesterRun(client: PrismaClient, userId: string, sessionId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const lockAcquired = new Promise<void>((resolve) => { acquired = resolve; });
  const transaction = client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM tester_runs WHERE user_id = ${userId}::uuid
      AND session_id = ${sessionId}::uuid FOR UPDATE`;
    acquired();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await lockAcquired;
  return { release: () => release(), done: transaction };
}

async function seedSession(userId: string) {
  const id = randomUUID();
  const started = Date.now() - 60_000;
  const ended = started + 60_000;
  const session = {
    id, userId, groupId: null, goal: "Native PostgreSQL correction fixture", topic: "biology",
    started, ended, target: 60, seconds: 60, contribution: 60, rules: "train-v1", distractions: 0,
    segments: [{ start: started, end: ended, kind: "focus" }],
  };
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ state: unknown }[]>`SELECT state FROM adventure_state WHERE id = 1 FOR UPDATE`;
    const raw = rows[0]?.state;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new Error("Native adventure state fixture is invalid");
    const world = raw as Record<string, unknown>;
    const sessions = world.sessions;
    if (typeof sessions !== "object" || sessions === null || Array.isArray(sessions))
      throw new Error("Native adventure sessions fixture is invalid");
    (sessions as Record<string, unknown>)[id] = session;
    world.revision = typeof world.revision === "number" ? world.revision + 1 : 1;
    await tx.$executeRaw`UPDATE adventure_state SET state = ${JSON.stringify(world)}::jsonb WHERE id = 1`;
  });
  return id;
}

async function expectPending(promise: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    promise.then(() => "settled" as const),
    new Promise<"waiting">((resolve) => { timer = setTimeout(() => resolve("waiting"), 75); }),
  ]);
  if (timer) clearTimeout(timer);
  expect(outcome).toBe("waiting");
}

async function expectDatabaseLockWait(queryFragment: string, minimum: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await db.$queryRaw<{ waiting: number }[]>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE ${`%${queryFragment}%`}`;
    if ((rows[0]?.waiting ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${minimum} PostgreSQL lock waiters for ${queryFragment}`);
}

beforeAll(async () => {
  await Promise.all([db.$connect(), secondDb.$connect()]);
  const rows = await db.$queryRaw<{ database_name: string }[]>`SELECT current_database() AS database_name`;
  if (rows[0]?.database_name !== "admin_concurrency")
    throw new Error("Refusing to run admin concurrency tests outside admin_concurrency");
  bootstrapId = (await createUser()).id;
  firstApp = makeApp(db, [bootstrapId]);
  secondApp = makeApp(secondDb, [bootstrapId]);
  await Promise.all([firstApp.ready(), secondApp.ready()]);
});

afterAll(async () => {
  await Promise.allSettled([firstApp?.close(), secondApp?.close()]);
  await Promise.allSettled([db.$disconnect(), secondDb.$disconnect()]);
});

describe("native PostgreSQL admin mutation and token locks", () => {
  it("allows one session correction for a shared expectedVersion and writes only the winner's audit", async () => {
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    const blocker = await holdControlRow(secondDb);
    const firstCorrection = firstApp.inject({
      method: "PATCH", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { expectedVersion: 0, reason: "Native competing session correction A", changes: { topic: "history" } },
    });
    const secondCorrection = secondApp.inject({
      method: "PATCH", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { expectedVersion: 0, reason: "Native competing session correction B", changes: { distractions: 2 } },
    });
    try {
      await Promise.all([expectPending(firstCorrection), expectPending(secondCorrection)]);
      await expectDatabaseLockWait("admin_control", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;

    const responses = await Promise.all([firstCorrection, secondCorrection]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(await db.adminSessionActionAudit.count({ where: { session_id: sessionId } })).toBe(1);
    const detail = await firstApp.inject({ url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` } });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().correctionVersion).toBe(1);
  });

  it("rolls back the correction when its append-only audit insert fails", async () => {
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    await db.$executeRaw`DROP TRIGGER IF EXISTS native_test_reject_session_audit ON admin_session_action_audits`;
    await db.$executeRaw`DROP FUNCTION IF EXISTS native_test_reject_session_audit()`;
    await db.$executeRaw`CREATE FUNCTION native_test_reject_session_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.reason = 'Native session audit rollback sentinel' THEN
          RAISE EXCEPTION 'Native session audit rollback sentinel';
        END IF;
        RETURN NEW;
      END; $$`;
    await db.$executeRaw`CREATE TRIGGER native_test_reject_session_audit
      BEFORE INSERT ON admin_session_action_audits FOR EACH ROW
      EXECUTE FUNCTION native_test_reject_session_audit()`;
    try {
      const response = await firstApp.inject({
        method: "PATCH", url: `/api/v1/admin/sessions/${sessionId}`,
        headers: { authorization: `Bearer ${bootstrapId}` },
        payload: { expectedVersion: 0, reason: "Native session audit rollback sentinel", changes: { topic: "history" } },
      });
      expect(response.statusCode).toBe(500);
      expect(await db.adminSessionActionAudit.count({ where: { session_id: sessionId } })).toBe(0);
      const rows = await db.$queryRaw<{ override: unknown }[]>`
        SELECT state->'sessionOverrides'->${sessionId} AS override FROM adventure_state WHERE id = 1`;
      expect(rows[0]?.override).toBeNull();
    } finally {
      await db.$executeRaw`DROP TRIGGER IF EXISTS native_test_reject_session_audit ON admin_session_action_audits`;
      await db.$executeRaw`DROP FUNCTION IF EXISTS native_test_reject_session_audit()`;
    }
  });

  it("keeps publication consistent when correction races it under the adventure-state lock", async () => {
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    const blocker = await holdAdventureState(secondDb);
    const correction = firstApp.inject({
      method: "PATCH", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { expectedVersion: 0, reason: "Native correction publication race", changes: { topic: "history" } },
    });
    const publication = secondApp.inject({
      method: "POST", url: "/api/v1/experiments",
      headers: { authorization: `Bearer ${target.id}` }, payload: { sessionId },
    });
    try {
      await Promise.all([expectPending(correction), expectPending(publication)]);
      await expectDatabaseLockWait("adventure_state", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;
    const [corrected, published] = await Promise.all([correction, publication]);
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(published.statusCode, published.body).toBe(200);
    const publicPage = await firstApp.inject({ url: "/api/v1/experiments?limit=100" });
    const identity = tripIdentity(target.id, sessionId, config.JWT_SECRET);
    const run = publicPage.json().runs.find((candidate: { id: string }) => candidate.id === identity.id);
    expect(run).toMatchObject({ topic: "history", correctionFlags: { topic: true } });
    expect(await db.adminSessionActionAudit.count({ where: { session_id: sessionId } })).toBe(1);
  });

  it("never republishes a tombstoned trip when removal races publication", async () => {
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    const blocker = await holdAdventureState(secondDb);
    const removal = firstApp.inject({
      method: "DELETE", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { expectedVersion: 0, reason: "Native remove publication race" },
    });
    const publication = secondApp.inject({
      method: "POST", url: "/api/v1/experiments",
      headers: { authorization: `Bearer ${target.id}` }, payload: { sessionId },
    });
    try {
      await Promise.all([expectPending(removal), expectPending(publication)]);
      await expectDatabaseLockWait("adventure_state", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;
    const [removed, published] = await Promise.all([removal, publication]);
    expect(removed.statusCode, removed.body).toBe(200);
    expect([200, 410]).toContain(published.statusCode);
    const identity = tripIdentity(target.id, sessionId, config.JWT_SECRET);
    const publicPage = await firstApp.inject({ url: "/api/v1/experiments?limit=100" });
    expect(publicPage.json().runs.some((candidate: { id: string }) => candidate.id === identity.id)).toBe(false);
    const mine = await firstApp.inject({ url: "/api/v1/experiments/mine", headers: { authorization: `Bearer ${target.id}` } });
    expect(mine.json()).not.toContainEqual({ sessionId });
    const replay = await secondApp.inject({ method: "POST", url: "/api/v1/experiments",
      headers: { authorization: `Bearer ${target.id}` }, payload: { sessionId } });
    expect(replay.statusCode).toBe(410);
    expect(await db.adminSessionActionAudit.count({ where: { session_id: sessionId, action: "removal" } })).toBe(1);
  });

  it("keeps owner withdrawal effective when it races administrator removal", async () => {
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    const published = await firstApp.inject({ method: "POST", url: "/api/v1/experiments",
      headers: { authorization: `Bearer ${target.id}` }, payload: { sessionId } });
    expect(published.statusCode, published.body).toBe(200);
    const blocker = await holdTesterRun(secondDb, target.id, sessionId);
    const removal = firstApp.inject({
      method: "DELETE", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { expectedVersion: 0, reason: "Native remove withdrawal race" },
    });
    const withdrawal = secondApp.inject({ method: "DELETE", url: `/api/v1/experiments/${sessionId}`,
      headers: { authorization: `Bearer ${target.id}` } });
    try {
      await Promise.all([expectPending(removal), expectPending(withdrawal)]);
      await expectDatabaseLockWait("tester_runs", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;

    const [removed, withdrawn] = await Promise.all([removal, withdrawal]);
    expect(removed.statusCode, removed.body).toBe(200);
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    const run = await db.testerRun.findUniqueOrThrow({
      where: { user_id_session_id: { user_id: target.id, session_id: sessionId } },
    });
    expect(run.withdrawn_at).toBeInstanceOf(Date);
    const identity = tripIdentity(target.id, sessionId, config.JWT_SECRET);
    const publicPage = await firstApp.inject({ url: "/api/v1/experiments?limit=100" });
    expect(publicPage.json().runs.some((candidate: { id: string }) => candidate.id === identity.id)).toBe(false);
    const audit = await db.adminSessionActionAudit.findMany({ where: { session_id: sessionId } });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("removal");
  });

  it("serializes session corrections with revocation of the acting administrator", async () => {
    const actor = await createUser({ admin: true });
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    const blocker = await holdControlRow(secondDb);
    const correction = firstApp.inject({
      method: "PATCH", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${actor.id}` },
      payload: { expectedVersion: 0, reason: "Native actor revocation serialization", changes: { distractions: 2 } },
    });
    const revocation = secondApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${actor.id}/role`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { isAdmin: false, expectedVersion: 0, reason: "Revoke native test actor" },
    });
    try {
      await Promise.all([expectPending(correction), expectPending(revocation)]);
      await expectDatabaseLockWait("admin_control", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;

    const [corrected, revoked] = await Promise.all([correction, revocation]);
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect([200, 403]).toContain(corrected.statusCode);
    expect(await db.adminGrant.findUnique({ where: { user_id: actor.id } })).toMatchObject({ is_active: false });
    expect(await db.adminSessionActionAudit.count({ where: { session_id: sessionId } }))
      .toBe(corrected.statusCode === 200 ? 1 : 0);
    const rows = await db.$queryRaw<{ override: unknown }[]>`
      SELECT state->'sessionOverrides'->${sessionId} AS override FROM adventure_state WHERE id = 1`;
    expect(rows[0]?.override !== null).toBe(corrected.statusCode === 200);
  });

  it("keeps withdrawn tester runs withdrawn when a correction races owner withdrawal", async () => {
    const target = await createUser();
    const sessionId = await seedSession(target.id);
    const published = await firstApp.inject({ method: "POST", url: "/api/v1/experiments",
      headers: { authorization: `Bearer ${target.id}` }, payload: { sessionId } });
    expect(published.statusCode, published.body).toBe(200);
    const blocker = await holdTesterRun(secondDb, target.id, sessionId);
    const correction = firstApp.inject({
      method: "PATCH", url: `/api/v1/admin/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { expectedVersion: 0, reason: "Native correction withdrawal race", changes: { topic: "history" } },
    });
    const withdrawal = secondApp.inject({ method: "DELETE", url: `/api/v1/experiments/${sessionId}`,
      headers: { authorization: `Bearer ${target.id}` } });
    try {
      await Promise.all([expectPending(correction), expectPending(withdrawal)]);
      await expectDatabaseLockWait("tester_runs", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;
    const [corrected, withdrawn] = await Promise.all([correction, withdrawal]);
    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(withdrawn.statusCode, withdrawn.body).toBe(200);
    const run = await db.testerRun.findUnique({ where: { user_id_session_id: { user_id: target.id, session_id: sessionId } } });
    expect(run?.withdrawn_at).toBeInstanceOf(Date);
    const publicPage = await firstApp.inject({ url: "/api/v1/experiments?limit=100" });
    const identity = tripIdentity(target.id, sessionId, config.JWT_SECRET);
    expect(publicPage.json().runs.some((candidate: { id: string }) => candidate.id === identity.id)).toBe(false);
    const mine = await firstApp.inject({ url: "/api/v1/experiments/mine", headers: { authorization: `Bearer ${target.id}` } });
    expect(mine.json()).not.toContainEqual({ sessionId });
  });

  it("serializes two clients removing each other through admin_control FOR UPDATE", async () => {
    const first = await createUser({ admin: true });
    const second = await createUser({ admin: true });
    const blocker = await holdControlRow(secondDb);
    const removeSecond = firstApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${second.id}/role`,
      headers: { authorization: `Bearer ${first.id}` },
      payload: { isAdmin: false, expectedVersion: 0, reason: "Concurrent native admin review A" },
    });
    const removeFirst = secondApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${first.id}/role`,
      headers: { authorization: `Bearer ${second.id}` },
      payload: { isAdmin: false, expectedVersion: 0, reason: "Concurrent native admin review B" },
    });
    try {
      await Promise.all([expectPending(removeSecond), expectPending(removeFirst)]);
      await expectDatabaseLockWait("admin_control", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;

    const responses = await Promise.all([removeSecond, removeFirst]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 403]);
    // Scope the invariant check to the two synthetic competing admins. Other
    // fixture rows and append-only audit history belong to other test cases.
    expect(await db.adminGrant.count({ where: { user_id: { in: [first.id, second.id] }, is_active: true } })).toBe(1);
    expect(await db.adminActionAudit.count({ where: { actor_user_id: { in: [first.id, second.id] } } })).toBe(1);
  });

  it("allows one same-target mutation for a shared expectedVersion and audits only that winner", async () => {
    const target = await createUser();
    const blocker = await holdControlRow(secondDb);
    const grantRole = firstApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/role`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { isAdmin: true, expectedVersion: 0, reason: "Competing native role change" },
    });
    const suspend = secondApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { suspended: true, expectedVersion: 0, reason: "Competing native suspension" },
    });
    try {
      await Promise.all([expectPending(grantRole), expectPending(suspend)]);
      await expectDatabaseLockWait("admin_control", 2);
    } finally {
      blocker.release();
    }
    await blocker.done;

    const responses = await Promise.all([grantRole, suspend]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const state = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(state.admin_state_version).toBe(1);
    expect(await db.adminActionAudit.count({ where: { target_user_id: target.id } })).toBe(1);
  });

  it("serializes deletion with token issuance and rotation, then requires fresh signin after restore", async () => {
    const target = await createUser();
    const staleAuthRead = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    const original = await issueTokens(db, staleAuthRead);
    const blocker = await holdUserRow(secondDb, target.id);
    let issued: Awaited<ReturnType<typeof issueTokens>> | undefined;
    let rotated: Awaited<ReturnType<typeof rotateToken>> | undefined;
    let issueFailure: unknown;
    let rotationFailure: unknown;
    const issue = issueTokens(db, staleAuthRead)
      .then((tokens) => { issued = tokens; })
      .catch((error: unknown) => { issueFailure = error; });
    const rotate = rotateToken(secondDb, original.refresh_token)
      .then((tokens) => { rotated = tokens; })
      .catch((error: unknown) => { rotationFailure = error; });
    const deletion = firstApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/deletion`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { deleted: true, expectedVersion: 0, reason: "Native deletion lock interaction" },
    });
    try {
      await Promise.all([expectPending(issue), expectPending(rotate), expectPending(deletion)]);
      await expectDatabaseLockWait("FROM users", 3);
    } finally {
      blocker.release();
    }
    await blocker.done;
    await Promise.all([issue, rotate]);
    const deleted = await deletion;
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({ status: "deleted", isAdmin: false, deletedAt: expect.any(String) });
    expect((issued !== undefined) !== (issueFailure instanceof ApiError)).toBe(true);
    expect((rotated !== undefined) !== (rotationFailure instanceof ApiError)).toBe(true);
    if (issueFailure) expect(issueFailure).toBeInstanceOf(ApiError);
    if (rotationFailure) expect(rotationFailure).toBeInstanceOf(ApiError);
    expect(await db.refreshToken.count({ where: { user_id: target.id } })).toBe(0);

    const restored = await secondApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/deletion`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { deleted: false, expectedVersion: 1, reason: "Native deletion restore test" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ status: "active", isAdmin: false, adminSource: null, deletedAt: null });
    expect(await db.refreshToken.count({ where: { user_id: target.id } })).toBe(0);
    await expect(verifyActiveAccess(db, original.access_token)).rejects.toMatchObject({ status: 401 });
    if (issued) await expect(verifyActiveAccess(db, issued.access_token)).rejects.toMatchObject({ status: 401 });
    if (rotated) await expect(verifyActiveAccess(db, rotated.access_token)).rejects.toMatchObject({ status: 401 });
    await expect(issueTokens(db, staleAuthRead)).rejects.toMatchObject({ status: 401 });
    await expect(rotateToken(db, original.refresh_token)).rejects.toMatchObject({ status: 401 });
    const fresh = await issueTokens(db, await db.user.findUniqueOrThrow({ where: { id: target.id } }));
    await expect(verifyActiveAccess(db, fresh.access_token)).resolves.toBe(target.id);
    expect(await db.adminGrant.findUnique({ where: { user_id: target.id } })).toMatchObject({ is_active: false });
    expect(await db.adminActionAudit.count({ where: { target_user_id: target.id } })).toBe(2);
  });

  it("serializes token issuance and refresh with suspension, then keeps all pre-restore access stale", async () => {
    const target = await createUser();
    const staleAuthRead = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    const original = await issueTokens(db, staleAuthRead);
    const blocker = await holdUserRow(secondDb, target.id);
    let issued: Awaited<ReturnType<typeof issueTokens>> | undefined;
    let rotated: Awaited<ReturnType<typeof rotateToken>> | undefined;
    let issueFailure: unknown;
    let rotationFailure: unknown;
    const issue = issueTokens(db, staleAuthRead)
      .then((tokens) => { issued = tokens; })
      .catch((error: unknown) => { issueFailure = error; });
    const rotate = rotateToken(secondDb, original.refresh_token)
      .then((tokens) => { rotated = tokens; })
      .catch((error: unknown) => { rotationFailure = error; });
    const suspension = firstApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { suspended: true, expectedVersion: 0, reason: "Native suspension serialization test" },
    });
    try {
      await Promise.all([expectPending(issue), expectPending(rotate), expectPending(suspension)]);
      await expectDatabaseLockWait("FROM users", 3);
    } finally {
      blocker.release();
    }
    await blocker.done;
    const [, , suspended] = await Promise.all([issue, rotate, suspension]);
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect((issued !== undefined) !== (issueFailure instanceof ApiError)).toBe(true);
    expect((rotated !== undefined) !== (rotationFailure instanceof ApiError)).toBe(true);
    expect(await db.refreshToken.count({ where: { user_id: target.id } })).toBe(0);

    const restored = await secondApp.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`,
      headers: { authorization: `Bearer ${bootstrapId}` },
      payload: { suspended: false, expectedVersion: 1, reason: "Native suspension restore test" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(await db.refreshToken.count({ where: { user_id: target.id } })).toBe(0);
    await expect(verifyActiveAccess(db, original.access_token)).rejects.toMatchObject({ status: 401 });
    if (issued) await expect(verifyActiveAccess(db, issued.access_token)).rejects.toMatchObject({ status: 401 });
    if (rotated) await expect(verifyActiveAccess(db, rotated.access_token)).rejects.toMatchObject({ status: 401 });
    await expect(issueTokens(db, staleAuthRead)).rejects.toMatchObject({ status: 401 });
    expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(original.refresh_token) } })).toBeNull();
  });
});
