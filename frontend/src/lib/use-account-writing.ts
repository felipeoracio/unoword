import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiPut, ApiError } from "./api";

export type AccountWritingSummary = {
  user_id: string;
  reportingDate: string;
  timezone: string;
  lifetimeWordCount: number;
  dailyWordCount: number;
  dailyActiveWritingSeconds: number;
  lifetimeActiveWritingSeconds: number;
  dailyGoal: number;
  displayedStreak: number;
  updatedAt: string;
  sessions: {
    id: string;
    source: string;
    status: string;
    active_seconds: number;
  }[];
};
export type WritingPreferences = {
  user_id: string;
  revision: number;
  daily_goal: number;
  timezone: string | null;
  language: string;
  themes: string[] | null;
};
type PreferencePatch = Partial<
  Pick<WritingPreferences, "daily_goal" | "timezone" | "language" | "themes">
>;
export function formatWritingTime(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return `${Math.floor(n / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((n / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
}
export function useAccountWriting(
  owner: string | undefined,
  paid: boolean,
  timeZone: string,
  revision?: string,
) {
  const query = useQuery({
    queryKey: ["account-writing", owner, paid, timeZone],
    queryFn: async () => {
      const value = await apiGet<AccountWritingSummary>(
        "/progress/summary?timezone=" + encodeURIComponent(timeZone),
      );
      if (value.user_id !== owner) throw new Error("account_changed");
      return value;
    },
    enabled: Boolean(owner && navigator.onLine),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!owner || !navigator.onLine) return;
    const timer = setTimeout(() => void refetch(), 1500);
    return () => clearTimeout(timer);
  }, [revision, owner, refetch]);
  return query;
}
export function useWritingPreferences(
  owner: string | undefined,
  initial: { daily_goal: number; timezone: string; language: string },
) {
  const [value, setValue] = useState<WritingPreferences | null>(null),
    [status, setStatus] = useState("");
  const latest = useRef<WritingPreferences | null>(null),
    busy = useRef(false),
    identity = useRef(owner),
    defaults = useRef(initial);
  identity.current = owner;
  defaults.current = initial;
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  syncRef.current = async () => {
    if (!owner || busy.current || !navigator.onLine) return;
    busy.current = true;
    const key = "uno-writing-preferences-pending:" + owner;
    try {
      let remote = await apiGet<WritingPreferences>("/progress/preferences");
      if (identity.current !== owner || remote.user_id !== owner) return;
      const raw = localStorage.getItem(key);
      const pending = raw ? JSON.parse(raw) : null;
      const patch =
        pending?.patch || (remote.revision === 0 ? defaults.current : null);
      if (patch) {
        let conflicted = false;
        try {
          remote = await apiPut<WritingPreferences>("/progress/preferences", {
            expected_user_id: owner,
            revision: pending?.revision ?? remote.revision,
            ...patch,
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const detail = (
              error.body as { detail?: { current?: WritingPreferences } }
            )?.detail;
            if (!detail?.current) throw error;
            remote = detail.current;
            conflicted = true;
            setStatus(
              "Settings changed on another device. The latest account settings were kept; you can change them again.",
            );
          } else throw error;
        }
        if (identity.current !== owner) return;
        if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
        else if (!conflicted) {
          const newer = JSON.parse(localStorage.getItem(key) || "null");
          if (newer && newer.revision === (pending?.revision ?? 0)) {
            localStorage.setItem(
              key,
              JSON.stringify({ ...newer, revision: remote.revision }),
            );
            if (debounce.current) clearTimeout(debounce.current);
            debounce.current = setTimeout(() => void syncRef.current(), 500);
          }
        }
      }
      if (!localStorage.getItem(key)) {
        latest.current = remote;
        setValue(remote);
      }
      if (!localStorage.getItem(key))
        setStatus((current) =>
          current.startsWith("Settings changed") ? current : "",
        );
    } catch {
      if (identity.current === owner)
        setStatus("Settings saved on this device · pending sync");
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    latest.current = null;
    setValue(null);
    setStatus("");
    void syncRef.current();
    const refresh = () => void syncRef.current();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      if (debounce.current) clearTimeout(debounce.current);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [owner]);
  const change = (patch: PreferencePatch) => {
    if (!owner) return;
    const key = "uno-writing-preferences-pending:" + owner;
    const raw = localStorage.getItem(key),
      pending = raw ? JSON.parse(raw) : null;
    localStorage.setItem(
      key,
      JSON.stringify({
        revision: pending?.revision ?? latest.current?.revision ?? 0,
        patch: { ...pending?.patch, ...patch },
      }),
    );
    if (latest.current) {
      latest.current = { ...latest.current, ...patch };
      setValue(latest.current);
    }
    setStatus("Settings saved on this device · pending sync");
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void syncRef.current(), 500);
  };
  return { value, status, change };
}
