import assert from "node:assert/strict";
import test from "node:test";
import { buildRevisionMaterialEntries, collectRevisionMaterialRecords } from "../src/adventure/revisionMaterialEntries.ts";

const source = (overrides = {}) => ({
  id: "source-a",
  name: "Vật lý.pdf",
  text: "Nội dung nguồn đủ dài để có thể kiểm tra và đưa vào kế hoạch học tập.",
  source: "local-ocr",
  requiresReview: true,
  reviewed: false,
  ...overrides,
});

test("library projection labels source and review state without exposing private text", () => {
  const entries = buildRevisionMaterialEntries([
    { id: "draft:ai", source: source({ id: "ai", name: "Ôn tập.txt", source: "ai-generated", reviewed: true, requiresReview: false }) },
    { id: "history:pdf", source: source(), material: { name: "Vật lý.pdf", type: "application/pdf", status: "extracted" } },
    { id: "history:empty", source: source({ id: "empty", name: "Bài tập.docx", text: "", source: "local-ocr" }),
      material: { name: "Bài tập.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", status: "empty" } },
    { id: "history:embedded-pdf", source: source({ id: "embedded", name: "Chương 1.pdf", source: "embedded-text", reviewed: false }),
      material: { name: "Chương 1.pdf", type: "application/pdf", status: "extracted" } },
    { id: "history:repaired", source: source({ id: "repaired", name: "Bài thực hành.docx", reviewed: true }),
      material: { name: "Bài thực hành.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", status: "empty" } },
  ]);

  assert.deepEqual(entries, [
    { id: "draft:ai", name: "Ôn tập.txt", sourceLabel: "Bản ôn tập AI", reviewState: "reviewed" },
    { id: "history:pdf", name: "Vật lý.pdf", sourceLabel: "Tệp PDF", reviewState: "needs-review" },
    { id: "history:empty", name: "Bài tập.docx", sourceLabel: "Tệp DOCX", reviewState: "unreadable" },
    { id: "history:embedded-pdf", name: "Chương 1.pdf", sourceLabel: "Tệp PDF", reviewState: "needs-review" },
    { id: "history:repaired", name: "Bài thực hành.docx", sourceLabel: "Tệp DOCX", reviewState: "reviewed" },
  ]);
  assert.equal(entries.some((entry) => "text" in entry || "source" in entry), false);
});

test("library collection includes current, saved, and historical notes while excluding tombstones", () => {
  const materialSource = source({ id: "file-a", name: "Bài học.pdf" });
  const records = collectRevisionMaterialRecords({
    current: {
      sessionId: "current-session", planId: "plan-current", stepId: "step-current",
      notes: "Ghi chú hiện tại đủ dài để xem trước và dùng lại.",
      sources: [materialSource], materials: [{ name: "Bài học.pdf", sourceId: "file-a", type: "application/pdf", size: 10, status: "extracted", message: "Đã đọc" }],
    },
    drafts: [
      { sessionId: "current-session", planId: "plan-current", stepId: "step-current", notes: "Ghi chú cũ không được thay bản hiện tại.", sources: [], materials: [] },
      { sessionId: "saved-draft", planId: "plan-a", stepId: "step-a", notes: "Ghi chú trong bản nháp đã lưu.", sources: [], materials: [] },
      { sessionId: "deleted-draft", planId: "plan-b", stepId: "step-b", notes: "Không được hiện bản nháp đã gỡ.", sources: [source({ id: "deleted-source" })], materials: [] },
    ],
    history: [
      { sessionId: "history-session", planId: null, stepId: null, notes: "Ghi chú của phiên đã học.", sources: [], materials: [] },
      { sessionId: "deleted-history", planId: null, stepId: null, notes: "Không được hiện ghi chú đã gỡ.", sources: [], materials: [] },
    ],
  }, ["deleted-draft", "deleted-history"]);
  const entries = buildRevisionMaterialEntries(records);

  assert.deepEqual(records.map((record) => record.id), [
    JSON.stringify(["current-session", "file-a"]),
    JSON.stringify(["current-session", "notes"]),
    JSON.stringify(["saved-draft", "notes"]),
    JSON.stringify(["history-session", "notes"]),
  ]);
  assert.deepEqual(entries.map(({ id, name, sourceLabel, reviewState }) => ({ id, name, sourceLabel, reviewState })), [
    { id: JSON.stringify(["current-session", "file-a"]), name: "Bài học.pdf", sourceLabel: "Tệp PDF", reviewState: "needs-review" },
    { id: JSON.stringify(["current-session", "notes"]), name: "Ghi chú buổi học", sourceLabel: "Ghi chú học tập", reviewState: "reviewed" },
    { id: JSON.stringify(["saved-draft", "notes"]), name: "Ghi chú buổi học", sourceLabel: "Ghi chú học tập", reviewState: "reviewed" },
    { id: JSON.stringify(["history-session", "notes"]), name: "Ghi chú buổi học", sourceLabel: "Ghi chú học tập", reviewState: "reviewed" },
  ]);
  assert.equal(records.find((record) => record.id === JSON.stringify(["current-session", "notes"]))?.source.text,
    "Ghi chú hiện tại đủ dài để xem trước và dùng lại.");
  assert.equal(entries.some((entry) => "text" in entry || "source" in entry), false);
});
