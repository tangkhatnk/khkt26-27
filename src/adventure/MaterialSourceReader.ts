import { createElement, useState } from "react";
import { StudyGuideArticle } from "./StudyGuideRenderer.ts";

type MaterialSourceReaderProps = {
  title: string;
  text: string;
  onChange?: (text: string) => void;
  disabled?: boolean;
  maxLength?: number;
  aiGenerated?: boolean;
  textareaLabel?: string;
  placeholder?: string;
  emptyMessage?: string;
};

/** Shows the exact saved source as safe formatted text, with an explicit original-text editor when allowed. */
export function MaterialSourceReader({
  title,
  text,
  onChange,
  disabled = false,
  maxLength = 50000,
  aiGenerated = false,
  textareaLabel = "Bản chép tài liệu",
  placeholder,
  emptyMessage = "Chưa đọc được nội dung nguồn.",
}: MaterialSourceReaderProps) {
  const [editing, setEditing] = useState(false);
  const canEdit = typeof onChange === "function";

  return createElement("div", { className: "material-reader" },
    canEdit ? createElement("div", { className: "material-reader__toolbar", role: "group", "aria-label": "Chế độ hiển thị tài liệu" },
      createElement("button", {
        type: "button",
        "aria-pressed": !editing,
        disabled,
        onClick: () => setEditing(false),
      }, "Đọc dễ xem"),
      createElement("button", {
        type: "button",
        "aria-pressed": editing,
        disabled,
        onClick: () => setEditing(true),
      }, "Sửa bản chép")) : null,
    editing && canEdit
      ? createElement("div", { className: "material-reader__editor" },
        createElement("label", null, textareaLabel,
          createElement("textarea", {
            rows: 8,
            maxLength,
            disabled,
            value: text,
            placeholder,
            onChange: (event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value),
          })),
        createElement("p", { className: "material-hint" }, "Đây là bản chép gốc. Mọi chỉnh sửa cần được xác nhận lại trước khi dùng làm câu hỏi."))
      : createElement(StudyGuideArticle, { title, text: text || emptyMessage, label: "Nội dung tài liệu", aiGenerated }));
}
