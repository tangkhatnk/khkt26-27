import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let vite;
let StudyPlanWorkspace;
let StudyPlanStepNavigation;

before(async () => {
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    configLoader: "runner",
    cacheDir: resolve(projectRoot, "node_modules/.vite-study-plan-route-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ StudyPlanWorkspace, StudyPlanStepNavigation } = await vite.ssrLoadModule("/src/adventure/StudyPlanWorkspace.tsx"));
});

after(async () => {
  await vite?.close();
});

const steps = [
  { id: "step-done", title: "Ôn lại chuyển hóa năng lượng", action: "So sánh hai quá trình", outcome: "Nêu được điểm khác nhau", check: "Tự trình bày lại", preferredMinutes: 20 },
  { id: "step-now", title: "Giải thích vai trò của ti thể", action: "Đọc phần đã kiểm tra", outcome: "Mô tả được chức năng chính", check: "Giải thích không nhìn tài liệu", preferredMinutes: 25 },
  { id: "step-later", title: "Tự kiểm tra kiến thức", action: "Trả lời câu hỏi", outcome: "Tìm ra phần còn chưa rõ", check: "Đối chiếu với ghi chú", preferredMinutes: 15 },
];

const stepStates = [
  { stepId: "step-done", state: "completed" },
  { stepId: "step-now", state: "available" },
  { stepId: "step-later", state: "locked" },
];

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(StudyPlanWorkspace, {
    goal: "Giải thích sự chuyển hóa năng lượng trong tế bào",
    subject: "Sinh học",
    preferredMinutes: 45,
    breakCount: 0,
    breakMinutes: 5,
    plan: { id: "plan-a", title: "Ôn tập chuyển hóa", origin: "manual", selectedStepId: "step-now", steps },
    stepStates,
    selectedStepId: "step-done",
    onSelectStep: () => {},
    ...overrides,
  }));
}

function collectElements(element, result = []) {
  if (Array.isArray(element)) {
    for (const child of element) collectElements(child, result);
  } else if (element && typeof element === "object" && "type" in element && "props" in element) {
    result.push(element);
    collectElements(element.props.children, result);
  }
  return result;
}

test("route status is explicit and does not change when a completed step is selected for review", () => {
  const view = render();

  assert.match(view, /<div class="study-plan-workspace__route-frame">[\s\S]*?<div class="study-plan-workspace__route-canvas"><svg class="study-plan-workspace__route-rail"[^>]*>[\s\S]*?<\/svg><ol class="[^"]*study-plan-workspace__step-route[^"]*"[^>]*aria-label="Các bước trong lộ trình cá nhân"/u);
  assert.match(view, /Bước 1: Ôn lại chuyển hóa năng lượng · Đã hoàn thành/u);
  assert.match(view, /class="[^"]*is-completed[^"]*is-selected[^"]*"[^>]*aria-current="step"/u);
  assert.match(view, /Bước 2: Giải thích vai trò của ti thể · Có thể học/u);
  assert.match(view, /class="[^"]*route-node is-available"[^>]*aria-label="Bước 2:/u);
  assert.match(view, /aria-label="Bước 2: Giải thích vai trò của ti thể · Có thể học · Bước tiếp theo"/u);
  assert.match(view, /class="study-plan-workspace__route-callout" aria-hidden="true">Bước tiếp theo<\/span>/u);
  assert.match(view, /Bước 3: Tự kiểm tra kiến thức · Chưa mở/u);
  assert.equal((view.match(/class="study-plan-workspace__route-note"/gu) ?? []).length, 1);
  assert.doesNotMatch(view, /route-status is-locked/u, "locked status is explained once near the path rather than repeated on every node");
  assert.match(view, /<h3 id="study-plan-workspace-selected-step-title">Ôn lại chuyển hóa năng lượng<\/h3>/u);
  assert.match(view, /<dd>So sánh hai quá trình<\/dd>/u);
  assert.ok(view.indexOf("class=\"study-plan-workspace__selected-step\"") < view.indexOf("class=\"study-plan-workspace__route-frame\""), "selected details precede the full route on narrow screens");
});

test("the first available node is called out as the start even when another step remains selected", () => {
  const view = render({
    plan: { id: "plan-a", title: "Ôn tập", origin: "manual", selectedStepId: "step-now", steps },
    stepStates: [
      { stepId: "step-done", state: "available" },
      { stepId: "step-now", state: "locked" },
      { stepId: "step-later", state: "locked" },
    ],
    selectedStepId: "step-now",
  });

  assert.match(view, /class="study-plan-workspace__route-callout" aria-hidden="true">Bắt đầu<\/span>/u);
  assert.match(view, /class="[^"]*route-node is-locked is-selected"[^>]*aria-current="step"/u);
  assert.equal((view.match(/class="study-plan-workspace__route-callout"/gu) ?? []).length, 1);
});

test("completed steps remain selectable while locked steps cannot invoke selection", () => {
  const selected = [];
  const navigation = StudyPlanStepNavigation({
    steps,
    stepStates,
    selectedStepId: "step-now",
    onSelectStep: (id) => selected.push(id),
  });
  const buttons = collectElements(navigation).filter((node) => node.type === "button");

  assert.equal(buttons[0].props.disabled, false, "completed steps can be revisited");
  assert.equal(buttons[1].props.disabled, false, "available steps can be selected");
  assert.equal(buttons[2].props.disabled, true, "locked steps are not interactive");
  buttons[0].props.onClick();
  buttons[1].props.onClick();
  buttons[2].props.onClick();
  assert.deepEqual(selected, ["step-done", "step-now"]);
});

test("an explicit partial state map fails closed and selection does not imply availability", () => {
  const view = render({
    stepStates: [{ stepId: "step-now", state: "available" }],
    selectedStepId: "step-later",
  });

  assert.match(view, /Bước 3: Tự kiểm tra kiến thức · Chưa mở/u);
  assert.match(view, /class="[^"]*is-locked[^"]*is-selected[^"]*"[^>]*aria-current="step"/u);
  assert.match(view, /<h3 id="study-plan-workspace-selected-step-title">Tự kiểm tra kiến thức<\/h3>/u);
});

test("missing route state is locked rather than inferred from the selected step", () => {
  const view = render({ stepStates: undefined, selectedStepId: "step-now" });
  const routeButtons = view.match(/<button[^>]*class="[^"]*study-plan-workspace__route-node[^>]*>/gu) ?? [];

  assert.equal(routeButtons.length, 3);
  assert.equal(routeButtons.every((button) => /disabled=""/u.test(button)), true);
  assert.match(view, /class="[^"]*is-locked is-selected"[^>]*aria-label="Bước 2:[^"]*" aria-current="step" disabled=""/u);

  const standalone = StudyPlanStepNavigation({
    steps,
    selectedStepId: "step-now",
    onSelectStep: (id) => assert.fail(`missing state must not enable ${id}`),
  });
  const standaloneButtons = collectElements(standalone).filter((node) => node.type === "button");
  assert.equal(standaloneButtons.every((button) => button.props.disabled), true);
  standaloneButtons[1].props.onClick();
});

test("staggered route wraps long Vietnamese titles and becomes a vertical mobile rail without horizontal scrolling", async () => {
  const css = await readFile(resolve(projectRoot, "src/adventure/studyPlanWorkspace.css"), "utf8");
  const longTitle = "Giải thích thật rõ mối liên hệ giữa quá trình quang hợp và hô hấp tế bào trong những điều kiện khác nhau";
  const view = render({
    plan: { id: "plan-a", title: "Lộ trình", origin: "manual", selectedStepId: "step-now", steps: [{ ...steps[1], title: longTitle }] },
    stepStates: [{ stepId: "step-now", state: "available" }],
    selectedStepId: "step-now",
  });

  assert.match(view, new RegExp(longTitle, "u"));
  assert.match(css, /\.study-plan-workspace__route-copy strong\s*\{[^}]*overflow-wrap:\s*anywhere/su);
  assert.match(css, /\.study-plan-workspace__route-callout\s*\{/u);
  assert.match(css, /\.study-plan-workspace__route-note\s*\{/u);
  assert.match(css, /\.study-plan-workspace__plan-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*\.92fr\)\s+minmax\(0,\s*1\.08fr\)/su);
  assert.match(css, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.study-plan-workspace__selected-step\s*\{[^}]*grid-row:\s*1/su);
  assert.match(css, /@media\s*\(max-width:\s*860px\)[\s\S]*?\.study-plan-workspace__route-frame\s*\{[^}]*grid-row:\s*2/su);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.study-plan-workspace__step-route\s*\{[^}]*grid-template-columns:\s*88px\s+minmax\(0,\s*1fr\)/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.study-plan-workspace__route-node-wrap--left\.study-plan-workspace__route-node-wrap--far\s*\{\s*left:\s*-15%/u);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.study-plan-workspace__route-node-wrap--left\.study-plan-workspace__route-node-wrap--near\s*\{\s*left:\s*-12%/u);
  assert.match(css, /\.study-plan-workspace__step-route\s*\{[^}]*overflow-x:\s*visible/su);
  assert.doesNotMatch(css, /\.study-plan-workspace__step-route[^}]*overflow-x:\s*(?:auto|scroll)/su);
});

test("route node dimensions and dark-theme exclusions survive generic button styles", async () => {
  const css = await readFile(resolve(projectRoot, "src/adventure/studyPlanWorkspace.css"), "utf8");
  const theme = await readFile(resolve(projectRoot, "src/adventure/theme.css"), "utf8");
  const genericDarkButtonSelectors = (theme.match(/html\[data-theme="dark"\] \.adventure button[^{]+/gu) ?? [])
    .filter((selector) => selector.includes(":not(.primary)"));

  assert.match(css, /\.adventure button\.study-plan-workspace__route-node\s*\{[^}]*padding:\s*0;[^}]*border-radius:\s*50%/su);
  assert.equal(genericDarkButtonSelectors.length, 2);
  assert.equal(genericDarkButtonSelectors.every((selector) => selector.includes(":not(.study-plan-workspace__route-node)")), true);
});
