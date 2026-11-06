import { useState } from "react";
import { DurationPicker } from "./DurationPicker";

type TopicOption = { id: string; name: string };

export function StudyWorkspaceSettings({
  goal,
  topic,
  topics,
  fallbackTopic,
  minutes,
  breakCount,
  breakMinutes,
  goalDisabled,
  topicDisabled,
  durationLocked,
  breaksLocked,
  legacyDisclosure = false,
  legacyInitiallyOpen = false,
  onGoalChange,
  onTopicChange,
  onDurationChange,
  onBreakCountChange,
  onBreakMinutesChange,
}: {
  goal: string;
  topic: string;
  topics: readonly TopicOption[];
  fallbackTopic?: string;
  minutes: number;
  breakCount: number;
  breakMinutes: number;
  goalDisabled: boolean;
  topicDisabled: boolean;
  durationLocked: boolean;
  breaksLocked: boolean;
  legacyDisclosure?: boolean;
  legacyInitiallyOpen?: boolean;
  onGoalChange: (goal: string) => void;
  onTopicChange: (topic: string) => void;
  onDurationChange: (minutes: number) => void;
  onBreakCountChange: (count: number) => void;
  onBreakMinutesChange: (minutes: number) => void;
}) {
  const [legacyOpen, setLegacyOpen] = useState(legacyInitiallyOpen);
  const fields = <div className="study-workspace-settings">
    <label htmlFor="study-workspace-goal">
      Mục tiêu buổi học
      <textarea
        id="study-workspace-goal"
        value={goal}
        maxLength={500}
        disabled={goalDisabled}
        onChange={(event) => onGoalChange(event.target.value)}
        placeholder="Mình muốn hiểu điều gì sau buổi học này?"
      />
    </label>
    <label htmlFor="study-workspace-topic">
      Chủ đề
      <select id="study-workspace-topic" value={topic} disabled={topicDisabled}
        onChange={(event) => onTopicChange(event.target.value)}>
        {fallbackTopic && !topics.some((item) => item.id === fallbackTopic) &&
          <option value={fallbackTopic}>{fallbackTopic}</option>}
        {topics.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <DurationPicker
      value={minutes}
      onChange={onDurationChange}
      breakCount={breakCount}
      breakMinutes={breakMinutes}
      durationLocked={durationLocked}
      breaksLocked={breaksLocked}
      onBreakCountChange={onBreakCountChange}
      onBreakMinutesChange={onBreakMinutesChange}
    />
  </div>;
  if (!legacyDisclosure) return fields;
  return <details className="ticket-editor" open={legacyOpen}
    onToggle={(event) => setLegacyOpen(event.currentTarget.open)}>
    <summary>Chỉnh mục tiêu và thời gian</summary>
    {fields}
  </details>;
}
