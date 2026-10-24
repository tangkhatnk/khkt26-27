import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function client(getAccessToken, request = async () => ({})) {
  const source = readFileSync(new URL("../src/services/admin.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)(() => ({ API_URL: "https://api.example.invalid", ApiError, getAccessToken, request }), mod, mod.exports);
  return mod.exports;
}

test("a cancelled admin export sends no request and an in-flight export follows its cancellation signal", async () => {
  const api = client(async () => "test-token");
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; throw new Error("Must not fetch"); };
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(api.exportAdminReport(7, cancelled.signal), { name: "AbortError" });
  assert.equal(fetched, false);

  let started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
    started();
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const controller = new AbortController();
  const pending = api.exportAdminReport(30, controller.signal);
  await requestStarted;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("an account-token change prevents returning a downloaded admin report", async () => {
  let reads = 0;
  const api = client(async () => ++reads === 1 ? "old-test-token" : "new-test-token");
  globalThis.fetch = async () => new Response("private aggregate", { status: 200 });
  await assert.rejects(api.exportAdminReport(7), error => error.status === 409);
});

test("CSV export carries authorization and honors only a safe attachment filename", async () => {
  const api = client(async () => "test-token");
  globalThis.fetch = async (url, init) => {
    assert.match(url, /days=90$/);
    assert.equal(init.headers.Authorization, "Bearer test-token");
    assert.equal(init.cache, "no-store");
    return new Response("summary,12", { headers: { "Content-Disposition": 'attachment; filename="report-UTC.csv"' } });
  };
  const file = await api.exportAdminReport(90);
  assert.equal(file.filename, "report-UTC.csv");
  assert.equal(await file.blob.text(), "summary,12");
  globalThis.fetch = async () => new Response("csv", { headers: { "Content-Disposition": 'attachment; filename="../../report.csv"' } });
  assert.equal((await api.exportAdminReport(7)).filename, "viendu-admin-report-7d-UTC.csv");
});

test("scoped report and CSV requests carry the selected account or group filter", async () => {
  const groupId = "10f86082-c8de-4d40-b181-fca17806fcf3";
  const requests = [];
  const api = client(async () => "test-token", async (url) => { requests.push(url); return {}; });

  await api.fetchAdminReport(30, undefined, { groupId });
  globalThis.fetch = async (url) => {
    requests.push(url);
    return new Response("scoped aggregate");
  };
  await api.exportAdminReport(30, undefined, { groupId });

  assert.equal(requests.length, 2);
  for (const value of requests) {
    const url = new URL(value, "https://api.example.invalid");
    assert.equal(url.searchParams.get("days"), "30");
    assert.equal(url.searchParams.get("groupId"), groupId);
    assert.equal(url.searchParams.has("accountId"), false);
  }
});

test("admin account search preserves an exact UUID and pagination in the request", async () => {
  const id = "00000000-0000-4000-8000-000000000042";
  const requests = [];
  const api = client(async () => "test-token", async (url, init) => {
    requests.push({ url, init });
    return { users: [], total: 0, limit: 25, offset: 25 };
  });
  const controller = new AbortController();

  await api.fetchAdminAccounts(id, 25, 25, controller.signal);

  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url, "https://api.example.invalid");
  assert.equal(url.pathname, "/admin/accounts");
  assert.equal(url.searchParams.get("q"), id);
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("offset"), "25");
  assert.equal(requests[0].init.signal, controller.signal);
});

test("admin role, suspension and audit requests use the frozen account-management contract", async () => {
  const targetId = "00000000-0000-4000-8000-000000000042";
  const requests = [];
  const api = client(async () => "test-token", async (url, init) => {
    requests.push({ url, init });
    return {};
  });
  const controller = new AbortController();

  await api.updateAdminAccountRole(targetId, {
    isAdmin: true,
    expectedVersion: 4,
    reason: "Đã xác nhận yêu cầu quản trị.",
  });
  await api.updateAdminAccountSuspension(targetId, {
    suspended: true,
    expectedVersion: 4,
    reason: "Vi phạm điều khoản sử dụng.",
  });
  await api.fetchAdminAudit(targetId, 25, 50, controller.signal);

  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, `/admin/accounts/${targetId}/role`);
  assert.equal(requests[0].init.method, "PUT");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    isAdmin: true,
    expectedVersion: 4,
    reason: "Đã xác nhận yêu cầu quản trị.",
  });
  assert.equal(requests[1].url, `/admin/accounts/${targetId}/suspension`);
  assert.equal(requests[1].init.method, "PUT");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    suspended: true,
    expectedVersion: 4,
    reason: "Vi phạm điều khoản sử dụng.",
  });
  const auditUrl = new URL(requests[2].url, "https://api.example.invalid");
  assert.equal(auditUrl.pathname, "/admin/audit");
  assert.equal(auditUrl.searchParams.get("targetId"), targetId);
  assert.equal(auditUrl.searchParams.get("limit"), "25");
  assert.equal(auditUrl.searchParams.get("offset"), "50");
  assert.equal(requests[2].init.signal, controller.signal);
  assert.equal(requests[2].init.cache, "no-store");
});

test("admin profile and recoverable deletion requests carry expected versions and reasons", async () => {
  const requests = [];
  const api = client(async () => "test-token", async (url, init) => { requests.push({ url, init }); return {}; });
  const target = "00000000-0000-4000-8000-000000000042";
  await api.updateAdminAccountProfile(target, { name: "Tên mới", expectedName: "Tên trước", expectedVersion: 8, reason: "Sửa tên theo yêu cầu." });
  await api.updateAdminAccountDeletion(target, { deleted: true, expectedVersion: 9, reason: "Xóa có thể khôi phục." });
  assert.equal(requests[0].url, `/admin/accounts/${target}/profile`);
  assert.deepEqual(JSON.parse(requests[0].init.body), { name: "Tên mới", expectedName: "Tên trước", expectedVersion: 8, reason: "Sửa tên theo yêu cầu." });
  assert.equal(requests[1].url, `/admin/accounts/${target}/deletion`);
  assert.deepEqual(JSON.parse(requests[1].init.body), { deleted: true, expectedVersion: 9, reason: "Xóa có thể khôi phục." });
  for (const { init } of requests) { assert.equal(init.method, "PUT"); assert.equal(init.cache, "no-store"); }
});
