import type { ActiveTrip } from "./focus";
import {
  emptyWorld,
  type Snapshot,
  type World,
  type Session,
} from "../../backend/src/adventure/domain";
export type Saved = {
  active: ActiveTrip | null;
  pending: Session[];
  snapshot: Snapshot | null;
  local: World;
  notes: Record<string, string>;
  materials?: Record<string, NonNullable<ActiveTrip["materials"]>>;
};
export const emptySaved = (): Saved => ({
  active: null,
  pending: [],
  snapshot: null,
  local: emptyWorld(),
  notes: {},
  materials: {},
});
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const texts = (v: unknown) => Array.isArray(v) && v.every((item) => typeof item === "string");
const validMaterials = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 10 &&
  v.every((file) => record(file) && number(file.size) &&
    [file.name, file.type, file.status, file.message].every((field) => typeof field === "string")));
function validJourney(v: unknown) {
  return record(v) && [v.seconds, v.station, v.threshold, v.remaining].every(number) &&
    (v.branch === "mountain" || v.branch === "coast") && record(v.votes) &&
    (v.voteUntil === null || number(v.voteUntil)) && Array.isArray(v.journal) &&
    v.journal.every((item) => record(item) && number(item.at) && typeof item.text === "string");
}
function validPerson(v: unknown) {
  return record(v) && typeof v.name === "string" && typeof v.color === "string" &&
    typeof v.decor === "string" && number(v.seconds) && validJourney(v.journey);
}
function validSegments(v: unknown) {
  return Array.isArray(v) && v.every((s) => record(s) && number(s.start) &&
    number(s.end) && Number(s.end) > Number(s.start) &&
    ["focus", "material", "break", "distraction"].includes(String(s.kind)));
}
function validSession(v: unknown) {
  return record(v) && typeof v.id === "string" && typeof v.userId === "string" &&
    typeof v.goal === "string" && typeof v.topic === "string" &&
    (v.distractions === undefined || count(v.distractions)) &&
    [v.started, v.ended, v.target, v.seconds, v.contribution].every(number) && validSegments(v.segments);
}
function validSaved(v: unknown): v is Saved {
  if (!record(v) || !record(v.local) || !record(v.notes) ||
      (v.materials !== undefined && (!record(v.materials) || !Object.values(v.materials).every(validMaterials))) ||
      !Object.values(v.notes).every((note) => typeof note === "string") ||
      !Array.isArray(v.pending) || !v.pending.every(validSession)) return false;
  const w = v.local;
  if (![w.people, w.groups, w.sessions, w.invites].every(record) ||
      !Object.values(w.people as Record<string, unknown>).every(validPerson) ||
      !Object.values(w.sessions as Record<string, unknown>).every(validSession)) return false;
  if (v.active !== null) {
    const a = v.active;
    if (!record(a) || ![a.started, a.lastAt, a.target, a.reconnect].every(number) ||
        Number(a.target) <= 0 || ![a.id, a.owner, a.goal, a.topic, a.document].every((s) => typeof s === "string") ||
        !["focus", "away", "reconnecting", "paused", "pending"].includes(String(a.state)) ||
        (a.distractions !== undefined && !count(a.distractions)) ||
        !validSegments(a.segments) || !validMaterials(a.materials)) return false;
  }
  if (v.snapshot !== null) {
    const s = v.snapshot;
    if (!record(s) || !validPerson(s.person) || !Array.isArray(s.sessions) || !s.sessions.every(validSession)) return false;
    if (s.group !== null && (!record(s.group) || !validJourney(s.group.journey) ||
        !Array.isArray(s.group.members) || !s.group.members.every((m) => record(m) &&
          [m.id, m.name, m.color, m.decor].every((x) => typeof x === "string")))) return false;
  }
  return Object.values(w.groups as Record<string, unknown>).every((g) => record(g) && validJourney(g.journey) && texts(g.members));
}
export function readSaved(owner: string): Saved {
  const raw = localStorage.getItem(`train-adventure:v1:${owner}`);
  if (!raw) return emptySaved();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { value = null; }
  if (!validSaved(value))
    throw new Error(
      "Dữ liệu đã lưu không hợp lệ. Hãy xuất bản sao trước khi xóa dữ liệu trình duyệt.",
    );
  return value;
}
export function writeSaved(owner: string, value: Saved) {
  localStorage.setItem(`train-adventure:v1:${owner}`, JSON.stringify(value));
}
