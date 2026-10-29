// Use the extension's exact tokenizer/reducer instead of a second word counter.
import "../../../extension/shared/wordcount.js";
import "../../../extension/shared/history.js";
import "../../../extension/shared/dates.js";
import "../../../extension/shared/writing-progress.js";
import "../../../extension/shared/prompts.js";
import type { JSONContent } from "@tiptap/react";
import { apiGet, apiPost, ApiError } from "./api";
import type { AuthUser } from "./auth-types";

export type Delta = {
  kind: "typed" | "pasted" | "deleted";
  words: number;
} | null;
export const writingEngine = (
  globalThis as unknown as {
    WCWordCount: {
      countWords(text: string): number;
      classifyDelta(before: string, after: string, input: string): Delta;
      applyDelta(
        state: { typedWords: number; pastedWords: number },
        delta: Delta,
      ): { typedWords: number; pastedWords: number };
    };
  }
).WCWordCount;
export const writingDates = (
  globalThis as unknown as {
    WCDates: { dayKey(at: number, timezone?: string): string };
  }
).WCDates;
export const writingHistory = (
  globalThis as unknown as {
    WCHistory: {
      computeStreak(
        history: { typedWords: number; startedAt: number }[],
        timezone?: string,
        now?: number,
      ): number;
    };
  }
).WCHistory;
export const prompts = (
  globalThis as unknown as {
    WCPrompts: {
      pickPrompt(
        themes: string[],
        language: string,
        skip: string[],
      ): { id: string; text: string };
    };
  }
).WCPrompts;

export const EMPTY_DOCUMENT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
export type WritingDocument = {
  id: string;
  user_id: string;
  title: string;
  content: JSONContent;
  plain_text: string;
  folder_id: string | null;
  favorite: boolean;
  status: "active" | "archived" | "trashed";
  ai_allowed: boolean;
  revision: number;
  mutation_id: string;
  created_at: string;
  updated_at: string;
};
export async function fetchDocumentIndex(
  query = "",
): Promise<WritingDocument[]> {
  const all: WritingDocument[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await apiGet<WritingDocument[]>(
      `/workspace/documents?offset=${offset}${query ? "&q=" + encodeURIComponent(query) : ""}`,
    );
    all.push(...page);
    if (page.length < 200) return all;
  }
}
export type Draft = WritingDocument & {
  dirty: boolean;
  tab_id: string;
  content_loaded?: boolean;
};
export type Folder = { id: string; name: string; dirty?: boolean };
export type Activity = {
  id: string;
  document_id: string;
  started_at: string;
  typed_words: number;
  pasted_words: number;
  duration_seconds: number;
  sequence: number;
  dirty?: boolean;
};
export type AssistantItem = {
  writing_task?: WritingTask;
  id?: string;
  title: string;
  text: string;

};
export type WritingTask = {
  daily_goal: number | null; words_written_today: number; remaining_words: number | null;
  target_words: number; goal_reached: boolean; timezone: string; date: string;
  outline: { title: string; words: number }[];
};
export const writingProgress = (globalThis as unknown as {
  WCWritingProgress: {
    total(sessions: {id: string; startedAt: number; typedWords: number}[], now: number, timezone: string): number;
    snapshot(goal: number, written: number, timezone: string, now?: number): unknown;
  };
}).WCWritingProgress;
export async function fetchWritingActivity(): Promise<Activity[]> {
  const all: Activity[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await apiGet<Activity[]>(
      `/workspace/activity?offset=${offset}`,
    );
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

export async function currentWriter(): Promise<AuthUser> {
  try {
    return await apiGet<AuthUser>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await apiPost("/auth/refresh");
    return apiGet<AuthUser>("/auth/me");
  }
}

export function newDocument(
  owner: string,
  tab: string,
  title = "Untitled",
  content = EMPTY_DOCUMENT,
): Draft {
  return {
    id: crypto.randomUUID(),
    user_id: owner,
    title,
    content,
    plain_text: "",
    folder_id: null,
    favorite: false,
    status: "active",
    ai_allowed: false,
    revision: 0,
    mutation_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dirty: true,
    content_loaded: true,
    tab_id: tab,
  };
}

export function editorError(error: unknown): string {
  if (error instanceof ApiError) {
    const code = (error.body as { detail?: unknown })?.detail;
    if (typeof code === "string" && code.startsWith("ai_limit_"))
      return "This AI allowance is used up for the current period. Check Your AI Usage for reset times. Quick Prompt is still available.";
    if (typeof code === "string" && code.startsWith("ai_request_"))
      return "This request is already running, completed, or changed. Reopen saved ideas or retry after it finishes.";
    if (code === "writing_progress_stale")
      return "Your writing day changed or progress is out of date. Refresh progress and generate again.";
    if (code === "account_changed")
      return "Your account changed. Sign in again to continue; your local draft is preserved.";
    if (
      code === "ai_provider_unavailable" ||
      code === "ai_limit_not_configured"
    )
      return "AI assistance is not configured yet. You can keep writing and use Quick Prompt.";
    if (code === "ai_assistance_unavailable" || code === "ai_usage_unavailable")
      return "AI assistance is temporarily unavailable. Please try again later.";
    if (code === "invalid_import_file" || code === "unsupported_import_format")
      return "Choose a valid TXT, Markdown or DOCX file, up to 5 MB.";
    if (error.status === 401)
      return "Your session expired. Sign in again; your local draft is preserved.";
    if (error.status === 403)
      return "This action needs Pro access or a fresh sign-in.";
    if (error.status === 409)
      return "A newer version exists. Your edits are preserved for comparison.";
    if (error.status === 429)
      return "Your AI allowance has been reached. Your writing is saved.";
    if (error.status === 413) return "This document or upload is too large.";
    const detail = (error.body as { detail?: unknown })?.detail;
    if (detail === "workspace_storage_unavailable")
      return "Cloud saving is unavailable. Your draft is on this device; retry when the workspace database is configured.";

    if (detail === "document_ai_consent_required")
      return "Choose whether to share this draft for this AI request.";
  }
  return "Could not connect. Your local draft is preserved. Please retry.";
}
