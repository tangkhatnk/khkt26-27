import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { adminRoutes } from "../src/admin.js";
import { hashToken, issueTokens, rotateToken, verifyActiveAccess } from "../src/auth.js";
import { config } from "../src/config.js";
import { ApiError } from "../src/errors.js";

const pg = new PGlite();
const app = Fastify({ logger: false });
const raceApp = Fastify({ logger: false });
let socket: PGLiteSocketServer;
let db: PrismaClient;
let bootstrapId: string;
let previousDatabaseUrl: string | undefined;

const authenticate = async (request: FastifyRequest) => {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer "))
    throw new ApiError(401, "authentication-error", "Authentication required");
  request.userId = value.slice(7);
};

function configureApp(target: typeof app, bootstrapIds: string[]) {
  target.decorateRequest("userId", "");
  target.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ detail: error.message });
    if (error instanceof ZodError) return reply.code(400).send({ detail: "validation error" });
    return reply.code(500).send({ detail: "internal error" });
  });
  adminRoutes(target, db, authenticate, bootstrapIds);
}

async function createUser(options: { admin?: boolean } = {}) {
  const id = randomUUID();
  const user = await db.user.create({ data: {
    id,
    email: `synthetic-${randomUUID()}@example.test`,
    name: "Synthetic admin fixture",
  } });
  if (options.admin) await db.adminGrant.create({ data: { user_id: id, is_active: true } });
  return user;
}

function bearer(userId: string) {
  return { authorization: `Bearer ${userId}` };
}

async function holdUserRow(userId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const lockAcquired = new Promise<void>((resolve) => { acquired = resolve; });
  const blocker = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    acquired();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await lockAcquired;
  return { release: () => release(), done: blocker };
}

async function expectConcurrentOperationsToWait(first: Promise<unknown>, second: Promise<unknown>) {
  const both = Promise.allSettled([first, second]);
  const state = await Promise.race([
    both.then(() => "settled" as const),
    new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 30)),
  ]);
  expect(state).toBe("waiting");
}

beforeAll(async () => {
  const migrationDirectory = new URL("../prisma/migrations/", import.meta.url);
  const migrationNames = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of migrationNames) {
    await pg.exec(await readFile(new URL(`${name}/migration.sql`, migrationDirectory), "utf8"));
  }

  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate test database port");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: address.port, maxConnections: 10 });
  await socket.start();
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres?connection_limit=8&sslmode=disable`;
  db = new PrismaClient();
  await db.$connect();
  bootstrapId = randomUUID();
  await db.user.create({ data: { id: bootstrapId, email: "bootstrap@example.test", name: "Bootstrap fixture" } });
  configureApp(app, [bootstrapId]);
  configureApp(raceApp, []);
  await Promise.all([app.ready(), raceApp.ready()]);
});

beforeEach(async () => {
  await db.user.updateMany({ data: { suspended_at: null, deleted_at: null, admin_state_version: 0 } });
  await db.adminGrant.updateMany({ data: { is_active: false } });
  await db.$executeRaw`TRUNCATE TABLE admin_action_audits`;
});

afterAll(async () => {
  await Promise.allSettled([app.close(), raceApp.close()]);
  if (db) await db.$disconnect();
  if (socket) await socket.stop();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await pg.close();
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("admin account controls", () => {
  it("matches accounts by an exact UUID in addition to name and email", async () => {
    const target = await createUser();
    const response = await app.inject({
      url: `/api/v1/admin/accounts?q=${target.id}`,
      headers: bearer(bootstrapId),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().users).toHaveLength(1);
    expect(response.json().users[0]).toMatchObject({ id: target.id, name: target.name });
  });

  it("grants and revokes persistent admin access with version checks and a narrow audit", async () => {
    const target = await createUser();
    const grant = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/accounts/${target.id}/role`,
      headers: bearer(bootstrapId),
      payload: { isAdmin: true, expectedVersion: 0, reason: "Routine access review" },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    expect(grant.json()).toMatchObject({
      id: target.id,
      isAdmin: true,
      adminSource: "persistent",
      status: "active",
      suspendedAt: null,
      adminStateVersion: 1,
    });
    const grantedAdmin = await app.inject({ url: "/api/v1/admin/access", headers: bearer(target.id) });
    expect(grantedAdmin.json()).toEqual({ allowed: true });

    const stale = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/accounts/${target.id}/role`,
      headers: bearer(bootstrapId),
      payload: { isAdmin: false, expectedVersion: 0, reason: "Stale access review" },
    });
    expect(stale.statusCode).toBe(409);

    const revoke = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/accounts/${target.id}/role`,
      headers: bearer(bootstrapId),
      payload: { isAdmin: false, expectedVersion: 1, reason: "Role no longer required" },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(revoke.json()).toMatchObject({ isAdmin: false, adminSource: null, adminStateVersion: 2 });
    const denied = await app.inject({ url: "/api/v1/admin/accounts", headers: bearer(target.id) });
    expect(denied.statusCode).toBe(403);

    const audit = await app.inject({ url: `/api/v1/admin/audit?targetId=${target.id}`, headers: bearer(bootstrapId) });
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.json()).toMatchObject({
      total: 2,
      actions: [
        { actorId: bootstrapId, targetId: target.id, action: "role", before: { isAdmin: true, version: 1 }, after: { isAdmin: false, version: 2 } },
        { actorId: bootstrapId, targetId: target.id, action: "role", before: { isAdmin: false, version: 0 }, after: { isAdmin: true, version: 1 } },
      ],
    });
    expect(audit.body).toContain("Routine access review");
    expect(audit.body).not.toContain(target.email);
    expect(audit.body).not.toContain("password_hash");
    expect(audit.body).not.toContain("Private learning material");
  });

  it("edits a display name with a versioned reason and retains only the narrow name history", async () => {
    const target = await createUser();
    const response = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/profile`, headers: bearer(bootstrapId),
      payload: { name: "Updated synthetic name", expectedName: target.name, expectedVersion: 0, reason: "Correcting a display name" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      id: target.id, email: target.email, name: "Updated synthetic name",
      status: "active", deletedAt: null, adminStateVersion: 1,
    });

    const stale = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/profile`, headers: bearer(bootstrapId),
      payload: { name: "Stale display name", expectedName: "Updated synthetic name", expectedVersion: 0, reason: "Stale profile edit" },
    });
    expect(stale.statusCode).toBe(409);

    const audit = await app.inject({ url: `/api/v1/admin/audit?targetId=${target.id}`, headers: bearer(bootstrapId) });
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.json()).toMatchObject({
      total: 1,
      actions: [{
        action: "profile", reason: "Correcting a display name",
        before: { name: target.name, version: 0 },
        after: { name: "Updated synthetic name", version: 1 },
      }],
    });
    expect(audit.body).not.toContain(target.email);
    expect(audit.body).not.toContain("password_hash");
    expect(await db.adminActionAudit.count({ where: { target_user_id: target.id } })).toBe(1);
  });

  it("rejects an oversized expected name snapshot without mutation or audit", async () => {
    const target = await createUser();
    const response = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/profile`, headers: bearer(bootstrapId),
      payload: {
        name: "Updated synthetic name",
        expectedName: "x".repeat(101),
        expectedVersion: 0,
        reason: "Reject oversized profile snapshot",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      name: target.name,
      admin_state_version: 0,
    });
    expect(await db.adminActionAudit.count({ where: { target_user_id: target.id } })).toBe(0);
  });

  it("soft-deletes and restores accounts without restoring persistent admin or old credentials", async () => {
    const target = await createUser({ admin: true });
    const originalTokens = await issueTokens(db, target);

    const deleted = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/deletion`, headers: bearer(bootstrapId),
      payload: { deleted: true, expectedVersion: 0, reason: "Account recovery request" },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toMatchObject({
      id: target.id, status: "deleted", deletedAt: expect.any(String),
      isAdmin: false, adminSource: null, adminStateVersion: 1,
    });
    expect(await db.adminGrant.findUnique({ where: { user_id: target.id } })).toMatchObject({ is_active: false });
    expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(originalTokens.refresh_token) } })).toBeNull();
    await expect(verifyActiveAccess(db, originalTokens.access_token)).rejects.toMatchObject({ status: 401 });
    await expect(rotateToken(db, originalTokens.refresh_token)).rejects.toMatchObject({ status: 401 });
    expect((await app.inject({ url: "/api/v1/admin/access", headers: bearer(target.id) })).json()).toEqual({ allowed: false });

    const roleWhileDeleted = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/role`, headers: bearer(bootstrapId),
      payload: { isAdmin: true, expectedVersion: 1, reason: "Must not regrant while deleted" },
    });
    const profileWhileDeleted = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/profile`, headers: bearer(bootstrapId),
      payload: { name: "Unavailable profile", expectedName: target.name, expectedVersion: 1, reason: "Must restore first" },
    });
    const suspensionWhileDeleted = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: true, expectedVersion: 1, reason: "Must restore first" },
    });
    expect([roleWhileDeleted.statusCode, profileWhileDeleted.statusCode, suspensionWhileDeleted.statusCode]).toEqual([409, 409, 409]);
    expect(await db.adminActionAudit.count({ where: { target_user_id: target.id } })).toBe(1);

    const restored = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/deletion`, headers: bearer(bootstrapId),
      payload: { deleted: false, expectedVersion: 1, reason: "Restoring account access" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({
      id: target.id, status: "active", deletedAt: null,
      isAdmin: false, adminSource: null, adminStateVersion: 2,
    });
    expect(await db.adminGrant.findUnique({ where: { user_id: target.id } })).toMatchObject({ is_active: false });
    expect(await db.refreshToken.count({ where: { user_id: target.id } })).toBe(0);
    await expect(verifyActiveAccess(db, originalTokens.access_token)).rejects.toMatchObject({ status: 401 });

    const audit = await app.inject({ url: `/api/v1/admin/audit?targetId=${target.id}`, headers: bearer(bootstrapId) });
    expect(audit.json()).toMatchObject({
      total: 2,
      actions: [
        { action: "deletion", before: { isAdmin: false, deleted: true, version: 1 }, after: { isAdmin: false, deleted: false, version: 2 } },
        { action: "deletion", before: { isAdmin: true, deleted: false, version: 0 }, after: { isAdmin: false, deleted: true, version: 1 } },
      ],
    });
    expect(audit.body).not.toContain(target.email);
    const freshTokens = await issueTokens(db, await db.user.findUniqueOrThrow({ where: { id: target.id } }));
    await expect(verifyActiveAccess(db, freshTokens.access_token)).resolves.toBe(target.id);
  });

  it("rejects self-target and bootstrap profile or deletion changes with no audit", async () => {
    const actor = await createUser({ admin: true });
    const selfProfile = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${actor.id}/profile`, headers: bearer(actor.id),
      payload: { name: "Self edit", expectedName: actor.name, expectedVersion: 0, reason: "Self-target must be blocked" },
    });
    const selfDeletion = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${actor.id}/deletion`, headers: bearer(actor.id),
      payload: { deleted: true, expectedVersion: 0, reason: "Self-target must be blocked" },
    });
    const bootstrapDeletion = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${bootstrapId}/deletion`, headers: bearer(actor.id),
      payload: { deleted: true, expectedVersion: 0, reason: "Recovery admin must remain" },
    });
    expect([selfProfile.statusCode, selfDeletion.statusCode, bootstrapDeletion.statusCode]).toEqual([409, 409, 409]);
    expect(await db.adminActionAudit.count()).toBe(0);
  });

  it("shows the bootstrap source and refuses role or suspension changes to bootstrap accounts", async () => {
    const actor = await createUser({ admin: true });
    const listed = await app.inject({ url: `/api/v1/admin/accounts?q=${bootstrapId}`, headers: bearer(bootstrapId) });
    expect(listed.json().users).toContainEqual(expect.objectContaining({
      id: bootstrapId,
      isAdmin: true,
      adminSource: "bootstrap",
      status: "active",
      adminStateVersion: 0,
    }));
    const role = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${bootstrapId}/role`, headers: bearer(actor.id),
      payload: { isAdmin: false, expectedVersion: 0, reason: "Recovery access remains configured" },
    });
    const suspension = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${bootstrapId}/suspension`, headers: bearer(actor.id),
      payload: { suspended: true, expectedVersion: 0, reason: "Recovery access remains configured" },
    });
    expect(role.statusCode).toBe(409);
    expect(suspension.statusCode).toBe(409);
    const access = await app.inject({ url: "/api/v1/admin/access", headers: bearer(bootstrapId) });
    expect(access.json()).toEqual({ allowed: true });
  });

  it("suspends and restores accounts with refresh-token revocation and monotonic versions", async () => {
    const target = await createUser();
    const tokens = await issueTokens(db, target);
    const suspended = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: true, expectedVersion: 0, reason: "Temporary access pause" },
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    expect(suspended.json()).toMatchObject({ status: "suspended", suspendedAt: expect.any(String), adminStateVersion: 1 });
    expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(tokens.refresh_token) } })).toBeNull();

    const restored = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: false, expectedVersion: 1, reason: "Access pause ended" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ status: "active", suspendedAt: null, adminStateVersion: 2 });
    expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(tokens.refresh_token) } })).toBeNull();
  });

  it("rejects pre-suspension auth reads and access tokens after suspension is restored", async () => {
    const target = await createUser();
    const staleAuthRead = await db.user.findUniqueOrThrow({ where: { id: target.id } });
    const tokens = await issueTokens(db, staleAuthRead);

    const suspended = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: true, expectedVersion: 0, reason: "Test access-generation invalidation" },
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    const restored = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: false, expectedVersion: 1, reason: "Test access-generation restore" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().adminStateVersion).toBe(2);

    await expect(issueTokens(db, staleAuthRead)).rejects.toMatchObject({ status: 401 });
    await expect(verifyActiveAccess(db, tokens.access_token)).rejects.toMatchObject({ status: 401 });
    expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(tokens.refresh_token) } })).toBeNull();
  });

  it("accepts legacy access tokens only at version zero and refreshes into the current role version", async () => {
    const target = await createUser();
    const original = await issueTokens(db, target);
    const legacyAccess = await new SignJWT({ type: "access" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(target.id)
      .setIssuer("pomodoro-api")
      .setAudience("pomodoro-mobile")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    await expect(verifyActiveAccess(db, legacyAccess)).resolves.toBe(target.id);

    const grant = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/role`, headers: bearer(bootstrapId),
      payload: { isAdmin: true, expectedVersion: 0, reason: "Versioned access lifecycle" },
    });
    expect(grant.statusCode, grant.body).toBe(200);
    await expect(verifyActiveAccess(db, legacyAccess)).rejects.toMatchObject({ status: 401 });
    await expect(verifyActiveAccess(db, original.access_token)).rejects.toMatchObject({ status: 401 });

    const refreshed = await rotateToken(db, original.refresh_token);
    await expect(verifyActiveAccess(db, refreshed.access_token)).resolves.toBe(target.id);
  });

  it("serializes token issuance with suspension and leaves no refresh token after restore", async () => {
    const target = await createUser();
    const blocker = await holdUserRow(target.id);
    let issued: Awaited<ReturnType<typeof issueTokens>> | undefined;
    let issueError: unknown;
    const issue = issueTokens(db, target).then((tokens) => { issued = tokens; }).catch((error: unknown) => { issueError = error; });
    const suspend = app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: true, expectedVersion: 0, reason: "Pause during token creation" },
    });
    try {
      await expectConcurrentOperationsToWait(issue, suspend);
    } finally {
      blocker.release();
    }
    await blocker.done;
    const [suspension] = await Promise.all([suspend, issue]);
    expect(suspension.statusCode, suspension.body).toBe(200);
    if (issueError) expect(issueError).toBeInstanceOf(ApiError);
    const issuedHash = issued ? hashToken(issued.refresh_token) : undefined;
    if (issuedHash)
      expect(await db.refreshToken.findUnique({ where: { token_hash: issuedHash } })).toBeNull();

    const restored = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: false, expectedVersion: 1, reason: "Pause ended" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    if (issued) expect(await db.refreshToken.findUnique({ where: { token_hash: issuedHash! } })).toBeNull();
  });

  it("serializes refresh rotation with suspension and does not revive either token after restore", async () => {
    const target = await createUser();
    const original = await issueTokens(db, target);
    const blocker = await holdUserRow(target.id);
    let rotated: Awaited<ReturnType<typeof rotateToken>> | undefined;
    let rotationError: unknown;
    const rotation = rotateToken(db, original.refresh_token)
      .then((tokens) => { rotated = tokens; })
      .catch((error: unknown) => { rotationError = error; });
    const suspend = app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: true, expectedVersion: 0, reason: "Pause during refresh" },
    });
    try {
      await expectConcurrentOperationsToWait(rotation, suspend);
    } finally {
      blocker.release();
    }
    await blocker.done;
    const [suspension] = await Promise.all([suspend, rotation]);
    expect(suspension.statusCode, suspension.body).toBe(200);
    if (rotationError) expect(rotationError).toBeInstanceOf(ApiError);

    const restored = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: false, expectedVersion: 1, reason: "Pause ended" },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(original.refresh_token) } })).toBeNull();
    if (rotated)
      expect(await db.refreshToken.findUnique({ where: { token_hash: hashToken(rotated.refresh_token) } })).toBeNull();
  });

  it("rejects self-target actions and missing reasons without adding audit history", async () => {
    const self = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${bootstrapId}/suspension`, headers: bearer(bootstrapId),
      payload: { suspended: true, expectedVersion: 0, reason: "Self suspension" },
    });
    expect(self.statusCode).toBe(409);
    const target = await createUser({ admin: true });
    const missingReason = await app.inject({
      method: "PUT", url: `/api/v1/admin/accounts/${target.id}/role`, headers: bearer(bootstrapId),
      payload: { isAdmin: false, expectedVersion: 0, reason: "   " },
    });
    expect(missingReason.statusCode).toBe(400);
    const audit = await app.inject({ url: `/api/v1/admin/audit?targetId=${target.id}`, headers: bearer(bootstrapId) });
    expect(audit.json().total).toBe(0);
  });

  it("serializes overlapping removals through the singleton admin-control row", async () => {
    const first = await createUser({ admin: true });
    const second = await createUser({ admin: true });
    const requests = await Promise.all([
      raceApp.inject({
        method: "PUT", url: `/api/v1/admin/accounts/${second.id}/role`, headers: bearer(first.id),
        payload: { isAdmin: false, expectedVersion: 0, reason: "Concurrent review A" },
      }),
      raceApp.inject({
        method: "PUT", url: `/api/v1/admin/accounts/${first.id}/role`, headers: bearer(second.id),
        payload: { isAdmin: false, expectedVersion: 0, reason: "Concurrent review B" },
      }),
    ]);
    expect(requests.map((response) => response.statusCode).sort()).toEqual([200, 403]);
    const remaining = await db.adminGrant.count({ where: { is_active: true } });
    expect(remaining).toBe(1);
    const auditCount = await db.adminActionAudit.count();
    expect(auditCount).toBe(1);
  });
});
