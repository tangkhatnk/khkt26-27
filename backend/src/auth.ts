import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import type { PrismaClient, User, Prisma } from "@prisma/client";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
const secret = new TextEncoder().encode(config.JWT_SECRET);
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const userSelect = {
  id: true,
  email: true,
  name: true,
  avatar_url: true,
  created_at: true,
} as const;
export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatar_url: u.avatar_url,
  created_at: u.created_at,
});
async function accessToken(user: Pick<User, "id" | "email" | "name" | "admin_state_version">) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    type: "access",
    admin_state_version: user.admin_state_version,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("pomodoro-api")
    .setAudience("pomodoro-mobile")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}
export async function issueTokens(
  db: PrismaClient | Prisma.TransactionClient,
  user: User,
) {
  const createInTransaction = (tx: Prisma.TransactionClient) =>
    issueTokensForActiveUser(tx, user.id, user.admin_state_version);
  if (typeof (db as PrismaClient).$transaction === "function")
    return (db as PrismaClient).$transaction(createInTransaction);
  return createInTransaction(db as Prisma.TransactionClient);
}

type ActiveTokenUser = Pick<User, "id" | "email" | "name" | "admin_state_version" | "deleted_at">;

async function lockActiveTokenUser(
  db: Prisma.TransactionClient,
  userId: string,
  expectedVersion?: number,
): Promise<ActiveTokenUser> {
  const rows = await db.$queryRaw<Array<ActiveTokenUser & { suspended_at: Date | null }>>`
    SELECT id, email, name, suspended_at, deleted_at, admin_state_version
    FROM users
    WHERE id = ${userId}::uuid
    FOR UPDATE`;
  const user = rows[0];
  if (!user || user.suspended_at || user.deleted_at ||
    (expectedVersion !== undefined && user.admin_state_version !== expectedVersion))
    throw new ApiError(401, "authentication-error", "Account is unavailable");
  return user;
}

async function issueTokensForActiveUser(
  db: Prisma.TransactionClient,
  userId: string,
  expectedVersion: number,
) {
  const user = await lockActiveTokenUser(db, userId, expectedVersion);
  const refresh = randomBytes(48).toString("base64url");
  return createTokensForLockedUser(db, user, refresh);
}
export async function rotateToken(db: PrismaClient, token: string) {
  return db.$transaction(async (tx) => {
    // DELETE ... RETURNING behavior is emulated with deleteMany's atomic count.
    const row = await tx.refreshToken.findUnique({
      where: { token_hash: hashToken(token) },
    });
    if (!row || row.expires_at.getTime() <= Date.now())
      throw new ApiError(401, "authentication-error", "Invalid refresh token");
    const user = await lockActiveTokenUser(tx, row.user_id);
    const deleted = await tx.refreshToken.deleteMany({ where: { id: row.id } });
    if (deleted.count !== 1)
      throw new ApiError(
        401,
        "authentication-error",
        "Refresh token already used",
      );
    return createTokensForLockedUser(tx, user, randomBytes(48).toString("base64url"));
  });
}

async function createTokensForLockedUser(
  db: Prisma.TransactionClient,
  user: ActiveTokenUser,
  refresh: string,
) {
  await db.refreshToken.create({
    data: {
      user_id: user.id,
      token_hash: hashToken(refresh),
      expires_at: new Date(Date.now() + 30 * 86400000),
    },
  });
  return {
    access_token: await accessToken(user),
    refresh_token: refresh,
    expires_in: 900,
  };
}
async function verifiedAccess(token?: string) {
  if (!token)
    throw new ApiError(401, "authentication-error", "Authentication required");
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: "pomodoro-api",
      audience: "pomodoro-mobile",
    });
    if (!payload.sub || payload.type !== "access")
      throw new Error("Invalid token");
    const version = payload.admin_state_version;
    if (version !== undefined &&
      (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0))
      throw new Error("Invalid token version");
    return { userId: payload.sub, adminStateVersion: version as number | undefined };
  } catch {
    throw new ApiError(
      401,
      "authentication-error",
      "Invalid or expired access token",
    );
  }
}

export async function verifyAccess(token?: string) {
  return (await verifiedAccess(token)).userId;
}

export async function verifyActiveAccess(db: PrismaClient, token?: string) {
  const access = await verifiedAccess(token);
  const user = await db.user.findUnique({
    where: { id: access.userId },
    select: { id: true, suspended_at: true, deleted_at: true, admin_state_version: true },
  });
  const versionIsCurrent = access.adminStateVersion === undefined
    ? user?.admin_state_version === 0
    : user?.admin_state_version === access.adminStateVersion;
  if (!user || user.suspended_at || user.deleted_at || !versionIsCurrent)
    throw new ApiError(401, "authentication-error", "Account is unavailable");
  return access.userId;
}
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const appleKeys = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);
export async function verifyOAuth(provider: "google" | "apple", token: string) {
  const audience =
    provider === "google" ? config.GOOGLE_CLIENT_ID : config.APPLE_CLIENT_ID;
  if (!audience)
    throw new ApiError(
      503,
      "service-unavailable",
      "OAuth provider is not configured",
    );
  try {
    const { payload } = await jwtVerify(
      token,
      provider === "google" ? googleKeys : appleKeys,
      {
        audience,
        issuer:
          provider === "google"
            ? ["https://accounts.google.com", "accounts.google.com"]
            : "https://appleid.apple.com",
        algorithms: ["RS256"],
      },
    );
    if (
      !payload.sub ||
      typeof payload.email !== "string" ||
      ![true, "true"].includes(payload.email_verified as boolean | string)
    )
      throw new Error("Email unverified");
    return {
      id: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : "Người học",
    };
  } catch {
    throw new ApiError(
      401,
      "authentication-error",
      "Invalid provider identity token",
    );
  }
}
