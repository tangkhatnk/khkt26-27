import "./revisionMaterialsLibrary.css";

export type RevisionMaterialReviewState = "reviewed" | "needs-review" | "unreadable";

export type RevisionMaterialEntry = {
  id: string;
  name: string;
  sourceLabel: string;
  reviewState: RevisionMaterialReviewState;
};

export type RevisionMaterialsLibraryProps = {
  entries: readonly RevisionMaterialEntry[];
  onPreview(id: string, trigger?: HTMLButtonElement): void;
  onUseInPlan(id: string): void;
  onAddNotes(): void;
  onAddFiles(): void;
  onComposeWithAI(): void;
};

const reviewStateLabels: Record<RevisionMaterialReviewState, string> = {
  reviewed: "Đã kiểm tra",
  "needs-review": "Cần kiểm tra",
  unreadable: "Không đọc được",
};

export function RevisionMaterialsLibrary({
  entries,
  onPreview,
  onUseInPlan,
  onAddNotes,
  onAddFiles,
  onComposeWithAI,
}: RevisionMaterialsLibraryProps) {
  const addActions = [
    { label: "Thêm ghi chú", onClick: onAddNotes },
    { label: "Tải tài liệu", onClick: onAddFiles },
    { label: "Nhờ AI soạn", onClick: onComposeWithAI },
  ];

  return <section className="revision-materials-library" aria-labelledby="revision-materials-library-title">
    <header className="revision-materials-library__header">
      <div>
        <h2 id="revision-materials-library-title" tabIndex={-1}>Thư viện tài liệu ôn tập</h2>
        <p>Kiểm tra nội dung trước khi dùng tài liệu trong kế hoạch ôn tập.</p>
      </div>
      <div className="revision-materials-library__add-actions" role="group" aria-label="Thêm tài liệu ôn tập">
        {addActions.map((action) => <button
          key={action.label}
          type="button"
          className="revision-materials-library__add-action"
          onClick={action.onClick}
        >{action.label}</button>)}
      </div>
    </header>

    {entries.length === 0
      ? <div className="revision-materials-library__empty" role="status">
        <h3>Chưa có tài liệu ôn tập</h3>
        <p>Ghi chú, tài liệu tải lên và bản AI soạn sẽ hiện ở đây sau khi bạn thêm.</p>
      </div>
      : <ul className="revision-materials-library__list" aria-label="Tài liệu ôn tập">
        {entries.map((entry) => {
          const reviewed = entry.reviewState === "reviewed";
          return <li key={entry.id} className="revision-materials-library__list-item">
            <article className="revision-materials-library__entry">
              <div className="revision-materials-library__details">
                <h3 className="revision-materials-library__name">{entry.name}</h3>
                <p className="revision-materials-library__source">{entry.sourceLabel}</p>
                <p
                  className={`revision-materials-library__review-state revision-materials-library__review-state--${entry.reviewState}`}
                >{reviewStateLabels[entry.reviewState]}</p>
              </div>
              <div className="revision-materials-library__entry-actions">
                <button
                  type="button"
                  className="revision-materials-library__entry-action"
                  aria-label={`Xem trước: ${entry.name}`}
                  onClick={(event) => onPreview(entry.id, event.currentTarget)}
                >Xem trước</button>
                <button
                  type="button"
                  className="revision-materials-library__entry-action revision-materials-library__entry-action--use"
                  aria-label={`Dùng ${entry.name} cho kế hoạch`}
                  disabled={!reviewed}
                  onClick={() => onUseInPlan(entry.id)}
                >Dùng cho kế hoạch</button>
              </div>
            </article>
          </li>;
        })}
      </ul>}
  </section>;
}
