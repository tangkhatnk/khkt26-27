import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tmpdir } from "node:os";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let ProfilePanel;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(tmpdir(), "viendu-profile-panel-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ ProfilePanel } = await vite.ssrLoadModule("/src/adventure/ProfilePanel.tsx"));
});

after(async () => {
  await vite?.close();
});

const recentStudies = [
  { id: "s-old", goal: "Review photosynthesis", topic: "Biology", studiedAt: Date.UTC(2026, 9, 10), focusedSeconds: 1500 },
  { id: "s-latest", goal: "Ôn cấu trúc tế bào", topic: "Sinh học", studiedAt: Date.UTC(2026, 9, 22), focusedSeconds: 1800 },
  { id: "s-middle", goal: "Practice fractions", topic: "Toán", studiedAt: Date.UTC(2026, 9, 18), focusedSeconds: 900 },
  { id: "s-fourth", goal: "Read about ecosystems", topic: "Sinh học", studiedAt: Date.UTC(2026, 9, 16), focusedSeconds: 1200 },
  { id: "s-fifth", goal: "Review equations", topic: "Toán", studiedAt: Date.UTC(2026, 9, 15), focusedSeconds: 600 },
  { id: "s-excluded", goal: "An older session outside the recent list", topic: "Toán", studiedAt: Date.UTC(2026, 8, 1), focusedSeconds: 600 },
];

const defaultProps = {
  account: { id: "account-abc-123", name: "Linh Nguyễn", email: "linh@example.com" },
  journey: { carriageName: "Toa Mây", stationLabel: "Rừng Sương mù", stationIndex: 1, stationCount: 5 },
  stats: { sessionCount: 6, focusedSeconds: 3660, recentStudies },
  connectionLabel: "Chờ đồng bộ",
  admin: { state: "not-confirmed", canRefresh: true },
  actions: {
    onSync() {},
    syncDisabled: true,
    onLogout() {},
    logoutDisabled: true,
    onExport() {},
    onOpenAdmin() {},
    onRefreshAdmin() {},
  },
};

const renderPanel = (overrides = {}) => renderToStaticMarkup(
  React.createElement(ProfilePanel, { ...defaultProps, ...overrides }),
);

test("profile shows the account's own journey, study totals, and four newest private study goals", () => {
  const markup = renderPanel();

  assert.match(markup, /Linh Nguyễn/u);
  assert.match(markup, /linh@example\.com/u);
  assert.match(markup, /Chờ đồng bộ/u);
  assert.match(markup, /account-abc-123/u);
  assert.match(markup, /Toa Mây/u);
  assert.match(markup, /Rừng Sương mù/u);
  assert.match(markup, /Chặng 2 \/ 5/u);
  assert.match(markup, /Tổng thời gian đã ghi nhận/u);
  assert.match(markup, /1 giờ 1 phút/u);
  assert.match(markup, /Ôn cấu trúc tế bào/u);
  assert.match(markup, /Read about ecosystems/u);
  assert.match(markup, /Practice fractions/u);
  assert.match(markup, /Review equations/u);
  assert.match(markup, /Chỉ hiển thị các chuyến của bạn; tài liệu và ghi chú không đưa vào hồ sơ\./u);
  assert.doesNotMatch(markup, /Mục tiêu học tập chỉ xuất hiện trong hồ sơ của bạn/u);
  assert.doesNotMatch(markup, /Review photosynthesis|An older session outside the recent list/u);
  assert.ok(markup.indexOf("Ôn cấu trúc tế bào") < markup.indexOf("Practice fractions"));
  assert.ok(markup.indexOf("Practice fractions") < markup.indexOf("Read about ecosystems"));
});

test("profile keeps account sync and logout disabled when the parent restrictions require it", () => {
  const markup = renderPanel();

  assert.match(markup, /<button[^>]*disabled=""[^>]*>Đồng bộ tài khoản/u);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Đăng xuất/u);
  assert.match(markup, /Hoàn tất phiên đang chạy trước khi đăng xuất/u);
  assert.match(markup, /Xuất dữ liệu riêng/u);
});

test("confirmed administrators get a clear opener while unconfirmed accounts get server-owned access guidance", () => {
  const available = renderPanel({ admin: { state: "available", canRefresh: true } });
  const unconfirmed = renderPanel({ admin: { state: "not-confirmed", canRefresh: true } });

  assert.match(available, /Quyền quản trị đã được máy chủ xác nhận/u);
  assert.match(available, /Mở khu vực quản trị/u);
  assert.match(unconfirmed, /Quyền quản trị do máy chủ cấp/u);
  assert.match(unconfirmed, /Kiểm tra lại quyền/u);
  assert.match(unconfirmed, /Sao chép mã tài khoản/u);
  assert.doesNotMatch(unconfirmed, /Cấp quyền quản trị|Trở thành quản trị viên/u);
});

test("guest profile keeps the supplied sign-in form and explains how to reach protected admin access", () => {
  const markup = renderPanel({
    account: null,
    admin: { state: "login-required", canRefresh: false },
    authContent: React.createElement("form", { "aria-label": "Đăng nhập" }, "Form đăng nhập"),
  });

  assert.match(markup, /Bạn lữ hành trên thiết bị này/u);
  assert.match(markup, /Form đăng nhập/u);
  assert.match(markup, /Đăng nhập bằng tài khoản được cấp quyền quản trị/u);
  assert.doesNotMatch(markup, /Đồng bộ tài khoản|Đăng xuất|Sao chép mã tài khoản/u);
  assert.doesNotMatch(markup, /Mở khu vực quản trị/u);
  assert.ok(markup.indexOf("Form đăng nhập") < markup.indexOf("Khu vực quản trị"));
});

test("offline admin status asks the learner to reconnect without claiming the account lacks permission", () => {
  const markup = renderPanel({ admin: { state: "offline", canRefresh: false } });

  assert.match(markup, /Kết nối lại máy chủ để kiểm tra quyền quản trị/u);
  assert.doesNotMatch(markup, /chưa được cấp quyền quản trị/u);
});
