import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const view = await readFile(new URL("../src/adventure/LearningPathView.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/adventure/learningPath.css", import.meta.url), "utf8");
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let LearningPathHome;
let pathDomain;
let courses;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-learning-path-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ LearningPathHome } = await vite.ssrLoadModule("/src/adventure/LearningPathView.tsx"));
  pathDomain = await vite.ssrLoadModule("/src/adventure/learningPath.ts");
  ({ CURATED_COURSES: courses } = await vite.ssrLoadModule("/src/adventure/curatedCurriculum.ts"));
});

after(async () => {
  await vite?.close();
});

function collectElements(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, predicate, found);
    return found;
  }
  if (!React.isValidElement(node)) return found;
  if (predicate(node)) found.push(node);
  collectElements(node.props.children, predicate, found);
  return found;
}

test("lesson route winds through four positions and keeps the start action explicit", () => {
  assert.match(view, /const sweepStep = index % 4/u);
  assert.match(view, /const routeX = \[300, 700, 410, 590\]/u);
  assert.match(view, /learning-route__row--step-\$\{sweepStep\}/u);
  assert.match(view, /learning-route__start-marker/u);
  assert.match(view, /Bắt đầu/u);
  assert.match(styles, /\.learning-route__node:focus-visible/u);
});

test("the start marker is rendered inside the accessible lesson button and activates that lesson", () => {
  const course = courses[0];
  const progress = pathDomain.createLearningPathProgress(course.id);
  const lessonStates = pathDomain.lessonStates(course, progress);
  let openedLesson;
  const props = {
    courses,
    course,
    progress,
    lessonStates,
    nextLesson: pathDomain.nextAvailableLesson(course, progress),
    daily: {
      focusedSeconds: 0, plannedBreakSeconds: 0, actualBreakSeconds: 0, distractions: 0,
      awaySeconds: 0, sessionCount: 0, latestQuiz: null, quizCount: 0,
      latestCuratedEvaluation: null, curatedEvaluationCount: 0,
    },
    difficulty: {
      kind: "curated-default", completedEvaluations: 0, scoredAnswers: 0,
      correctAnswers: 0, correctRate: null,
    },
    duration: { source: "curated-estimate", sampleCount: 0, medianFocusedMinutes: null, minutes: 6 },
    guideOpen: false,
    onSelectCourse() {},
    onOpenLesson(lesson) { openedLesson = lesson; },
    onResume() {},
    onResumeExistingSession() {},
    onOpenGuide() {},
    onDismissGuide() {},
    onNavigate() {},
  };
  const tree = LearningPathHome(props);
  const isMarker = element => element.type === "span" && element.props.className === "learning-route__start-marker";
  const lessonButtons = collectElements(tree, element => element.type === "button" &&
    String(element.props.className).includes("learning-route__node"));
  const markers = collectElements(tree, isMarker);
  const buttonWithMarker = lessonButtons.filter(button => collectElements(button, isMarker).length > 0);
  const markup = renderToStaticMarkup(tree);

  assert.equal(markers.length, 1);
  assert.equal(lessonButtons.length, course.lessons.length);
  assert.equal(buttonWithMarker.length, 1, "exactly one native lesson button owns the visible start cue");
  assert.equal(buttonWithMarker[0].props["aria-label"], `Bài 1: ${course.lessons[0].title}. Bắt đầu.`);
  assert.equal(buttonWithMarker[0].props.disabled, false);
  assert.equal(lessonButtons.at(-1).props.disabled, true, "locked lesson buttons stay disabled");
  assert.match(markup, /<button[^>]*aria-label="Bài 1: [^"]+\. Bắt đầu\."[^>]*>[\s\S]*?<span class="learning-route__start-marker">[\s\S]*?Bắt đầu[\s\S]*?<\/span>[\s\S]*?<\/button>/u);
  buttonWithMarker[0].props.onClick();
  assert.equal(openedLesson, course.lessons[0]);
});

test("the existing buddy gives one readable unlocking tip beside early route nodes", () => {
  assert.match(view, /className="learning-route__buddy-tip" aria-label="Gợi ý từ Người bạn học"/u);
  assert.match(view, /<LearningBuddy compact \/>/u);
  assert.match(view, /Tập trung đủ thời gian rồi tự kiểm tra để mở bài kế tiếp\./u);
  assert.match(styles, /\.learning-route__buddy-tip/);
});

test("locked milestones remain visibly distinct and the route respects reduced motion", () => {
  assert.match(view, /CHƯA MỞ · VẬN DỤNG/u);
  assert.match(styles, /\.learning-route__node\.is-locked\.is-milestone\s*\{[^}]*border-radius:\s*24px/su);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
});

test("four-step route positions and mobile layout stay within the viewport", () => {
  for (const step of [0, 1, 2, 3]) assert.match(styles, new RegExp(`\\.learning-route__row--step-${step}`));
  assert.match(styles, /@media \(max-width: 740px\)/u);
  assert.match(styles, /@media \(max-width: 420px\)/u);
  assert.match(styles, /\.learning-route__node-wrap\s*\{[^}]*left:\s*var\(--route-node-x\)/su);
});
