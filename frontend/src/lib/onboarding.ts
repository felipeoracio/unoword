import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPut } from "./api";
import { cachedRecords, cachePut } from "./writing-cache";
export type TourProgress = {
  version: 1;
  completed_once?: boolean;
  status: "not_started" | "in_progress" | "paused" | "completed";
  current_step: string;
  completed_actions: Record<string, boolean>;
  skipped_steps: string[];
  draft_id: string | null;
  words: number;
};
export const emptyTour = (): TourProgress => ({
  version: 1,
  status: "not_started",
  current_step: "welcome",
  completed_actions: {},
  skipped_steps: [],
  draft_id: null,
  words: 0,
});
export function mergeTour(
  remote: TourProgress,
  local: TourProgress,
): TourProgress {
  return {
    ...local,
    completed_once: Boolean(
      remote.completed_once ||
      local.completed_once ||
      remote.status === "completed" ||
      local.status === "completed",
    ),
    completed_actions: {
      ...remote.completed_actions,
      ...local.completed_actions,
      ...Object.fromEntries(
        Object.entries(remote.completed_actions).filter(([, v]) => v),
      ),
    },
    skipped_steps: [
      ...new Set([...remote.skipped_steps, ...local.skipped_steps]),
    ],
    words: Math.max(remote.words, local.words),
    draft_id: local.draft_id || remote.draft_id,
  };
}
// Cosmetic state is account scoped. Writing remains in the existing workspace cache.
export function useTourProgress(owner: string | undefined) {
  const [progress, setProgress] = useState<TourProgress | null>(null),
    [notice, setNotice] = useState("");
  const current = useRef<TourProgress | null>(null),
    pending = useRef(false),
    busy = useRef(false),
    generation = useRef(0);
  const sync = useCallback(async () => {
    if (
      !owner ||
      !navigator.onLine ||
      busy.current ||
      !pending.current ||
      !current.current
    )
      return;
    const epoch = generation.current,
      sent = current.current;
    busy.current = true;
    try {
      const result = await apiPut<TourProgress>("/onboarding", {
        ...sent,
        expected_user_id: owner,
      });
      if (generation.current !== epoch) return;
      if (current.current === sent) {
        current.current = result;
        setProgress(result);
        pending.current = false;
        await cachePut(owner, "tour", "v1", { value: result, dirty: false });
      }
      setNotice("");
    } catch {
      if (generation.current === epoch)
        setNotice(
          "Tour progress is saved on this device; account sync will retry.",
        );
    } finally {
      busy.current = false;
    }
  }, [owner]);
  useEffect(() => {
    let alive = true;
    generation.current++;
    current.current = null;
    pending.current = false;
    setProgress(null);
    if (!owner) return;
    void (async () => {
      let cached: { value: TourProgress; dirty: boolean } | undefined;
      try {
        cached = (await cachedRecords(owner)).find((r) => r.kind === "tour")
          ?.value as typeof cached;
      } catch {
        setNotice(
          "Device storage is unavailable. Keep this page open to retain your tour progress.",
        );
      }
      if (!alive) return;
      let value = cached?.value || emptyTour();
      pending.current = !!cached?.dirty;
      try {
        const remote = await apiGet<TourProgress>("/onboarding");
        if (!alive) return;
        value = cached?.dirty ? mergeTour(remote, value) : remote;
      } catch {
        if (!alive) return;
        setNotice("Using tour progress saved on this device.");
      }
      if (!alive) return;
      current.current = value;
      setProgress(value);
      if (pending.current) void sync();
    })();
    const online = () => void sync();
    window.addEventListener("online", online);
    const timer = setInterval(online, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [owner, sync]);
  const update = useCallback(
    (patch: Partial<TourProgress>) => {
      if (!owner || !current.current) return;
      const next = mergeTour(current.current, {
        ...current.current,
        ...patch,
        completed_actions: {
          ...current.current.completed_actions,
          ...patch.completed_actions,
        },
      });
      current.current = next;
      setProgress(next);
      pending.current = true;
      void cachePut(owner, "tour", "v1", { value: next, dirty: true })
        .then(() => sync())
        .catch(() =>
          setNotice(
            "Tour progress could not be saved on this device. Keep this page open.",
          ),
        );
    },
    [owner, sync],
  );
  return { progress, update, notice };
}
