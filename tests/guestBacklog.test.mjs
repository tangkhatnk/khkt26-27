import assert from "node:assert/strict";
import test from "node:test";
import { syncGuestBacklog } from "../src/adventure/guestBacklog.ts";

const guest = () => ({
  local: { sessions: { one: { id: "one", userId: "guest" } } },
  pending: [], snapshot: null, quizDrafts: {}, removedSessionIds: [],
  guestPublished: [], notes: { one: "private note" },
});

test("account-side retry writes only guest markers and releases the lock during upload", async () => {
  let saved = guest(), locked = false;
  const account = { notes: "account data", pending: ["account-trip"] };
  await syncGuestBacklog({
    withGuestLock: async action => {
      assert.equal(locked, false); locked = true;
      try { return action(); } finally { locked = false; }
    },
    read: () => saved, write: value => { saved = value; }, isCurrent: () => true,
    send: async () => {
      assert.equal(locked, false);
      saved = { ...saved, notes: { one: "newer private note" } };
      return { tripCode: "V-ONE" };
    },
  });
  assert.deepEqual(saved.guestPublished, ["one"]);
  assert.equal(saved.notes.one, "newer private note");
  assert.deepEqual(account, { notes: "account data", pending: ["account-trip"] });
});

test("a guest workspace holding its lock prevents background reads and uploads", async () => {
  let sent = false;
  await syncGuestBacklog({
    withGuestLock: async () => undefined,
    read: () => { throw new Error("must not read without a lock"); },
    write: () => { throw new Error("must not write without a lock"); },
    isCurrent: () => true, send: async () => { sent = true; return { tripCode: "V-ONE" }; },
  });
  assert.equal(sent, false);
});

test("guest takeover during upload leaves the marker retryable without touching active storage", async () => {
  let saved = guest(), guestActive = false, requests = 0;
  const dependencies = {
    withGuestLock: async action => guestActive ? undefined : action(),
    read: () => saved, write: value => { saved = value; }, isCurrent: () => true,
    send: async () => { requests++; guestActive = true; return { tripCode: "V-ONE" }; },
  };
  await syncGuestBacklog(dependencies);
  assert.deepEqual(saved.guestPublished, []);
  assert.equal(requests, 1);
  guestActive = false;
  await syncGuestBacklog({ ...dependencies, send: async () => { requests++; return { tripCode: "V-ONE" }; } });
  assert.deepEqual(saved.guestPublished, ["one"]);
  assert.equal(requests, 2);
});

test("account change while publishing cancels the old context before writing markers", async () => {
  let saved = guest(), active = true;
  await syncGuestBacklog({
    withGuestLock: async action => action(), read: () => saved,
    write: value => { saved = value; }, isCurrent: () => active,
    send: async () => { active = false; return { tripCode: "V-ONE" }; },
  });
  assert.deepEqual(saved.guestPublished, []);
});

test("a guest 410 persists tombstone suppression separately from acknowledged publication", async () => {
  let saved = guest(), sent = 0;
  saved.notes.one = "keep this private note";
  saved.sources = { one: [{ id: "source-one", text: "keep source" }] };
  saved.materials = { one: [{ name: "Trip.pdf", size: 10, type: "application/pdf", status: "saved", message: "Local" }] };
  const dependencies = {
    withGuestLock: async action => action(),
    read: () => saved,
    write: value => { saved = value; },
    isCurrent: () => true,
    send: async () => {
      sent++;
      throw Object.assign(new Error("Phiên học đã được gỡ khỏi lịch sử."), { status: 410 });
    },
  };

  await syncGuestBacklog(dependencies);
  assert.deepEqual(saved.removedSessionIds, ["one"]);
  assert.equal(saved.local.sessions.one, undefined);
  await syncGuestBacklog(dependencies);

  assert.equal(sent, 1);
  assert.deepEqual(saved.removedSessionIds, ["one"]);
  assert.deepEqual(saved.guestPublished, []);
  assert.equal(saved.local.sessions.one, undefined);
  assert.equal(saved.notes.one, "keep this private note");
  assert.equal(saved.sources.one[0].text, "keep source");
  assert.equal(saved.materials.one[0].name, "Trip.pdf");
});
