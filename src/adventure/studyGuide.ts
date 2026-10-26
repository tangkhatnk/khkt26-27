import type { MaterialSource } from "./materialSources";
import { isValidStudyGuideIllustrations, type StudyGuideIllustration } from "./studyGuideIllustrations.ts";

export type StudyGuideDraft = { title: string; text: string; illustrations?: StudyGuideIllustration[] };

function checkedGuide(draft: StudyGuideDraft): StudyGuideDraft {
  const title = draft.title.trim(), text = draft.text.trim();
  if (!title || title.length > 120 || text.length < 10 || text.length > 20000)
    throw new Error("Bản ôn tập cần tiêu đề từ 1–120 ký tự và nội dung từ 10–20.000 ký tự.");
  if (draft.illustrations !== undefined && !isValidStudyGuideIllustrations(draft.illustrations))
    throw new Error("Hình minh họa của bản ôn tập không hợp lệ.");
  return { title, text, ...(draft.illustrations ? { illustrations: draft.illustrations } : {}) };
}

export function studyGuideDownload(draft: StudyGuideDraft): string {
  const { title, text } = checkedGuide(draft);
  return `${title}\n${"=".repeat(Math.min(title.length, 60))}\n\n${text}\n\nBản ôn tập được tạo bằng AI. Hãy đối chiếu kiến thức và chỉnh sửa trước khi sử dụng.\n`;
}

/** Generation alone never makes an AI guide a reviewed learning source. */
export function studyGuideSource(id: string, draft: StudyGuideDraft): MaterialSource {
  const { title, text, illustrations } = checkedGuide(draft);
  return { id, name: `${title}.txt`, text, source: "ai-generated", requiresReview: true, reviewed: false,
    ...(illustrations ? { illustrations } : {}) };
}
