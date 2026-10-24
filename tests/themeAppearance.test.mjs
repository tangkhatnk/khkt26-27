import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const themeCssUrl = new URL("../src/adventure/theme.css", import.meta.url);
const css = await readFile(themeCssUrl, "utf8");

function rule(selector) {
  const exact = css.indexOf(`${selector} {`);
  const start = exact >= 0 ? exact : css.indexOf(`${selector},`);
  assert.notEqual(start, -1, `expected theme rule: ${selector}`);
  const bodyStart = css.indexOf("{", start) + 1;
  const end = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, end);
}

test("dark history surfaces and ordinary rows stay on night colors", () => {
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-table-wrap'), /background:\s*#1d2922/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-results .experiment-table'), /background:\s*#1d2922/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-results .experiment-table tbody tr'), /background:\s*#1d2922/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-results .experiment-table tbody tr:nth-child(even)'), /background:\s*#202c24/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-results .experiment-table caption'), /background:\s*#1d2922/u);
});

test("dark base button styling leaves selected duration and mode choices distinct", () => {
  const base = rule('html[data-theme="dark"] .adventure button:not(.primary):not(.nav):not(.account):not(.selected):not([aria-pressed="true"])');
  assert.match(base, /background:\s*var\(--surface-raised\)/u);
  const selected = rule('html[data-theme="dark"] .adventure button.selected');
  assert.match(selected, /background:\s*#30483a/u);
  assert.match(selected, /color:\s*#d9edda/u);
});

test("dark status and experiment metadata use readable muted colors", () => {
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-started-cell small'), /color:\s*#b4c9b5/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-goal small'), /color:\s*#b4c9b5/u);
  assert.match(rule('html[data-theme="dark"] .adventure .connection'), /color:\s*#b9d0bd/u);
  assert.match(rule('html[data-theme="dark"] .adventure .connection.offline'), /color:\s*#f0c184/u);
  assert.match(rule('html[data-theme="dark"] .adventure .chapter'), /color:\s*#b4cbb8/u);
});
