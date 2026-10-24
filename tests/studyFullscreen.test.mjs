import assert from "node:assert/strict";
import test from "node:test";
import { createStudyFullscreenController } from "../src/adventure/studyFullscreen.ts";

function fakeDocument() {
  const listeners = new Map();
  return {
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitCalls: 0,
    exitedElements: [],
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    exitFullscreen() {
      this.exitCalls += 1;
      this.exitedElements.push(this.fullscreenElement);
      this.fullscreenElement = null;
      this.dispatch("fullscreenchange");
      return Promise.resolve();
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("request starts synchronously and reports active after fullscreenchange", async () => {
  const doc = fakeDocument();
  let resolveRequest;
  const target = {
    calls: 0,
    requestFullscreen() {
      this.calls += 1;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();

  assert.equal(target.calls, 1);
  assert.equal(controller.status, "pending");
  doc.fullscreenElement = target;
  doc.dispatch("fullscreenchange");
  resolveRequest();
  await nextTurn();

  assert.equal(controller.status, "active");
  assert.equal(controller.isFullscreen, true);
  controller.dispose();
});

test("a rejected fullscreen request leaves the caller free to continue", async () => {
  const doc = fakeDocument();
  const target = { requestFullscreen: () => Promise.reject(new Error("denied")) };
  const controller = createStudyFullscreenController(doc, () => target);

  assert.doesNotThrow(() => controller.request());
  assert.equal(controller.status, "pending");
  await nextTurn();

  assert.equal(controller.status, "failed");
  assert.match(controller.message, /vẫn có thể học/u);
  assert.equal(controller.isFullscreen, false);
  controller.dispose();
});

test("unsupported fullscreen is reported without calling the element", () => {
  const doc = fakeDocument();
  doc.fullscreenEnabled = false;
  const target = { calls: 0, requestFullscreen() { this.calls += 1; } };
  const controller = createStudyFullscreenController(doc, () => target);

  assert.doesNotThrow(() => controller.request());

  assert.equal(target.calls, 0);
  assert.equal(controller.status, "unsupported");
  assert.match(controller.message, /vẫn có thể học/u);
  controller.dispose();
});

test("leaving focus cancels a pending request and exits if it completes late", async () => {
  const doc = fakeDocument();
  let resolveRequest;
  const target = {
    requestFullscreen() {
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();
  controller.leave();
  doc.fullscreenElement = target;
  doc.dispatch("fullscreenchange");
  resolveRequest();
  await nextTurn();

  assert.equal(doc.exitCalls, 1);
  assert.equal(doc.fullscreenElement, null);
  assert.equal(controller.status, "idle");
  controller.dispose();
});

test("leaving focus does not exit a different element's fullscreen", async () => {
  const doc = fakeDocument();
  const other = {};
  const target = {
    requestFullscreen() {
      doc.fullscreenElement = target;
      doc.dispatch("fullscreenchange");
      return Promise.resolve();
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();
  await nextTurn();
  doc.fullscreenElement = other;
  doc.dispatch("fullscreenchange");
  controller.leave();

  assert.equal(doc.exitCalls, 0);
  assert.equal(doc.fullscreenElement, other);
  controller.dispose();
});

test("Escape clears active status and does not automatically request fullscreen again", async () => {
  const doc = fakeDocument();
  const target = {
    calls: 0,
    requestFullscreen() {
      this.calls += 1;
      doc.fullscreenElement = target;
      doc.dispatch("fullscreenchange");
      return Promise.resolve();
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();
  await nextTurn();
  doc.fullscreenElement = null;
  doc.dispatch("fullscreenchange");

  assert.equal(controller.status, "idle");
  assert.equal(target.calls, 1);
  controller.toggle();
  assert.equal(target.calls, 2);
  controller.dispose();
});

test("a focused route alone does not request fullscreen", () => {
  const doc = fakeDocument();
  const target = { calls: 0, requestFullscreen() { this.calls += 1; } };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.setActiveFocus(true);

  assert.equal(target.calls, 0);
  assert.equal(controller.status, "idle");
  controller.dispose();
});

test("dispose releases owned fullscreen and removes its document listener", async () => {
  const doc = fakeDocument();
  const target = {
    requestFullscreen() {
      doc.fullscreenElement = target;
      doc.dispatch("fullscreenchange");
      return Promise.resolve();
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();
  await nextTurn();
  controller.dispose();

  assert.equal(doc.exitCalls, 1);
  assert.equal(doc.listenerCount("fullscreenchange"), 0);
});

test("a stale success cannot replace a newer pending request and owned fullscreen survives its rejection", async () => {
  const doc = fakeDocument();
  let resolveA;
  let rejectB;
  let calls = 0;
  const target = {
    requestFullscreen() {
      calls += 1;
      if (calls === 1)
        return new Promise((resolve) => { resolveA = resolve; });
      return new Promise((_resolve, reject) => { rejectB = reject; });
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();
  controller.leave();
  controller.request();
  assert.equal(controller.status, "pending");

  doc.fullscreenElement = target;
  doc.dispatch("fullscreenchange");
  resolveA();
  await nextTurn();

  assert.equal(controller.status, "pending");
  rejectB(new Error("second request rejected"));
  await nextTurn();

  assert.equal(controller.status, "active");
  assert.equal(controller.isFullscreen, true);
  assert.equal(doc.exitCalls, 0);
  controller.leave();
  await nextTurn();
  assert.equal(doc.exitCalls, 1);
  controller.dispose();
});

test("a stale rejection cannot replace the status of a newer pending request", async () => {
  const doc = fakeDocument();
  let rejectA;
  let resolveB;
  let calls = 0;
  const target = {
    requestFullscreen() {
      calls += 1;
      if (calls === 1)
        return new Promise((_resolve, reject) => { rejectA = reject; });
      return new Promise((resolve) => { resolveB = resolve; });
    },
  };
  const controller = createStudyFullscreenController(doc, () => target);

  controller.request();
  controller.leave();
  controller.request();
  rejectA(new Error("first request rejected"));
  await nextTurn();

  assert.equal(controller.status, "pending");
  doc.fullscreenElement = target;
  doc.dispatch("fullscreenchange");
  resolveB();
  await nextTurn();

  assert.equal(controller.status, "active");
  assert.equal(controller.isFullscreen, true);
  controller.dispose();
});

test("leaving after the target ref changes exits the captured study element", async () => {
  const doc = fakeDocument();
  const originalTarget = {
    requestFullscreen() {
      doc.fullscreenElement = originalTarget;
      doc.dispatch("fullscreenchange");
      return Promise.resolve();
    },
  };
  const replacementTarget = {};
  let currentTarget = originalTarget;
  const controller = createStudyFullscreenController(doc, () => currentTarget);

  controller.request();
  await nextTurn();
  currentTarget = replacementTarget;
  controller.leave();
  await nextTurn();

  assert.equal(doc.exitCalls, 1);
  assert.equal(doc.exitedElements[0], originalTarget);
  assert.equal(doc.fullscreenElement, null);
  controller.dispose();
});

test("a late success after disposal exits the request's captured target", async () => {
  const doc = fakeDocument();
  let resolveRequest;
  const originalTarget = {
    requestFullscreen() {
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  };
  const replacementTarget = {};
  let currentTarget = originalTarget;
  const controller = createStudyFullscreenController(doc, () => currentTarget);

  controller.request();
  controller.dispose();
  currentTarget = replacementTarget;
  doc.fullscreenElement = originalTarget;
  resolveRequest();
  await nextTurn();

  assert.equal(doc.exitCalls, 1);
  assert.equal(doc.exitedElements[0], originalTarget);
  assert.equal(doc.fullscreenElement, null);
});
