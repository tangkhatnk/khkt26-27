import { memo, useState } from "react";
import { DurationPicker } from "./DurationPicker";
import { updateQuickTripDraft, type QuickTripDraft } from "./quickTripDraft";

type Topic = { id: string; name: string };

type Props = {
  draftRef: { current: QuickTripDraft };
  topics: readonly Topic[];
  hasActiveTrip: boolean;
  onPrepare: (draft: QuickTripDraft) => void;
};

function HomeTripFormView({ draftRef, topics, hasActiveTrip, onPrepare }: Props) {
  const [draft, setDraft] = useState(() => ({ ...draftRef.current }));
  const change = (changes: Partial<QuickTripDraft>) =>
    setDraft(updateQuickTripDraft(draftRef, changes));

  return (
    <section className="ticket-card">
      <div className="eyebrow">CHUYẾN ĐI TIẾP THEO</div>
      <h2>
        Mang mục tiêu nhỏ,
        <br />
        đi một chặng xa.
      </h2>
      <p>
        Mỗi phút tập trung nuôi lớn toa tàu và mở ra vùng đất mới.
      </p>
      <div className="ticket-divider" />
      <label className="field-label" htmlFor="quick-goal">
        HÔM NAY BẠN MUỐN HỌC GÌ?
      </label>
      <textarea
        id="quick-goal"
        maxLength={500}
        value={draft.goal}
        onChange={(event) => change({ goal: event.target.value })}
        placeholder="Ví dụ: Nắm 5 ý chính của bài hôm nay…"
        rows={3}
      />
      <div className="quick-topic-field">
        <label className="field-label" htmlFor="quick-topic">CHỦ ĐỀ HỌC TẬP</label>
        <select
          id="quick-topic"
          value={draft.topic}
          onChange={(event) => change({ topic: event.target.value })}
        >
          {topics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <small>Chủ đề đã chọn sẽ được giữ trên tấm vé của bạn.</small>
      </div>
      <DurationPicker
        value={draft.minutes}
        onChange={(minutes) => change({ minutes })}
        breakCount={draft.breakCount}
        breakMinutes={draft.breakMinutes}
        onBreakCountChange={(breakCount) => change({ breakCount })}
        onBreakMinutesChange={(breakMinutes) => change({ breakMinutes })}
      />
      <button
        className="primary"
        onClick={() => onPrepare({ ...draftRef.current })}
      >
        {hasActiveTrip ? "Tiếp tục chuyến đang học" : "Chuẩn bị lên tàu"} <span>→</span>
      </button>
      <small className="ticket-footnote">
        ♧ Đi một mình cũng là một hành trình đẹp.
      </small>
    </section>
  );
}

export const HomeTripForm = memo(HomeTripFormView);
