import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appPath = new URL("../src/adventure/AdventureApp.tsx", import.meta.url);
const adventureApp = readFileSync(appPath, "utf8");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("focus uses a quiet companion and progress display without the legacy journey scene", () => {
  const focus = between(adventureApp, "{view === \"focus\"", "{view === \"map\"");
  assert.doesNotMatch(focus, /<JourneyView\b|<TopDownScene\b|CHUYẾN CÁ NHÂN|Mã chuyến|KINH NGHIỆM TOA|CHUYẾN ĐI/u);
  assert.match(focus, /FocusStudyCompanion/u);
});

test("summary keeps a companion and session metrics without train imagery or carriage labels", () => {
  const summaryStart = adventureApp.indexOf("{view === \"summary\"");
  assert.notEqual(summaryStart, -1);
  const summary = adventureApp.slice(summaryStart);
  assert.doesNotMatch(summary, /<JourneyView\b|<TopDownScene\b|KINH NGHIỆM TOA|Mang kiến thức theo chuyến đi/u);
  assert.match(summary, /SessionSummaryCompanion/u);
  assert.match(summary, /summary-stats/u);
  assert.match(summary, /Mở buổi học mới/u);
});
