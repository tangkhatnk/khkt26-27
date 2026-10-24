import assert from "node:assert/strict";
import test from "node:test";
import { publishGuestSessions } from "../src/adventure/guestPublication.ts";

const sessions = [
  { id: "trip-1", goal: "Read biology" },
  { id: "trip-2", goal: "Review physics" },
];

test("publishes only unmarked guest sessions and commits after acknowledgement", async () => {
  const events = [];
  const statuses = [];

  await publishGuestSessions({
    sessions,
    publishedIds: ["trip-1"],
    isCurrent: () => true,
    send: async (session) => {
      events.push(["send", session.id]);
      return { tripCode: "V-ABC" };
    },
    markPublished: async (sessionId, acknowledgement) => {
      events.push(["commit", sessionId, acknowledgement.tripCode]);
      return true;
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(events, [
    ["send", "trip-2"],
    ["commit", "trip-2", "V-ABC"],
  ]);
  assert.deepEqual(statuses.map(({ status }) => status), ["sending", "published"]);
});

test("failed publication remains unmarked and can retry idempotently", async () => {
  const durableIds = [];
  const statuses = [];
  let attempts = 0;
  let commitCount = 0;
  const dependencies = {
    sessions: [sessions[0]],
    isCurrent: () => true,
    send: async (session) => {
      attempts += 1;
      if (attempts === 1) throw new Error("network unavailable");
      return { tripCode: `V-${session.id}` };
    },
    markPublished: async (sessionId) => {
      commitCount += 1;
      durableIds.push(sessionId);
      return true;
    },
    onStatus: (status) => statuses.push(status),
  };

  await publishGuestSessions({ ...dependencies, publishedIds: durableIds });
  assert.deepEqual(durableIds, []);
  assert.equal(statuses.at(-1).status, "failed");

  await publishGuestSessions({ ...dependencies, publishedIds: durableIds });
  await publishGuestSessions({ ...dependencies, publishedIds: durableIds });

  assert.equal(attempts, 2);
  assert.equal(commitCount, 1);
  assert.deepEqual(durableIds, ["trip-1"]);
  assert.equal(statuses.at(-1).status, "published");
});

test("a save failure after acknowledgement stays retryable", async () => {
  const events = [];
  const statuses = [];

  await publishGuestSessions({
    sessions: [sessions[0]],
    publishedIds: [],
    isCurrent: () => true,
    send: async () => {
      events.push("acknowledged");
      return { tripCode: "V-ABC" };
    },
    markPublished: async () => {
      events.push("commit-failed");
      return false;
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.deepEqual(events, ["acknowledged", "commit-failed"]);
  assert.equal(statuses.at(-1).status, "save-failed");
});

test("owner switch during a request prevents a stale publication marker", async () => {
  let owner = "guest";
  let marked = false;
  const statuses = [];

  await publishGuestSessions({
    sessions: [sessions[0]],
    publishedIds: [],
    isCurrent: () => owner === "guest",
    send: async () => {
      owner = "account-7";
      return { tripCode: "V-ABC" };
    },
    markPublished: async () => {
      marked = true;
      return true;
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(marked, false);
  assert.deepEqual(statuses.map(({ status }) => status), ["sending"]);
});

test("owner switch after one commit prevents sending later sessions", async () => {
  let owner = "guest";
  const sent = [];
  const marked = [];

  await publishGuestSessions({
    sessions,
    publishedIds: [],
    isCurrent: () => owner === "guest",
    send: async (session) => {
      sent.push(session.id);
      return { tripCode: `V-${session.id}` };
    },
    markPublished: async (sessionId) => {
      marked.push(sessionId);
      owner = "account-7";
      return true;
    },
    onStatus() {},
  });

  assert.deepEqual(sent, ["trip-1"]);
  assert.deepEqual(marked, ["trip-1"]);
});

test("a permanently invalid older trip does not block later valid trips", async () => {
  const sent = [], marked = [], statuses = [];
  await publishGuestSessions({
    sessions, publishedIds: [], isCurrent: () => true,
    send: async session => {
      sent.push(session.id);
      if (session.id === "trip-1") throw Object.assign(new Error("expired"), { status: 400 });
      return { tripCode: "V-SECOND" };
    },
    continueAfterFailure: error => error.status === 400,
    markPublished: id => { marked.push(id); return true; },
    onStatus: status => statuses.push(status),
  });
  assert.deepEqual(sent, ["trip-1", "trip-2"]);
  assert.deepEqual(marked, ["trip-2"]);
  assert.equal(statuses[1].status, "failed");
  assert.equal(statuses.at(-1).status, "published");
});
