export type JSONNode = {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
  content?: JSONNode[];
};
export type Account = {
  id: string;
  email?: string;
  plan: string | null;
  ai_access: boolean;
  features: Record<string, boolean>;
};
export type Preferences = {
  user_id: string;
  revision: number;
  daily_goal: number;
  timezone: string | null;
  language: "en" | "es";
  themes: string[] | null;
};
export type Timer = {
  status: "active" | "paused" | "ended";
  active_ms: number;
  paused_ms: number;
  changed_at: number;
};
export type Activity = {
  id: string;
  document_id: string;
  started_at: string;
  typed_words: number;
  pasted_words: number;
  duration_seconds: number;
  sequence: number;
  device_id: string;
  active_intervals: [number, number][];
  timer: Timer;
  dirty?: boolean;
  last_input_at?: number;
};
export type Summary = {
  user_id: string;
  reportingDate: string;
  timezone: string;
  dailyWordCount: number;
  lifetimeWordCount: number;
  dailyActiveWritingSeconds: number;
  lifetimeActiveWritingSeconds: number;
  dailyGoal: number;
  dailyGoalProgress: number;
  displayedStreak: number;
  streakLimitReached?: boolean;
  longestStreak?: number;
  milestones?: number[];
  sessions: {
    id: string;
    source: string;
    status: string;
    active_seconds: number;
    document_id?: string;
  }[];
  updatedAt: string;
};
export type Document = {
  id: string;
  user_id: string;
  title: string;
  content: JSONNode;
  plain_text: string;
  folder_id: string | null;
  favorite: boolean;
  status: "active" | "archived" | "trashed";
  completion_status: "draft" | "completed";
  completed_at: string | null;
  ai_allowed: boolean;
  revision: number;
  mutation_id: string;
  created_at: string;
  updated_at: string;
};
export type Draft = Document & {
  dirty: boolean;
  local_version: number;
  conflict?: Document;
  error?: string;
};
export type DocumentIndex = Omit<Document, "content" | "plain_text"> & {
  dirty?: boolean;
  conflict?: boolean;
};
export type Folder = {
  id: string;
  user_id: string;
  name: string;
  dirty?: boolean;
};
export type Usage = {
  user_id: string;
  version_name: string;
  legacy_shared: boolean;
  remaining: number;
  daily_limit: number;
  used_today: number;
  suggestions_monthly_limit: number | null;
  suggestions_monthly_remaining: number | null;
  guidance_monthly_limit: number | null;
  guidance_monthly_remaining: number | null;
  daily_reset_at: string;
  monthly_reset_at: string;
};
export type WritingTask = {
  target_words: number;
  goal_reached: boolean;
  outline: { title: string; words: number }[];
};
export type Suggestion = {
  id: string;
  title: string;
  suggestion: string;
  questions: string[];
  reason: string;
  inspired_by?: { title: string }[];
  writing_task?: WritingTask;
};
export type Statistics = {
  totalWords: number;
  sessionCount: number;
  activeWritingSeconds: number;
  buckets: {
    key: string;
    label: string;
    words: number;
    activeWritingSeconds: number;
  }[];
};
export type Store = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};
export type Transport = <T>(
  method: string,
  path: string,
  body?: unknown,
) => Promise<T>;
