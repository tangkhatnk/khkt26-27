import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const view = await readFile(new URL("../src/adventure/LearningPathView.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/adventure/learningPath.css", import.meta.url), "utf8");

test("lesson route winds through four positions and keeps the start action explicit", () => {
  assert.match(view, /const sweepStep = index % 4/u);
  assert.match(view, /const routeX = \[300, 700, 410, 590\]/u);
  assert.match(view, /learning-route__row--step-\$\{sweepStep\}/u);
  assert.match(view, /learning-route__start-marker/u);
  assert.match(view, /Bắt đầu/u);
  assert.match(styles, /\.learning-route__node:focus-visible/u);
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
