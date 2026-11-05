import { useState } from "react";
import {
  activateStudyJournalEntry,
  formatStudyJournalDuration,
  getStudyJournalPagePosition,
  moveStudyJournalPage,
  type StudyJournalEntry,
  type StudyJournalLayout,
} from "./studyJournal";
import "./studyJournal.css";

export type StudyJournalProps = {
  entries: readonly StudyJournalEntry[];
  onOpenSession(id: string): void;
};

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function JournalPage({
  entry,
  number,
  view,
  onOpenSession,
}: {
  entry: StudyJournalEntry;
  number: number;
  view: "spread" | "single";
  onOpenSession(id: string): void;
}) {
  const date = new Date(entry.startedAt);
  const dateTime = Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  const dateLabel = dateTime ? dateFormatter.format(date) : "Thời gian không rõ";
  const hasQuizResult = entry.quizResult.correct !== undefined && entry.quizResult.total !== undefined;

  return <article className="study-journal-page" data-journal-view={view}>
    <header className="study-journal-page__header">
      <p>NHẬT KÝ HỌC TẬP</p>
      <time dateTime={dateTime}>{dateLabel}</time>
    </header>
    <span className="study-journal-page__number" aria-label={`Trang ${number}`}>{String(number).padStart(2, "0")}</span>
    <div className="study-journal-page__main">
      <p className="study-journal-page__topic">{entry.topic}</p>
      <h3 className="study-journal-page__summary">{entry.summary}</h3>
      <dl className="study-journal-page__facts">
        <div>
          <dt>Thời gian tập trung</dt>
          <dd>{formatStudyJournalDuration(entry.focusedSeconds)}</dd>
        </div>
        <div>
          <dt>Kết quả ôn tập</dt>
          <dd>{entry.quizResult.label}{hasQuizResult && <span> · {entry.quizResult.correct}/{entry.quizResult.total}</span>}</dd>
        </div>
      </dl>
      {entry.corrected && <p className="study-journal-page__corrected" role="note">Đã hiệu chỉnh</p>}
    </div>
    <footer className="study-journal-page__footer">
      <button
        type="button"
        className="study-journal-page__open"
        aria-label="Mở chi tiết phiên học"
        onClick={() => activateStudyJournalEntry(entry.id, onOpenSession)}
      >Mở chi tiết</button>
    </footer>
  </article>;
}

function JournalNavigation({
  count,
  pageIndex,
  layout,
  onPageChange,
}: {
  count: number;
  pageIndex: number;
  layout: StudyJournalLayout;
  onPageChange(index: number): void;
}) {
  const position = getStudyJournalPagePosition(count, pageIndex, layout);
  const firstPage = position.visibleIndexes[0];
  const lastPage = position.visibleIndexes[position.visibleIndexes.length - 1];
  const label = firstPage === lastPage
    ? `Trang ${firstPage! + 1} / ${count}`
    : `Trang ${firstPage! + 1}–${lastPage! + 1} / ${count}`;
  const previousAction = layout === "spread" ? "spread-previous" : "single-previous";
  const nextAction = layout === "spread" ? "spread-next" : "single-next";

  return <nav className={`study-journal-navigation study-journal-navigation--${layout}`}
    aria-label="Điều hướng nhật ký" data-layout={layout}>
    <button
      type="button"
      data-page-action={previousAction}
      aria-label="Trang trước"
      disabled={position.previousDisabled}
      onClick={() => onPageChange(moveStudyJournalPage(pageIndex, count, layout, -1))}
    >Trang trước</button>
    <span aria-live="polite">{label}</span>
    <button
      type="button"
      data-page-action={nextAction}
      aria-label="Trang sau"
      disabled={position.nextDisabled}
      onClick={() => onPageChange(moveStudyJournalPage(pageIndex, count, layout, 1))}
    >Trang sau</button>
  </nav>;
}

export function StudyJournal({ entries, onOpenSession }: StudyJournalProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const spread = getStudyJournalPagePosition(entries.length, pageIndex, "spread");
  const single = getStudyJournalPagePosition(entries.length, pageIndex, "single");

  return <section className="study-journal" aria-labelledby="study-journal-title">
    <header className="study-journal__heading">
      <p className="study-journal__eyebrow">DẤU MỐC CỦA RIÊNG BẠN</p>
      <h2 id="study-journal-title">Nhật ký học tập</h2>
      <p>Mỗi trang ghi lại mục tiêu, thời gian tập trung và kết quả ôn tập của một phiên.</p>
    </header>

    {entries.length === 0
      ? <div className="study-journal-empty" role="status">
        <h3>Chưa có phiên học nào</h3>
        <p>Nhật ký sẽ lưu lại những phiên học đã kết thúc.</p>
      </div>
      : <>
        <div className="study-journal-book study-journal-spread" data-study-journal-spread="spread">
          {spread.visibleIndexes.map((entryIndex) => {
            const entry = entries[entryIndex];
            return entry && <JournalPage key={entry.id} entry={entry} number={entryIndex + 1} view="spread" onOpenSession={onOpenSession} />;
          })}
          {spread.visibleIndexes.length === 1 && <div className="study-journal-page study-journal-page--blank" aria-hidden="true" />}
        </div>
        <JournalNavigation count={entries.length} pageIndex={pageIndex} layout="spread" onPageChange={setPageIndex} />

        <div className="study-journal-book study-journal-single" data-study-journal-spread="single">
          {entries[single.currentIndex] && <JournalPage
            entry={entries[single.currentIndex]!}
            number={single.currentIndex + 1}
            view="single"
            onOpenSession={onOpenSession}
          />}
        </div>
        <JournalNavigation count={entries.length} pageIndex={pageIndex} layout="single" onPageChange={setPageIndex} />
      </>}
  </section>;
}
