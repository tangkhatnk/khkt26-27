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

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function emptyTotals() {
  return {
    sessionCount: 0,
    plannedStudySeconds: 0,
    actualStudySeconds: 0,
    focusedSeconds: 0,
    plannedBreakSeconds: 0,
    actualBreakSeconds: 0,
    distractions: 0,
    completedSessions: 0,
    completionPercent: 0,
    gradedQuizSessions: 0,
    quizCoveragePercent: 0,
    quizScore: 0,
    quizTotal: 0,
    quizScorePercent: null,
  };
}

function addReportSession(totals, metrics) {
  totals.sessionCount += 1;
  totals.plannedStudySeconds += metrics.targetSeconds;
  totals.actualStudySeconds += metrics.actualStudySeconds;
  totals.focusedSeconds += metrics.focusedSeconds;
  totals.plannedBreakSeconds += metrics.plannedBreakSeconds;
  totals.actualBreakSeconds += metrics.actualBreakSeconds;
  totals.distractions += metrics.distractions;
  totals.completedSessions += Number(metrics.completed);
  if (metrics.quizScore !== null && metrics.quizTotal !== null) {
    totals.gradedQuizSessions += 1;
    totals.quizScore += metrics.quizScore;
    totals.quizTotal += metrics.quizTotal;
  }
}

function finishReportTotals(totals) {
  const roundPercent = (value) => Math.round(value * 10) / 10;
  return {
    ...totals,
    plannedStudySeconds: Math.round(totals.plannedStudySeconds * 10) / 10,
    actualStudySeconds: Math.round(totals.actualStudySeconds * 10) / 10,
    focusedSeconds: Math.round(totals.focusedSeconds * 10) / 10,
    actualBreakSeconds: Math.round(totals.actualBreakSeconds * 10) / 10,
    completionPercent: totals.sessionCount ? roundPercent((totals.completedSessions / totals.sessionCount) * 100) : 0,
    quizCoveragePercent: totals.sessionCount ? roundPercent((totals.gradedQuizSessions / totals.sessionCount) * 100) : 0,
    quizScorePercent: totals.quizTotal ? roundPercent((totals.quizScore / totals.quizTotal) * 100) : null,
  };
}

function makeSessions() {
  return Array.from({ length: 57 }, (_value, index) => {
    const started = new Date(Date.UTC(2026, 9, 24 - Math.floor(index / 2), 8 + (index % 8)));
    const isShort = index === 1;
    const metrics = isShort
      ? { targetSeconds: 60, elapsedSeconds: 53.5, actualStudySeconds: 40, focusedSeconds: 35, plannedBreakSeconds: 0, actualBreakSeconds: 13.5, distractions: 0, completed: false, quizScore: null, quizTotal: null }
      : { targetSeconds: 1500, elapsedSeconds: 1800, actualStudySeconds: 1440, focusedSeconds: 1320, plannedBreakSeconds: 300, actualBreakSeconds: 240, distractions: index % 4, completed: false, quizScore: index % 4 === 0 ? null : 3, quizTotal: index % 4 === 0 ? null : 5 };
    return {
      id: uuidFor(5000 + index + 1),
      ownerId: index === 0 ? `guest:${uuidFor(9001)}` : uuidFor((index % 55) + 1),
      accountId: index === 0 ? null : uuidFor((index % 55) + 1),
      groupId: index === 0 ? null : index % 3 === 0 ? uuidFor(1001 + (index % 33)) : null,
      topic: ["biology", "history", "mathematics"][index % 3],
      goal: `Mục tiêu fixture ban đầu ${index + 1}`,
      startedAt: started.toISOString(),
      endedAt: new Date(started.getTime() + metrics.elapsedSeconds * 1000).toISOString(),
      measuredMetrics: metrics,
    };
  });
}

function adminFixtureApi() {
  const accounts = new Map(makeAccounts().map((account) => [account.id, account]));
  const audit = new Map();
  for (const account of accounts.values()) audit.set(account.id, makeAudit(account.id));
  const groups = makeGroups();
  const sessions = new Map(makeSessions().map((session) => [session.id, session]));
  const sessionOverrides = new Map();
  const sessionAudits = new Map();
  const correctionFields = ["goal", "topic", "targetSeconds", "elapsedSeconds", "actualStudySeconds", "focusedSeconds", "actualBreakSeconds", "distractions", "quizResult"];

  function projectedSession(session, suppliedOverride) {
    const override = suppliedOverride ?? sessionOverrides.get(session.id) ?? { version: 0 };
    const metrics = { ...session.measuredMetrics };
    for (const field of ["targetSeconds", "elapsedSeconds", "actualStudySeconds", "focusedSeconds", "actualBreakSeconds", "distractions"])
      if (Object.hasOwn(override, field)) metrics[field] = override[field];
    if (Object.hasOwn(override, "quizResult")) {
      metrics.quizScore = override.quizResult.score;
      metrics.quizTotal = override.quizResult.total;
    }
    metrics.completed = metrics.actualStudySeconds >= metrics.targetSeconds;
    const metricSources = Object.fromEntries(correctionFields.map((field) => [
      field, Object.hasOwn(override, field) ? "corrected" : "measured",
    ]));
    const measuredMetrics = { ...session.measuredMetrics, plannedStudySeconds: session.measuredMetrics.targetSeconds };
    const effectiveMetrics = { ...metrics, plannedStudySeconds: metrics.targetSeconds };
    return {
      id: session.id,
      ownerId: session.ownerId,
      accountId: session.accountId,
      groupId: session.groupId,
      status: "active",
      correctionVersion: override.version,
      topic: override.topic ?? session.topic,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      timestampsAreSettlementFacts: true,
      metrics: effectiveMetrics,
      measuredMetrics,
      metricSources,
      ...effectiveMetrics,
    };
  }

  function sessionDto(session, includeGoal = false, suppliedOverride) {
    const override = suppliedOverride ?? sessionOverrides.get(session.id) ?? { version: 0 };
    const dto = projectedSession(session, override);
    const goal = override.goal ?? session.goal;
    if (includeGoal) {
      dto.goal = goal;
      dto.measuredContent = { goal: session.goal, topic: session.topic };
    } else {
      delete dto.goal;
    }
    return dto;
  }

  function sessionAuditState(session, override = sessionOverrides.get(session.id) ?? { version: 0 }) {
    const dto = sessionDto(session, true, override);
    const metrics = { ...dto.metrics };
    delete metrics.plannedStudySeconds;
    return { status: "active", correctionVersion: override.version, goal: dto.goal, topic: dto.topic, metrics };
  }

  function makeReport(days, accountId, groupId) {
    const asOfMs = Date.now();
    const now = new Date(asOfMs);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const fromMs = todayUtc - (days - 1) * 86400000;
    const matching = [...sessions.values()].filter((session) => {
      const override = sessionOverrides.get(session.id) ?? { version: 0 };
      const started = Date.parse(session.startedAt);
      return !override.removedAt && (!accountId || session.accountId === accountId) &&
        (!groupId || session.groupId === groupId) && started >= fromMs && started <= asOfMs;
    });
    const daily = new Map(Array.from({ length: days }, (_value, index) => {
      const dateUtc = new Date(fromMs + index * 86400000).toISOString().slice(0, 10);
      return [dateUtc, emptyTotals()];
    }));
    const topics = new Map();
    const totals = emptyTotals();
    for (const session of matching) {
      const projected = projectedSession(session);
      addReportSession(totals, projected.metrics);
      const dateUtc = session.startedAt.slice(0, 10);
      const dayTotals = daily.get(dateUtc);
      if (dayTotals) addReportSession(dayTotals, projected.metrics);
      const topicTotals = topics.get(projected.topic) ?? emptyTotals();
      addReportSession(topicTotals, projected.metrics);
      topics.set(projected.topic, topicTotals);
    }
    return {
      days,
      timezone: "UTC",
      analysisLimit: 20000,
      fromUtc: new Date(fromMs).toISOString(),
      asOfUtc: new Date(asOfMs).toISOString(),
      matchingSessionCount: matching.length,
      recordsAnalyzed: matching.length,
      truncated: false,
      totals: finishReportTotals(totals),
      daily: [...daily].map(([dateUtc, values]) => ({ dateUtc, ...finishReportTotals(values) })),
      topics: [...topics].map(([topic, values]) => ({ topic, ...finishReportTotals(values) }))
        .sort((left, right) => right.focusedSeconds - left.focusedSeconds || left.topic.localeCompare(right.topic)),
    };
  }

  function auditSessionMutation(session, action, beforeVersion, afterVersion, before, after, reason) {
    const rows = sessionAudits.get(session.id) ?? [];
    rows.unshift({
      actorId: fixtureOwnerId,
      targetOwnerId: session.ownerId,
      sessionId: session.id,
      action,
      beforeVersion,
      afterVersion,
      before,
      after,
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
    });
    sessionAudits.set(session.id, rows);
  }

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

          if (request.headers["x-admin-fixture-fail-report"] === "true" && url.pathname === "/api/v1/admin/report") {
            json(response, 503, { status: 503, detail: "Fixture không tải được báo cáo lần này. Hãy thử lại." });
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

          const sessionAuditMatch = pathname.match(/^\/admin\/sessions\/([^/]+)\/audit$/);
          if (request.method === "GET" && sessionAuditMatch) {
            const sessionId = decodeURIComponent(sessionAuditMatch[1]);
            const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
            const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get("offset")) || 0));
            json(response, 200, page(sessionAudits.get(sessionId) ?? [], limit, offset, "actions"));
            return;
          }

          const sessionMatch = pathname.match(/^\/admin\/sessions\/([^/]+)$/);
          if (sessionMatch && ["GET", "PATCH", "DELETE"].includes(request.method ?? "")) {
            const sessionId = decodeURIComponent(sessionMatch[1]);
            const session = sessions.get(sessionId);
            if (!session) {
              json(response, 404, { status: 404, detail: "Không tìm thấy phiên học fixture." });
              return;
            }
            const current = sessionOverrides.get(sessionId) ?? { version: 0 };
            if (request.method === "GET") {
              if (current.removedAt) {
                json(response, 410, { status: 410, detail: "Phiên học này đã được quản trị viên gỡ khỏi lịch sử." });
                return;
              }
              json(response, 200, sessionDto(session, true));
              return;
            }

            const body = await readBody(request);
            if (typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500 ||
              !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0) {
              json(response, 400, { status: 400, detail: "Cần nhập phiên bản và lý do kiểm toán hợp lệ." });
              return;
            }
            if (current.removedAt) {
              json(response, 410, { status: 410, detail: "Phiên học này đã được quản trị viên gỡ khỏi lịch sử." });
              return;
            }
            if (body.expectedVersion !== current.version) {
              json(response, 409, { status: 409, detail: "Phiên học đã được chỉnh sửa. Hãy tải lại rồi thử lại." });
              return;
            }

            if (request.method === "PATCH") {
              if (Object.keys(body).some((key) => !["expectedVersion", "reason", "changes"].includes(key)) ||
                !body.changes || typeof body.changes !== "object" || Array.isArray(body.changes) ||
                Object.keys(body.changes).length === 0 || Object.keys(body.changes).some((key) => !correctionFields.includes(key))) {
                json(response, 400, { status: 400, detail: "Chọn ít nhất một trường cho phép hiệu chỉnh." });
                return;
              }
              const changes = body.changes;
              const textLimits = { goal: [3, 500], topic: [1, 100] };
              for (const [field, [minimum, maximum]] of Object.entries(textLimits)) {
                const value = changes[field];
                if (value !== undefined && value !== null && (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum)) {
                  json(response, 400, { status: 400, detail: `${field} không hợp lệ.` });
                  return;
                }
              }
              const numericLimits = {
                targetSeconds: [60, 14400, true], elapsedSeconds: [0, 32400, false],
                actualStudySeconds: [0, 14400, false], focusedSeconds: [0, 14400, false],
                actualBreakSeconds: [0, 32400, false], distractions: [0, 10000, true],
              };
              for (const [field, [minimum, maximum, integer]] of Object.entries(numericLimits)) {
                const value = changes[field];
                if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value)))) {
                  json(response, 400, { status: 400, detail: `${field} không hợp lệ.` });
                  return;
                }
              }
              const quizResult = changes.quizResult;
              if (quizResult !== undefined && quizResult !== null && (!quizResult || typeof quizResult !== "object" || Array.isArray(quizResult) ||
                Object.keys(quizResult).some((key) => !["score", "total"].includes(key)) || !Number.isInteger(quizResult.score) ||
                !Number.isInteger(quizResult.total) || quizResult.score < 0 || quizResult.score > 1000 || quizResult.total < 1 ||
                quizResult.total > 1000 || quizResult.score > quizResult.total)) {
                json(response, 400, { status: 400, detail: "Kết quả quiz không hợp lệ." });
                return;
              }

              const beforeVersion = current.version;
              const before = sessionAuditState(session, current);
              const next = { ...current, version: beforeVersion + 1 };
              for (const field of ["goal", "topic", ...Object.keys(numericLimits)]) {
                if (changes[field] === null) delete next[field];
                else if (changes[field] !== undefined) next[field] = field === "goal" || field === "topic" ? changes[field].trim() : changes[field];
              }
              if (changes.quizResult === null) delete next.quizResult;
              else if (changes.quizResult !== undefined) next.quizResult = changes.quizResult;
              const nextDto = sessionDto(session, true, next);
              const metrics = nextDto.metrics;
              if (session.measuredMetrics.quizScore !== null && nextDto.topic !== session.topic) {
                json(response, 422, { status: 422, detail: "Không thể đổi chủ đề sau khi phiên học đã được chấm quiz." });
                return;
              }
              if (metrics.actualStudySeconds < 0 || metrics.actualStudySeconds > metrics.targetSeconds ||
                metrics.focusedSeconds < 0 || metrics.focusedSeconds > metrics.actualStudySeconds ||
                metrics.actualBreakSeconds < 0 || metrics.elapsedSeconds < metrics.actualStudySeconds + metrics.actualBreakSeconds ||
                metrics.distractions < 0 || (metrics.quizScore === null) !== (metrics.quizTotal === null) ||
                (metrics.quizScore !== null && metrics.quizTotal !== null && metrics.quizScore > metrics.quizTotal)) {
                json(response, 422, { status: 422, detail: "Các chỉ số hiệu chỉnh không tạo thành một phiên học hợp lệ." });
                return;
              }
              sessionOverrides.set(sessionId, next);
              auditSessionMutation(session, "correction", beforeVersion, next.version, before, sessionAuditState(session, next), body.reason);
              json(response, 200, sessionDto(session, true));
              return;
            }

            if (Object.keys(body).some((key) => !["expectedVersion", "reason"].includes(key))) {
              json(response, 400, { status: 400, detail: "Yêu cầu gỡ phiên không hợp lệ." });
              return;
            }
            const beforeVersion = current.version;
            const before = sessionAuditState(session, current);
            const next = { ...current, version: beforeVersion + 1, removedAt: Date.now() };
            sessionOverrides.set(sessionId, next);
            auditSessionMutation(session, "removal", beforeVersion, next.version, before, {
              status: "removed", correctionVersion: next.version,
            }, body.reason);
            json(response, 200, {
              id: sessionId, ownerId: session.ownerId, accountId: session.accountId,
              status: "removed", correctionVersion: next.version,
            });
            return;
          }

          if (request.method === "GET" && pathname === "/admin/sessions") {
            const accountId = url.searchParams.get("accountId") ?? undefined;
            const groupId = url.searchParams.get("groupId") ?? undefined;
            const daysQuery = url.searchParams.get("days") ?? "all";
            const durationBasis = url.searchParams.get("durationBasis") ?? undefined;
            const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
            const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get("offset")) || 0));
            if (!["7", "30", "90", "all"].includes(daysQuery) || (durationBasis !== undefined && !["planned", "actual"].includes(durationBasis)) ||
              (accountId && !isUuid(accountId)) || (groupId && !isUuid(groupId))) {
              json(response, 400, { status: 400, detail: "Bộ lọc lịch sử phiên không hợp lệ." });
              return;
            }
            const asOfMs = Date.now();
            const fromMs = daysQuery === "all" ? 0 : asOfMs - Number(daysQuery) * 86400000;
            const matching = [...sessions.values()].filter((session) => {
              const override = sessionOverrides.get(session.id) ?? { version: 0 };
              if (override.removedAt || (accountId && session.accountId !== accountId) || (groupId && session.groupId !== groupId)) return false;
              const started = Date.parse(session.startedAt);
              if (!Number.isFinite(started) || started < fromMs || started > asOfMs) return false;
              if (!durationBasis) return true;
              const metric = projectedSession(session).metrics;
              return (durationBasis === "planned" ? metric.targetSeconds : metric.elapsedSeconds) <= 60;
            }).sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.id.localeCompare(left.id));
            json(response, 200, {
              ...page(matching.map((session) => sessionDto(session)), limit, offset, "sessions"),
              days: daysQuery === "all" ? "all" : Number(daysQuery),
              window: daysQuery === "all" ? "all" : `${daysQuery}d`,
              timezone: "UTC",
              fromUtc: new Date(fromMs).toISOString(),
              asOfUtc: new Date(asOfMs).toISOString(),
              durationBasis: durationBasis ?? null,
              durationThresholdSeconds: durationBasis ? 60 : null,
              truncated: matching.length > 10000 + limit,
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
            const days = url.searchParams.get("days") ?? "7";
            const accountId = url.searchParams.get("accountId") ?? undefined;
            const groupId = url.searchParams.get("groupId") ?? undefined;
            if (!["7", "30", "90"].includes(days) || (accountId && !isUuid(accountId)) || (groupId && !isUuid(groupId)) || (accountId && groupId)) {
              json(response, 400, { status: 400, detail: "Bộ lọc báo cáo không hợp lệ." });
              return;
            }
            json(response, 200, makeReport(Number(days), accountId, groupId));
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
