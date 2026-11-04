import { clock, dates, words } from "./engines";
import type { Activity } from "./types";
export const IDLE_MS = 5 * 60 * 1000;
export function newActivity(
  documentId: string,
  device: string,
  uuid: () => string,
  now = Date.now(),
): Activity {
  return {
    id: uuid(),
    document_id: documentId,
    device_id: device,
    started_at: new Date(now).toISOString(),
    typed_words: 0,
    pasted_words: 0,
    duration_seconds: 0,
    sequence: 1,
    active_intervals: [],
    timer: clock.start(now),
    dirty: true,
    last_input_at: now,
  };
}
export function checkpoint(row: Activity, now = Date.now()): Activity {
  let timer = row.timer;
  if (
    timer.status === "active" &&
    now - (row.last_input_at ?? timer.changed_at) >= IDLE_MS
  )
    timer = clock.transition(
      timer,
      "paused",
      (row.last_input_at ?? timer.changed_at) + IDLE_MS,
    );
  const ranges = clock.intervals({ ...row, timer }, now);
  const saved = clock.checkpoint(timer, now);
  return {
    ...row,
    timer: saved,
    active_intervals: ranges,
    duration_seconds: Math.min(
      86400,
      Math.floor(clock.read(saved, now).active_ms / 1000),
    ),
    sequence: row.sequence + 1,
    dirty: true,
  };
}
export function transition(
  row: Activity,
  status: Activity["timer"]["status"],
  now = Date.now(),
): Activity {
  const saved = checkpoint(row, now);
  return checkpoint(
    {
      ...saved,
      timer: clock.transition(saved.timer, status, now),
      last_input_at: status === "active" ? now : row.last_input_at,
    },
    now,
  );
}
export function restoreActivity(row: Activity): Activity {
  // No background/closed-app gap is counted, even if the OS killed us abruptly.
  return row.timer.status === "active"
    ? {
        ...row,
        timer: clock.transition(row.timer, "paused", row.timer.changed_at),
        dirty: true,
        sequence: row.sequence + 1,
      }
    : row;
}
export function applyInput(
  row: Activity,
  before: string,
  after: string,
  inputType: string,
  now = Date.now(),
): Activity {
  if (row.timer.status !== "active") return row;
  const delta = words.classifyDelta(before, after, inputType);
  const next = words.applyDelta(
    { typedWords: row.typed_words, pastedWords: row.pasted_words },
    delta,
  );
  return {
    ...row,
    typed_words: next.typedWords,
    pasted_words: next.pastedWords,
    sequence: row.sequence + 1,
    dirty: true,
    last_input_at: now,
  };
}
export function crossesDay(row: Activity, timezone: string, now = Date.now()) {
  return (
    dates.dayKey(Date.parse(row.started_at), timezone) !==
    dates.dayKey(now, timezone)
  );
}
