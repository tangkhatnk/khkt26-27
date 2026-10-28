import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const themeCssUrl = new URL("../src/adventure/theme.css", import.meta.url);
const css = await readFile(themeCssUrl, "utf8");
const experimentCssUrl = new URL("../src/adventure/experimentResults.css", import.meta.url);
const experimentCss = await readFile(experimentCssUrl, "utf8");
const adventureCssUrl = new URL("../src/adventure/adventure.css", import.meta.url);
const adventureCss = await readFile(adventureCssUrl, "utf8");
const boardingCssUrl = new URL("../src/adventure/boarding.css", import.meta.url);
const boardingCss = await readFile(boardingCssUrl, "utf8");

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

test("dark primary actions keep a clear border and focus treatment", () => {
  const primary = rule('html[data-theme="dark"] .adventure .primary');
  const hover = rule('html[data-theme="dark"] .adventure .primary:hover:not(:disabled)');
  const focus = rule('html[data-theme="dark"] .adventure .primary:focus-visible');

  assert.match(primary, /border-color:\s*#e4ad89/u);
  assert.match(hover, /border-color:\s*#f4c7a4/u);
  assert.match(focus, /outline:\s*3px solid #ffd6b7/u);
  assert.match(focus, /box-shadow:/u);
});

test("light primary actions keep a clear border and focus treatment", () => {
  assert.match(adventureCss, /\.adventure \.primary \{[^}]*border-color:\s*#9f4d26/u);
  assert.match(adventureCss, /\.adventure \.primary:hover:not\(:disabled\) \{[^}]*border-color:\s*#87411f/u);
  assert.match(adventureCss, /\.adventure \.primary:focus-visible \{[^}]*outline:\s*3px solid #31583f/u);
  assert.match(adventureCss, /\.adventure \.primary:focus-visible \{[^}]*box-shadow:/u);
});

test("boarding ticket landscape stays behind readable content and scales for narrow tickets", () => {
  assert.match(boardingCss, /\.boarding-ticket__main \{[^}]*isolation:\s*isolate/u);
  assert.match(boardingCss, /\.boarding-ticket__landscape \{[^}]*z-index:\s*0/u);
  assert.match(boardingCss, /\.boarding-ticket__details \{[^}]*z-index:\s*1/u);
  assert.match(boardingCss, /\.boarding-ticket__barcode \{[^}]*z-index:\s*1/u);
  assert.match(boardingCss, /@media \(max-width:\s*620px\)[\s\S]*?\.boarding-ticket__landscape \{/u);
  assert.match(boardingCss, /@media \(max-width:\s*380px\)[\s\S]*?\.boarding-ticket__landscape \{/u);
  const phoneRule = boardingCss.match(/@media \(max-width:\s*430px\)\s*\{[^}]*\.boarding-ticket__landscape\s*\{[^}]*\}[^}]*\}/u)?.[0];
  assert.ok(phoneRule, "small phone tickets explicitly suppress the body motif to protect route text");
  assert.match(phoneRule, /\.boarding-ticket__landscape\s*\{[^}]*display:\s*none/u);
  assert.doesNotMatch(phoneRule, /boarding-ticket__ornament/u);
  assert.match(boardingCss, /--ticket-route:\s*#bc704c/u);
  assert.match(css, /--ticket-route:\s*#e0a178/u);
});

test("dark status and experiment metadata use readable muted colors", () => {
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-started-cell small'), /color:\s*#b4c9b5/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-efficiency-summary strong'), /color:\s*#dce8db/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-goal small'), /color:\s*#b4c9b5/u);
  assert.match(rule('html[data-theme="dark"] .adventure .connection'), /color:\s*#b9d0bd/u);
  assert.match(rule('html[data-theme="dark"] .adventure .connection.offline'), /color:\s*#f0c184/u);
  assert.match(rule('html[data-theme="dark"] .adventure .chapter'), /color:\s*#b4cbb8/u);
});

test("single-span public goal summaries have readable light and dark colors", () => {
  assert.match(experimentCss, /\.experiment-results \.experiment-goal-summary\s*\{[^}]*color:\s*#344b3e/u);
  assert.doesNotMatch(experimentCss, /experiment-goal-summary span:(?:first|last)-child/u);
  assert.match(css, /html\[data-theme="dark"\] \.adventure \.experiment-goal-summary\s*\{[^}]*color:\s*var\(--text\)/u);
  assert.doesNotMatch(css, /experiment-goal-summary span:/u);
});

test("expanded trip details fit the table row and use readable light and dark controls", () => {
  assert.match(experimentCss, /\.experiment-details-row\s*>\s*td\s*\{[^}]*background:\s*var\(--surface-raised/u);
  assert.match(experimentCss, /\.experiment-trip-code\s*\{[^}]*overflow-wrap:\s*anywhere/u);
  assert.match(experimentCss, /\.experiment-trip-code\s*\{[^}]*white-space:\s*normal/u);
  assert.match(experimentCss, /\.experiment-details-toggle:focus-visible\s*\{[^}]*outline:/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-details-toggle'), /background:\s*var\(--surface\)/u);
  assert.match(rule('html[data-theme="dark"] .adventure .experiment-details-row > td'), /background:\s*var\(--surface-raised\)/u);
  assert.match(experimentCss, /@media \(max-width:\s*820px\)[\s\S]*?\.experiment-results \.experiment-table-wrap\s*\{[^}]*display:\s*none/u);
  assert.match(experimentCss, /@media \(max-width:\s*820px\)[\s\S]*?\.experiment-results \.experiment-run-cards\s*\{[^}]*display:\s*grid/u);
  assert.match(experimentCss, /\.experiment-results \.experiment-details\s*\{[^}]*font-size:\s*13px/u);
  assert.match(experimentCss, /\.experiment-results \.experiment-details dl\s*\{[^}]*min-width:\s*0/u);
  assert.match(experimentCss, /\.experiment-results \.experiment-details dl\s*>\s*div\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*240px\) minmax\(0,\s*1fr\)/u);
  assert.match(experimentCss, /\.experiment-results \.experiment-details \.experiment-goal-summary\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/u);
  assert.match(experimentCss, /@media \(max-width:\s*820px\)[\s\S]*?\.experiment-results \.experiment-details dl\s*>\s*div\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
});
