import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import * as journalModule from "../src/adventure/studyJournal.ts";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function source(id, startedAt, overrides = {}) {
  return {
    id,
    startedAt,
    goal: `Ôn tập ${id}`,
    topic: "Sinh học",
    focusedSeconds: 900,
    quizResult: { origin: "none" },
    corrected: false,
    ...overrides,
  };
}

function session(id, changes = {}) {
  return {
    id,
    userId: "guest",
    groupId: null,
    goal: `Mục tiêu ${id}`,
    topic: "biology",
    started: 1_000,
    ended: 61_000,
    target: 60,
    segments: [],
    seconds: 30,
    contribution: 30,
    rules: "rules",
    ...changes,
  };
}

test("journal source projection keeps owner scope and distinct private, curated, legacy, corrected, and effective values", () => {
  const rows = [
    session("private", { effectiveMetrics: { focusedSeconds: 41.75 } }),
    session("curated"),
    session("legacy", { quiz: { score: 1, total: 2 } }),
    session("corrected", {
      quiz: { score: 1, total: 2 },
      effectiveMetrics: { focusedSeconds: 28.5, quizScore: 2, quizTotal: 2 },
      correctionFlags: { quizResult: true },
    }),
    session("other-owner", { userId: "account-b" }),
  ];
  const projected = journalModule.buildStudyJournalSources({
    ownerId: "guest",
    sessions: rows,
    learningPath: { completed: [{ sessionId: "curated", score: 3, total: 4 }] },
    quizDrafts: {
      private: { count: 3, questions: [], answers: {}, guestQuizId: "deck-private", guestGrade: { score: 2, total: 3 } },
    },
    topicLabel: (id) => id === "biology" ? "Sinh học" : id,
  });

  assert.deepEqual(projected.map((item) => item.id), ["private", "curated", "legacy", "corrected"]);
  assert.equal(projected[0].focusedSeconds, 41.75);
  assert.equal(projected[0].topic, "Sinh học");
  assert.deepEqual(projected[0].quizResult, { origin: "guest-ai", correct: 2, total: 3 });
  assert.deepEqual(projected[1].quizResult, { origin: "curated", correct: 3, total: 4 });
  assert.deepEqual(projected[2].quizResult, { origin: "legacy-session", correct: 1, total: 2 });
  assert.deepEqual(projected[3].quizResult, { origin: "legacy-session", correct: 2, total: 2 });
  assert.equal(projected[3].corrected, true);
  assert.equal(Object.keys(projected[0]).some((key) => /source|material|notes/i.test(key)), false);
});

test("account journal projection never exposes guest-private grades", () => {
  const projected = journalModule.buildStudyJournalSources({
    ownerId: "account-a",
    sessions: [session("private", { userId: "account-a" })],
    learningPath: { completed: [] },
    quizDrafts: {
      private: { count: 3, questions: [], answers: {}, guestQuizId: "deck-private", guestGrade: { score: 2, total: 3 } },
    },
    topicLabel: (id) => id,
  });
  assert.deepEqual(projected[0].quizResult, { origin: "none" });
});

test("buildStudyJournalEntries keeps one, odd, and even entry counts and sorts newest first", () => {
  const oldest = source("oldest", 1);
  const middle = source("middle", 2);
  const newest = source("newest", 3);
  const fourth = source("fourth", 4);

  assert.deepEqual(journalModule.buildStudyJournalEntries([oldest]).map((entry) => entry.id), ["oldest"]);
  assert.deepEqual(journalModule.buildStudyJournalEntries([oldest, middle, newest]).map((entry) => entry.id), ["newest", "middle", "oldest"]);
  assert.deepEqual(journalModule.buildStudyJournalEntries([oldest, middle, newest, fourth]).map((entry) => entry.id), ["fourth", "newest", "middle", "oldest"]);
});

test("journal goal summaries are bounded by Unicode code points and do not carry full details", () => {
  const goal = "Ôn tập tế bào và di truyền học ".repeat(20);
  const [entry] = journalModule.buildStudyJournalEntries([source("long-goal", 1, { goal })]);

  assert.ok(Array.from(entry.summary).length <= 220);
  assert.match(entry.summary, /Ôn tập tế bào/u);
  assert.equal("goal" in entry, false);
  assert.equal("sourceText" in entry, false);
});

test("sub-minute focus is shown in seconds rather than zero minutes", () => {
  assert.equal(journalModule.formatStudyJournalDuration(0), "0 giây");
  assert.equal(journalModule.formatStudyJournalDuration(59), "59 giây");
  assert.equal(journalModule.formatStudyJournalDuration(60), "1 phút");
  assert.equal(journalModule.formatStudyJournalDuration(65), "1 phút 5 giây");
});

test("typed quiz results keep source labels, valid scores, and correction state", () => {
  const [guest, curated, legacy, invalid, empty] = journalModule.buildStudyJournalEntries([
    source("guest", 5, { quizResult: { origin: "guest-ai", correct: 2, total: 3 }, corrected: true }),
    source("curated", 4, { quizResult: { origin: "curated", correct: 4, total: 4 } }),
    source("legacy", 3, { quizResult: { origin: "legacy-session", correct: 1, total: 2 } }),
    source("invalid", 2, { quizResult: { origin: "guest-ai", correct: 3, total: 2 } }),
    source("empty", 1),
  ]);

  assert.deepEqual(guest.quizResult, { origin: "guest-ai", label: "Quiz AI", correct: 2, total: 3 });
  assert.deepEqual(curated.quizResult, { origin: "curated", label: "Quiz lộ trình", correct: 4, total: 4 });
  assert.deepEqual(legacy.quizResult, { origin: "legacy-session", label: "Quiz", correct: 1, total: 2 });
  assert.equal(guest.corrected, true);
  assert.deepEqual(invalid.quizResult, { origin: "none", label: "Chưa có quiz" });
  assert.deepEqual(empty.quizResult, { origin: "none", label: "Chưa có quiz" });
});

test("single pages and desktop spreads clamp navigation for one, odd, and even counts", () => {
  const position = journalModule.getStudyJournalPagePosition;
  const move = journalModule.moveStudyJournalPage;
  assert.deepEqual(position(1, 0, "spread"), { currentIndex: 0, visibleIndexes: [0], previousDisabled: true, nextDisabled: true });
  assert.deepEqual(position(3, 2, "spread"), { currentIndex: 2, visibleIndexes: [2], previousDisabled: false, nextDisabled: true });
  assert.deepEqual(position(4, 3, "spread"), { currentIndex: 3, visibleIndexes: [2, 3], previousDisabled: false, nextDisabled: true });
  assert.deepEqual(position(3, 99, "single"), { currentIndex: 2, visibleIndexes: [2], previousDisabled: false, nextDisabled: true });
  assert.equal(move(0, 1, "spread", 1), 0);
  assert.equal(move(0, 4, "spread", 1), 2);
  assert.equal(move(2, 4, "spread", 1), 2);
  assert.equal(move(0, 3, "single", 1), 1);
  assert.equal(move(2, 3, "single", 1), 2);
});

let vite;
let React;
let renderToStaticMarkup;
let StudyJournal;

before(async () => {
  const [{ default: ReactModule }, { createServer }, { renderToStaticMarkup: render }] = await Promise.all([
    import("react"), import("vite"), import("react-dom/server"),
  ]);
  React = ReactModule;
  renderToStaticMarkup = render;
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve("/tmp", "viendu-study-journal-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    ({ StudyJournal } = await vite.ssrLoadModule("/src/adventure/StudyJournal.tsx"));
  } catch (error) {
    if (error?.code === "ERR_LOAD_URL" && error.message.includes("StudyJournal.tsx")) return;
    throw error;
  }
});

after(async () => {
  await vite?.close();
});

const renderJournal = (entries, onOpenSession = () => {}) => {
  assert.equal(typeof StudyJournal, "function", "StudyJournal should load with the local Vite test runtime");
  return renderToStaticMarkup(React.createElement(StudyJournal, { entries, onOpenSession }));
};

test("StudyJournal exports its session-detail callback surface", () => {
  assert.equal(typeof StudyJournal, "function");
});

test("empty journal has a clear start state without fake pages", () => {
  const markup = renderJournal([]);
  assert.match(markup, /Nhật ký học tập/u);
  assert.match(markup, /Nhật ký sẽ lưu lại những phiên học đã kết thúc/u);
  assert.doesNotMatch(markup, /Trang trước|Trang sau/u);
});

test("journal renders a two-page desktop spread and a one-page mobile sequence", () => {
  const entries = journalModule.buildStudyJournalEntries([
    source("one", 1), source("two", 2), source("three", 3),
  ]);
  const markup = renderJournal(entries);
  const pageSummaries = (view) => [...markup.matchAll(new RegExp(`<article[^>]*data-journal-view="${view}"[^>]*>([\\s\\S]*?)<\\/article>`, "gu"))]
    .map((match) => match[1].match(/<h3[^>]*>(.*?)<\/h3>/u)?.[1]);
  const spreadSummaries = pageSummaries("spread");
  const singleSummaries = pageSummaries("single");

  assert.deepEqual(spreadSummaries, ["Ôn tập three", "Ôn tập two"]);
  assert.deepEqual(singleSummaries, ["Ôn tập three"]);
  assert.match(markup, /Trang 1–2 \/ 3/u);
  assert.match(markup, /Trang 1 \/ 3/u);
  assert.match(markup, /aria-label="Điều hướng nhật ký/u);
});

test("journal pages show duration, assessment labels, correction state, and bounded Vietnamese goals", () => {
  const goal = "Ôn tập tế bào nhân thực và cách các bào quan phối hợp trong quá trình trao đổi chất ".repeat(4);
  const entries = journalModule.buildStudyJournalEntries([source("long", 1, {
    goal,
    topic: "Sinh học tế bào",
    focusedSeconds: 42,
    quizResult: { origin: "legacy-session", correct: 1, total: 2 },
    corrected: true,
  })]);
  const markup = renderJournal(entries);

  assert.match(markup, /42 giây/u);
  assert.match(markup, /Quiz<span> · 1\/2<\/span>/u);
  assert.match(markup, /Đã hiệu chỉnh/u);
  assert.ok(markup.includes(entries[0].summary));
  assert.ok(!markup.includes(goal));
});

test("journal controls are keyboard-operable buttons with correct first and last bounds", () => {
  const markup = renderJournal(journalModule.buildStudyJournalEntries([source("one", 1), source("two", 2)]));
  assert.match(markup, /<button[^>]*aria-label="Trang trước"[^>]*disabled=""/u);
  assert.match(markup, /<button[^>]*aria-label="Trang sau"/u);
  assert.match(markup, /data-page-action="spread-next"/u);
  assert.match(markup, /data-page-action="single-next"/u);
});

test("session detail buttons expose only a callback action and styles honor reduced motion", async () => {
  const markup = renderJournal(journalModule.buildStudyJournalEntries([source("session-42", 1)]));
  assert.match(markup, /aria-label="Mở chi tiết phiên học"/u);
  assert.match(markup, /<button[^>]*class="study-journal-page__open"/u);
  const css = await readFile(resolve(projectRoot, "src/adventure/studyJournal.css"), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /study-journal-page[^}]*animation:\s*none/u);
});
