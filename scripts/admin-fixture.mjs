import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = 5194;
const fixtureApiUrl = "http://127.0.0.1:" + port + "/api/v1";
const fixtureOwnerId = "00000000-0000-4000-8000-000000000999";
const fixtureActorId = "00000000-0000-4000-8000-000000000998";

function uuidFor(value) {
  return "00000000-0000-4000-8000-" + String(value).padStart(12, "0");
}

function makeAccounts() {
  const accounts = Array.from({ length: 55 }, (_value, index) => {
    const number = index + 1;
    const bootstrap = number === 2;
    const persistentAdmin = number === 3;
    const suspended = number === 7;
    return {
      id: uuidFor(number),
      email: "learner-" + String(number).padStart(2, "0") + "@example.invalid",
      name: "Người học mẫu " + String(number).padStart(2, "0"),
      createdAt: "2026-09-" + String((number % 27) + 1).padStart(2, "0") + "T08:00:00.000Z",
      isAdmin: bootstrap || persistentAdmin,
      adminSource: bootstrap ? "bootstrap" : persistentAdmin ? "persistent" : null,
      status: suspended ? "suspended" : "active",
      suspendedAt: suspended ? "2026-10-20T10:00:00.000Z" : null,
      deletedAt: null,
      adminStateVersion: number === 1 ? 31 : 1,
    };
  });
  accounts.push({
    id: fixtureOwnerId,
    email: "admin.fixture@example.invalid",
    name: "Quản trị viên fixture",
    createdAt: "2026-08-01T08:00:00.000Z",
    isAdmin: true,
    adminSource: "persistent",
    status: "active",
    suspendedAt: null,
    deletedAt: null,
    adminStateVersion: 1,
  });
  return accounts;
}

function makeAudit(targetId) {
  const actions = [];
  for (let version = 30; version >= 1; version--) {
    const before = { isAdmin: version % 2 === 0, suspended: false, deleted: false, version };
    const after = { isAdmin: !before.isAdmin, suspended: false, deleted: false, version: version + 1 };
    actions.push({
      actorId: fixtureActorId,
      targetId,
      action: "role",
      before,
      after,
      reason: "Lý do fixture " + version + ": đã xác minh yêu cầu.",
      createdAt: new Date(Date.UTC(2026, 9, 24, 10, version)).toISOString(),
    });
  }
  return actions;
}

function makeGroups() {
  return Array.from({ length: 33 }, (_value, index) => {
    const number = index + 1;
    return {
      id: uuidFor(1000 + number),
      name: "Đoàn học tập mẫu " + String(number).padStart(2, "0"),
      timezone: "Asia/Ho_Chi_Minh",
      archived: number % 9 === 0,
      memberCount: 3 + (number % 17),
      progress: { journeySeconds: number * 480, station: number % 5, remainingSeconds: 900, thresholdSeconds: 3600 },
    };
  });
}

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let value = "";
    request.on("data", (chunk) => {
      value += chunk;
      if (value.length > 16_384) reject(new Error("Fixture request body is too large."));
    });
    request.on("end", () => {
      try { resolveBody(value ? JSON.parse(value) : {}); }
      catch { reject(new Error("Fixture request body is not valid JSON.")); }
    });
    request.on("error", reject);
  });
}

function page(items, limit, offset, key) {
  return { [key]: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

function makeTotals(sessionCount, multiplier = 1) {
  return {
    sessionCount,
    plannedStudySeconds: sessionCount * 1800 * multiplier,
    actualStudySeconds: sessionCount * 1620 * multiplier,
    focusedSeconds: sessionCount * 1470 * multiplier,
    plannedBreakSeconds: sessionCount * 180 * multiplier,
    actualBreakSeconds: sessionCount * 150 * multiplier,
    distractions: Math.floor(sessionCount / 3),
    completedSessions: Math.floor(sessionCount * 0.7),
    completionPercent: 70,
    gradedQuizSessions: Math.floor(sessionCount * 0.6),
    quizCoveragePercent: 60,
    quizScore: 27,
    quizTotal: 30,
    quizScorePercent: 90,
  };
}

function makeReport(days, accountId, groupId) {
  const scopeFactor = accountId ? 1 : groupId ? 2 : 3;
  const totals = makeTotals(12 * scopeFactor, 1);
  const daily = Array.from({ length: days }, (_value, index) => ({
    ...makeTotals(index % 3 === 0 ? 2 : 1, 1),
    dateUtc: new Date(Date.UTC(2026, 9, 24 - days + index + 1)).toISOString().slice(0, 10),
  }));
  const topics = ["biology", "history", "mathematics"].map((topic, index) => ({
    ...makeTotals((index + 1) * scopeFactor),
    topic,
  }));
  return {
    days,
    timezone: "UTC",
    analysisLimit: 20000,
    fromUtc: new Date(Date.UTC(2026, 9, 24 - days)).toISOString(),
    asOfUtc: "2026-10-24T12:00:00.000Z",
    matchingSessionCount: totals.sessionCount + 4,
    recordsAnalyzed: totals.sessionCount,
    truncated: false,
    totals,
    daily,
    topics,
    fixtureScope: accountId ? "account:" + accountId : groupId ? "group:" + groupId : "overall",
  };
}

function makeSessions(accountId, groupId) {
  return Array.from({ length: 57 }, (_value, index) => {
    const started = new Date(Date.UTC(2026, 9, 24 - Math.floor(index / 2), 8 + (index % 8)));
    const ended = new Date(started.getTime() + 1800000);
    return {
      id: uuidFor(5000 + index + 1),
      accountId: accountId ?? uuidFor((index % 55) + 1),
      groupId: groupId ?? (index % 3 === 0 ? uuidFor(1001 + (index % 33)) : null),
      topic: ["biology", "history", "mathematics"][index % 3],
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      plannedStudySeconds: 1500,
      actualStudySeconds: 1440,
      focusedSeconds: 1320,
      plannedBreakSeconds: 300,
      actualBreakSeconds: 240,
      distractions: index % 4,
      completed: index % 5 !== 0,
      quizScore: index % 4 === 0 ? null : 3,
      quizTotal: index % 4 === 0 ? null : 5,
    };
  });
}

function adminFixtureApi() {
  const accounts = new Map(makeAccounts().map((account) => [account.id, account]));
  const audit = new Map();
  for (const account of accounts.values()) audit.set(account.id, makeAudit(account.id));
  const groups = makeGroups();

  return {
    name: "viendu-admin-fixture-api",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", fixtureApiUrl);
        if (!url.pathname.startsWith("/api/v1/")) return next();
        try {
          const mode = request.headers["x-admin-fixture-mode"] ?? "allowed";
          if (request.headers["x-admin-fixture-fail-next"] === "true") {
            json(response, 503, { status: 503, detail: "Fixture API tạm thời không khả dụng. Hãy thử lại." });
            return;
          }
          if (!String(request.headers.authorization ?? "").startsWith("Bearer admin-fixture-token")) {
            json(response, 401, { status: 401, detail: "Fixture yêu cầu token quản trị mẫu." });
            return;
          }
          if (mode === "denied" || mode === "revoked") {
            json(response, 403, { status: 403, detail: mode === "revoked" ? "Quyền quản trị fixture vừa bị thu hồi." : "Tài khoản fixture chưa được cấp quyền." });
            return;
          }

          const pathname = url.pathname.slice("/api/v1".length);
          if (request.method === "GET" && pathname === "/admin/access") {
            json(response, 200, { allowed: true });
            return;
          }

          const accountMutation = pathname.match(/^\/admin\/accounts\/([^/]+)\/(role|suspension|profile|deletion)$/);
          if (request.method === "PUT" && accountMutation) {
            const accountId = decodeURIComponent(accountMutation[1]);
            const target = accounts.get(accountId);
            if (!target) {
              json(response, 404, { status: 404, detail: "Không tìm thấy tài khoản fixture." });
              return;
            }
            if (request.headers["x-admin-fixture-revoke-mutation"] === "true") {
              json(response, 403, { status: 403, detail: "Quyền quản trị fixture bị thu hồi khi đang xác nhận." });
              return;
            }
            const body = await readBody(request);
            if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500) {
              json(response, 400, { status: 400, detail: "Cần nhập lý do kiểm toán (tối đa 500 ký tự)." });
              return;
            }
            if (target.id === fixtureOwnerId || target.adminSource === "bootstrap") {
              json(response, 409, { status: 409, detail: "Không thể sửa tài khoản đang đăng nhập hoặc tài khoản bootstrap." });
              return;
            }
            if (body.expectedVersion !== target.adminStateVersion) {
              json(response, 409, { status: 409, detail: "Dữ liệu đã cũ. Hãy tải lại tài khoản trước khi xác nhận lại." });
              return;
            }
            const action = accountMutation[2];
            if (target.deletedAt && action !== "deletion") {
              json(response, 409, { status: 409, detail: "Hãy khôi phục tài khoản đã xóa trước khi chỉnh sửa." });
              return;
            }
            const state = () => ({ isAdmin: target.isAdmin, suspended: Boolean(target.suspendedAt), deleted: Boolean(target.deletedAt), version: target.adminStateVersion });
            const previous = { ...state(), ...(action === "profile" ? { name: target.name } : {}) };
            const valid = action === "profile" ? typeof body.name === "string" && body.name.trim().length > 0 && body.name.trim().length <= 100 && typeof body.expectedName === "string" && body.expectedName.length <= 100
              : typeof body[action === "role" ? "isAdmin" : action === "deletion" ? "deleted" : "suspended"] === "boolean";
            if (!valid) {
              json(response, 400, { status: 400, detail: "Giá trị trạng thái không hợp lệ." });
              return;
            }
            if (action === "profile" && body.expectedName !== target.name) {
              json(response, 409, { status: 409, detail: "Tên hiển thị đã thay đổi. Hãy kiểm tra dữ liệu mới trước khi xác nhận lại." });
              return;
            }
            const changed = action === "profile" ? target.name !== body.name.trim()
              : action === "role" ? target.isAdmin !== body.isAdmin
                : action === "deletion" ? previous.deleted !== body.deleted : previous.suspended !== body.suspended;
            if (!changed) {
              json(response, 409, { status: 409, detail: "Tài khoản đã ở trạng thái yêu cầu." });
              return;
            }
            if (action === "role" && body.isAdmin === false && [...accounts.values()].filter((account) => account.isAdmin && account.status === "active").length <= 1) {
              json(response, 409, { status: 409, detail: "Cần giữ lại ít nhất một quản trị viên." });
              return;
            }
            if (action === "profile") {
              target.name = body.name.trim();
            } else if (action === "role") {
              target.isAdmin = body.isAdmin;
              target.adminSource = body.isAdmin ? "persistent" : null;
            } else if (action === "suspension") {
              target.status = body.suspended ? "suspended" : "active";
              target.suspendedAt = body.suspended ? new Date().toISOString() : null;
            } else {
              target.deletedAt = body.deleted ? new Date().toISOString() : null;
              target.status = body.deleted ? "deleted" : target.suspendedAt ? "suspended" : "active";
              if (body.deleted) { target.isAdmin = false; target.adminSource = null; }
            }
            target.adminStateVersion += 1;
            const after = { ...state(), ...(action === "profile" ? { name: target.name } : {}) };
            const entries = audit.get(accountId) ?? [];
            entries.unshift({
              actorId: fixtureActorId,
              targetId: accountId,
              action,
              before: previous,
              after,
              reason: body.reason.trim(),
              createdAt: new Date().toISOString(),
            });
            audit.set(accountId, entries);
            json(response, 200, target);
            return;
          }

          if (request.method === "GET" && pathname === "/admin/accounts") {
            const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
            const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
            const found = [...accounts.values()].filter((account) =>
              !query || [account.id, account.name, account.email].some((value) => value.toLocaleLowerCase().includes(query)),
            );
            json(response, 200, page(found, limit, offset, "users"));
            return;
          }

          if (request.method === "GET" && pathname === "/admin/audit") {
            const targetId = url.searchParams.get("targetId") ?? "";
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
            const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
            json(response, 200, page(audit.get(targetId) ?? [], limit, offset, "actions"));
            return;
          }

          if (request.method === "GET" && pathname === "/admin/groups") {
            const query = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase();
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
            const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
            const found = groups.filter((group) => !query || group.name.toLocaleLowerCase().includes(query) || group.id.includes(query));
            json(response, 200, page(found, limit, offset, "groups"));
            return;
          }

          if (request.method === "GET" && pathname === "/admin/sessions") {
            const accountId = url.searchParams.get("accountId") ?? undefined;
            const groupId = url.searchParams.get("groupId") ?? undefined;
            const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
            const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
            const sessions = makeSessions(accountId, groupId).filter((session) =>
              (!accountId || session.accountId === accountId) && (!groupId || session.groupId === groupId),
            );
            json(response, 200, {
              ...page(sessions, limit, offset, "sessions"),
              days: Number(url.searchParams.get("days")) || 7,
              timezone: "UTC",
              fromUtc: "2026-10-17T00:00:00.000Z",
              asOfUtc: "2026-10-24T12:00:00.000Z",
            });
            return;
          }

          if (request.method === "GET" && pathname === "/admin/report/export.csv") {
            const days = Number(url.searchParams.get("days")) || 7;
            const accountId = url.searchParams.get("accountId") ?? "";
            const groupId = url.searchParams.get("groupId") ?? "";
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/csv; charset=utf-8");
            response.setHeader("Content-Disposition", "attachment; filename=\"admin-fixture-" + days + "d-UTC.csv\"");
            response.setHeader("Cache-Control", "no-store");
            response.end("scope,days,accountId,groupId\n" + (accountId ? "account" : groupId ? "group" : "overall") + "," + days + "," + accountId + "," + groupId + "\n");
            return;
          }

          if (request.method === "GET" && pathname === "/admin/report") {
            const days = Math.max(7, Math.min(90, Number(url.searchParams.get("days")) || 7));
            json(response, 200, makeReport(days, url.searchParams.get("accountId"), url.searchParams.get("groupId")));
            return;
          }

          json(response, 404, { status: 404, detail: "Fixture route not found: " + pathname });
        } catch (error) {
          if (response.headersSent) {
            response.destroy(error);
            return;
          }
          json(response, 500, { status: 500, detail: error instanceof Error ? error.message : "Fixture API error." });
        }
      });
    },
  };
}

async function start() {
  process.env.VITE_API_URL = fixtureApiUrl;
  const server = await createServer({
    configFile: false,
    root,
    plugins: [react(), adminFixtureApi()],
    resolve: { alias: { "@": resolve(root, "src") } },
    define: { "import.meta.env.VITE_API_URL": JSON.stringify(fixtureApiUrl) },
    server: { host: "127.0.0.1", port, strictPort: true },
    appType: "spa",
  });
  await server.listen();
  server.printUrls();
  console.log("Admin fixture API is loopback-only and uses synthetic example.invalid accounts.");
  console.log("Open http://localhost:5194/admin-fixture.html?mode=allowed");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await start();
}
