import type { MaterialSource } from "./materialSources";

export type StudyGuideDraft = { title: string; text: string };

function checkedGuide(draft: StudyGuideDraft): StudyGuideDraft {
  const title = draft.title.trim(), text = draft.text.trim();
  if (!title || title.length > 120 || text.length < 10 || text.length > 20000)
    throw new Error("Bản ôn tập cần tiêu đề từ 1–120 ký tự và nội dung từ 10–20.000 ký tự.");
  return { title, text };
}

export function studyGuideDownload(draft: StudyGuideDraft): string {
  const { title, text } = checkedGuide(draft);
  return `${title}\n${"=".repeat(Math.min(title.length, 60))}\n\n${text}\n\nBản ôn tập được tạo bằng AI. Hãy đối chiếu kiến thức và chỉnh sửa trước khi sử dụng.\n`;
}

/** Generation alone never makes an AI guide a reviewed learning source. */
export function studyGuideSource(id: string, draft: StudyGuideDraft): MaterialSource {
  const { title, text } = checkedGuide(draft);
  return { id, name: `${title}.txt`, text, source: "ai-generated", requiresReview: true, reviewed: false };
}
