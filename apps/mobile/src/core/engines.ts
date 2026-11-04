import type { Activity, Timer } from "./types";
// Exact engines used by the shipping extension and web editor, not a new counter.
const wordEngine = require("../../../../extension/shared/wordcount.js");
require("../../../../extension/shared/session-clock.js");
const dateEngine = require("../../../../extension/shared/dates.js");
require("../../../../extension/shared/prompts.js");
const scope = globalThis as any;
export const words = (
  wordEngine.countWords ? wordEngine : scope.WCWordCount
) as {
  countWords(s: string): number;
  classifyDelta(
    before: string,
    after: string,
    inputType: string,
  ): { kind: string; words: number } | null;
  applyDelta(
    state: { typedWords: number; pastedWords: number },
    delta: unknown,
  ): { typedWords: number; pastedWords: number };
};
export const clock = scope.WCSessionClock as {
  start(now?: number): Timer;
  read(timer?: Timer, now?: number): { active_ms: number; paused_ms: number };
  transition(timer: Timer, status: Timer["status"], now?: number): Timer;
  checkpoint(timer: Timer, now?: number): Timer;
  intervals(row: Activity, now?: number): [number, number][];
};
export const dates = (dateEngine.dayKey ? dateEngine : scope.WCDates) as {
  dayKey(at: number, timezone: string): string;
};
export const prompts = scope.WCPrompts as {
  pickPrompt(
    themes: string[],
    language: string,
    skip: string[],
  ): { id: string; text: string };
};
export function duration(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((n / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
}
