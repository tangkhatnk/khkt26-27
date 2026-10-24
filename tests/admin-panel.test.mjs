import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(resolve("src/adventure/AdminPanel.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const panelModule = { exports: {} };
class TestApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const panelRequire = (specifier) => {
  if (specifier === "./admin.css") return {};
  if (specifier === "../services/api") return { ApiError: TestApiError };
  if (specifier === "../services/admin") return {};
  return require(specifier);
};
new Function("require", "module", "exports", compiled)(panelRequire, panelModule, panelModule.exports);
const { AdminOverview } = panelModule.exports;

test("study indicators use actual non-break study time and handle an empty report", () => {
  assert.deepEqual(panelModule.exports.adminStudyIndicators({ actualStudySeconds: 0, focusedSeconds: 0, distractions: 0, sessionCount: 0 }), {
    focusPercent: null, distractionsPerHour: null, averageStudySeconds: null,
  });
  assert.deepEqual(panelModule.exports.adminStudyIndicators({ actualStudySeconds: 3600, focusedSeconds: 2700, distractions: 3, sessionCount: 2 }), {
    focusPercent: 75, distractionsPerHour: 3, averageStudySeconds: 1800,
  });
});

test("session rows from another account, group, period or page never carry over to a new selection", () => {
  const previous = { key: "7:account-a::0", rows: [{ id: "a-private-metrics" }], total: 1 };
  assert.deepEqual(panelModule.exports.adminRowsForKey(previous, previous.key), { rows: previous.rows, total: 1 });
  for (const key of ["7:account-b::0", "7::group-b:0", "30:account-a::0", "7:account-a::25"]) {
    assert.deepEqual(panelModule.exports.adminRowsForKey(previous, key), { rows: [], total: 0 });
  }
});

test("detail reports from another account, group or period never carry over to a new selection", () => {
  const report = { days: 7, totals: { sessionCount: 1 } };
  const previous = { key: "7:account-a::", value: report };
  assert.equal(panelModule.exports.adminReportForKey(previous, previous.key), report);
  for (const key of ["7:account-b::", "7::group-b:", "30:account-a::"]) {
    assert.equal(panelModule.exports.adminReportForKey(previous, key), null);
  }
});

test("AdminOverview presents UTC usage, quiz coverage and topic trends on narrow layouts", () => {
  const report = {
    days: 7,
    timezone: "UTC",
    analysisLimit: 20000,
    fromUtc: "2026-10-15T00:00:00.000Z",
    asOfUtc: "2026-10-21T12:00:00.000Z",
    matchingSessionCount: 1,
    recordsAnalyzed: 1,
    truncated: false,
    totals: {
      sessionCount: 1,
      plannedStudySeconds: 3600,
      actualStudySeconds: 1800,
      focusedSeconds: 1500,
      plannedBreakSeconds: 300,
      actualBreakSeconds: 300,
      distractions: 2,
      completedSessions: 0,
      completionPercent: 0,
      gradedQuizSessions: 1,
      quizCoveragePercent: 100,
      quizScore: 3,
      quizTotal: 5,
      quizScorePercent: 60,
    },
    daily: [{
      dateUtc: "2026-10-21",
      sessionCount: 1,
      plannedStudySeconds: 3600,
      actualStudySeconds: 1800,
      focusedSeconds: 1500,
      plannedBreakSeconds: 300,
      actualBreakSeconds: 300,
      distractions: 2,
      completedSessions: 0,
      completionPercent: 0,
      gradedQuizSessions: 1,
      quizCoveragePercent: 100,
      quizScore: 3,
      quizTotal: 5,
      quizScorePercent: 60,
    }],
    topics: [{
      topic: "biology",
      sessionCount: 1,
      plannedStudySeconds: 3600,
      actualStudySeconds: 1800,
      focusedSeconds: 1500,
      plannedBreakSeconds: 300,
      actualBreakSeconds: 300,
      distractions: 2,
      completedSessions: 0,
      completionPercent: 0,
      gradedQuizSessions: 1,
      quizCoveragePercent: 100,
      quizScore: 3,
      quizTotal: 5,
      quizScorePercent: 60,
    }],
  };
  const html = renderToStaticMarkup(React.createElement(AdminOverview, { report, scopeLabel: "Tài khoản: Learner" }));

  assert.match(html, /UTC/);
  assert.match(html, /Tài khoản: Learner/);
  assert.match(html, /Độ phủ quiz/);
  assert.match(html, /giới hạn phân tích 20\.000 phiên/);
  assert.match(html, /biology/);
  assert.match(html, /30 phút/);
  assert.match(html, /admin-overview-scroll/);
  assert.match(html, /Số phiên mỗi ngày/);
  assert.match(html, /Hoàn tất \/ phiên/);
  assert.match(html, /Điểm quiz theo ngày/);
  assert.match(html, /So sánh chủ đề/);
  assert.match(html, /phiên có quiz đã chấm/);
});

test("AdminPanel keeps the existing overview, account and group reporting tabs", () => {
  const html = renderToStaticMarkup(React.createElement(panelModule.exports.AdminPanel, {
    currentUserId: "00000000-0000-4000-8000-000000000999",
  }));

  assert.match(html, /Báo cáo quản trị/);
  assert.match(html, /Tổng quan/);
  assert.match(html, /Tài khoản/);
  assert.match(html, /Nhóm học/);
  assert.match(html, /Tải CSV tổng hợp/);
});

test("account governance blocks self and bootstrap targets and requires a nonblank audit reason", () => {
  const account = {
    id: "00000000-0000-4000-8000-000000000042",
    email: "learner@example.invalid",
    name: "Learner",
    createdAt: "2026-10-21T00:00:00.000Z",
    isAdmin: false,
    adminSource: null,
    status: "active",
    suspendedAt: null,
    adminStateVersion: 4,
  };

  assert.match(panelModule.exports.adminAccountMutationBlockReason(account, account.id), /đang đăng nhập/i);
  assert.match(panelModule.exports.adminAccountMutationBlockReason({ ...account, adminSource: "bootstrap" }, "admin-id"), /bootstrap/i);
  assert.equal(panelModule.exports.adminAccountMutationBlockReason(account, "admin-id"), "");
  assert.match(panelModule.exports.adminAccountMutationBlockReason(account, "admin-id", { kind: "role", value: false }), /trạng thái quyền/i);
  assert.equal(panelModule.exports.isAdminReasonValid("   \n "), false);
  assert.equal(panelModule.exports.isAdminReasonValid(" Đã xác nhận yêu cầu "), true);
});

test("account governance shows UUID, role source, status and version while disabling bootstrap actions", () => {
  const account = {
    id: "00000000-0000-4000-8000-000000000042",
    email: "bootstrap@example.invalid",
    name: "Bootstrap admin",
    createdAt: "2026-10-21T00:00:00.000Z",
    isAdmin: true,
    adminSource: "bootstrap",
    status: "suspended",
    suspendedAt: "2026-10-21T12:00:00.000Z",
    adminStateVersion: 7,
  };
  const html = renderToStaticMarkup(React.createElement(panelModule.exports.AdminAccountGovernance, {
    account,
    currentUserId: "admin-id",
    onChangeRequested() {},
  }));

  assert.match(html, /00000000-0000-4000-8000-000000000042/);
  assert.match(html, /Bootstrap máy chủ/);
  assert.match(html, /Đang tạm ngưng/);
  assert.match(html, />7</);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
  const selfHtml = renderToStaticMarkup(React.createElement(panelModule.exports.AdminAccountGovernance, {
    account: { ...account, adminSource: "persistent", status: "active", suspendedAt: null },
    currentUserId: account.id,
    onChangeRequested() {},
  }));
  assert.match(selfHtml, /Không thể thay đổi tài khoản đang đăng nhập/);
  assert.equal((selfHtml.match(/disabled=""/g) ?? []).length, 4);
});

test("mutation confirmation identifies the target and warns against learner content in reasons", () => {
  const account = {
    id: "00000000-0000-4000-8000-000000000042",
    email: "learner@example.invalid",
    name: "Learner",
    createdAt: "2026-10-21T00:00:00.000Z",
    isAdmin: false,
    adminSource: null,
    status: "active",
    suspendedAt: null,
    adminStateVersion: 4,
  };
  const html = renderToStaticMarkup(React.createElement(panelModule.exports.AdminMutationConfirmation, {
    account,
    currentUserId: "00000000-0000-4000-8000-000000000099",
    action: { kind: "role", value: true },
    busy: false,
    error: "",
    onCancel() {},
    onConfirm() {},
  }));

  assert.match(html, /role="dialog"/);
  assert.match(html, /learner@example\.invalid/);
  assert.match(html, /cấp quyền quản trị/i);
  assert.match(html, /phiên bản hiện tại: <strong>4<\/strong>/i);
  assert.match(html, /không ghi nội dung học tập.*mục tiêu riêng.*tài liệu.*câu trả lời quiz/i);
  assert.match(html, /<textarea[^>]*required/);
  assert.match(html, /disabled=""/);
});

test("account audit renders the actor, state transition, reason and pagination", () => {
  const html = renderToStaticMarkup(React.createElement(panelModule.exports.AdminAuditView, {
    actions: [{
      actorId: "00000000-0000-4000-8000-000000000099",
      targetId: "00000000-0000-4000-8000-000000000042",
      action: "role",
      before: { isAdmin: false, suspended: false, version: 3 },
      after: { isAdmin: true, suspended: false, version: 4 },
      reason: "Đã xác nhận yêu cầu quản trị.",
      createdAt: "2026-10-21T12:30:00.000Z",
    }],
    loading: false,
    error: "",
    total: 30,
    offset: 25,
    onOffsetChange() {},
    onRetry() {},
  }));

  assert.match(html, /Nhật ký thay đổi/);
  assert.match(html, /00000000-0000-4000-8000-000000000099/);
  assert.match(html, /Không quản trị → Quản trị/);
  assert.match(html, /Đã xác nhận yêu cầu quản trị\./);
  assert.match(html, /2026-10-21 12:30 UTC/);
  assert.match(html, /26–30/);
  assert.match(html, /Tiếp/);
});

test("admin mutation errors distinguish invalid reasons, missing targets, stale versions, and access revocation", () => {
  assert.match(panelModule.exports.adminMutationProblem(new TestApiError(400, "Lý do không hợp lệ.")), /Thông tin thay đổi chưa hợp lệ/);
  assert.match(panelModule.exports.adminMutationProblem(new TestApiError(404, "missing")), /Không còn tìm thấy tài khoản/);
  assert.match(panelModule.exports.adminMutationProblem(new TestApiError(409, "version stale")), /version stale/);
  assert.equal(panelModule.exports.isAdminAccessDenied(new TestApiError(401, "expired")), true);
  assert.equal(panelModule.exports.isAdminAccessDenied(new TestApiError(403, "revoked")), true);
  assert.equal(panelModule.exports.isAdminAccessDenied(new TestApiError(409, "stale")), false);
});

test("deleted account controls allow recovery while blocking other edits", () => {
  const account = { id: "synthetic-target", name: "Người học", email: "learner@example.invalid",
    createdAt: "2026-10-21T00:00:00Z", isAdmin: false, adminSource: null, status: "deleted",
    suspendedAt: null, deletedAt: "2026-10-22T00:00:00Z", adminStateVersion: 8 };
  for (const action of [{ kind: "profile" }, { kind: "role", value: true }, { kind: "suspension", value: true }])
    assert.match(panelModule.exports.adminAccountMutationBlockReason(account, "actor", action), /đã xóa/i);
  assert.equal(panelModule.exports.adminAccountMutationBlockReason(account, "actor", { kind: "deletion", value: false }), "");
  const html = renderToStaticMarkup(React.createElement(panelModule.exports.AdminAccountGovernance, {
    account, currentUserId: "actor", onChangeRequested() {},
  }));
  assert.match(html, /Đã xóa/);
  assert.match(html, /Khôi phục tài khoản đã xóa/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3);
});

test("profile editing validates a display name and deletion confirmation explains recovery", () => {
  assert.equal(panelModule.exports.isAdminNameValid("   "), false);
  assert.equal(panelModule.exports.isAdminNameValid(" Tên hiển thị mới "), true);
  assert.equal(panelModule.exports.isAdminNameValid("a".repeat(101)), false);
  const account = { id: "synthetic-target", name: "Người học", email: "learner@example.invalid",
    createdAt: "2026-10-21T00:00:00Z", isAdmin: true, adminSource: "persistent", status: "active",
    suspendedAt: null, deletedAt: null, adminStateVersion: 8 };
  const props = { account, currentUserId: "actor", busy: false, error: "", onCancel() {}, onConfirm() {} };
  const profile = renderToStaticMarkup(React.createElement(panelModule.exports.AdminMutationConfirmation, { ...props, action: { kind: "profile" } }));
  assert.match(profile, /Tên hiển thị mới/);
  assert.match(profile, /maxlength="100"/i);
  const deletion = renderToStaticMarkup(React.createElement(panelModule.exports.AdminMutationConfirmation, { ...props, action: { kind: "deletion", value: true } }));
  assert.match(deletion, /giữ lại dữ liệu học/i);
  assert.match(deletion, /thu hồi quyền quản trị/i);
  assert.match(deletion, /đăng nhập/i);
});
