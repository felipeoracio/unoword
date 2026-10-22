import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet, apiPut } from "./api";
import type { AuthUser } from "./auth-types";
import {
  cachePut,
  cacheDelete,
  loadWritingCache,
  cacheDeleteIfMutation,
} from "./writing-cache";
import {
  currentWriter,
  editorError,
  newDocument,
  type Draft,
  type WritingDocument,
  type Folder,
  type Activity,
  EMPTY_DOCUMENT,
  fetchDocumentIndex,
  fetchWritingActivity,
} from "./writing";

const IDENTITY = "uno-writing-identity";
// Chrome's Duplicate Tab clones sessionStorage. A fresh page identity keeps its
// offline draft separate; reloads adopt the previous page's pending draft.
const predecessorTab =
  typeof window === "undefined"
    ? null
    : sessionStorage.getItem("uno-writing-tab");
const pageTab = typeof window === "undefined" ? "" : crypto.randomUUID();
if (typeof window !== "undefined")
  sessionStorage.setItem("uno-writing-tab", pageTab);
export function useWritingWorkspace() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const userId = user?.id;
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Draft[]>([]);
  const [recovery, setRecovery] = useState<Draft[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Opening your writing space…");
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<Record<string, WritingDocument>>(
    {},
  );
  const [online, setOnline] = useState(navigator.onLine);
  const tab = pageTab;
  const adoptedSnapshots = useRef<Map<string, string>>(new Map());
  const docs = useRef<Draft[]>([]),
    activityRows = useRef<Activity[]>([]),
    identity = useRef<AuthUser | null>(null);
  const conflictIds = useRef(new Set<string>()),
    syncing = useRef(false),
    pendingLocal = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    active = useRef(true);
  const syncRef = useRef<() => Promise<void>>(async () => {});
  const publish = useCallback((next: Draft[]) => {
    docs.current = next;
    setDocuments(next);
  }, []);
  const publishActivity = useCallback((next: Activity[]) => {
    activityRows.current = next;
    setActivities(next);
  }, []);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void syncRef.current();
    }, 1000);
  }, []);

  const persist = useCallback(
    async (draft: Draft) => {
      pendingLocal.current++;
      setStatus("Saving on this device…");
      try {
        await cachePut(draft.user_id, "draft", `${tab}:${draft.id}`, draft);
        if (identity.current?.id === draft.user_id) {
          setStatus(
            navigator.onLine
              ? "Saved on this device · syncing…"
              : "Saved on this device · offline",
          );
          schedule();
        }
      } catch {
        setError(
          "Device storage is unavailable or full. Keep this page open and export a copy before closing it.",
        );
        setStatus("Not saved on this device");
        // Keep the beforeunload protection if local persistence failed.
        pendingLocal.current++;
      } finally {
        pendingLocal.current--;
      }
    },
    [tab, schedule],
  );

  const update = useCallback(
    (id: string, patch: Partial<Draft>) => {
      const current = docs.current.find((d) => d.id === id);
      if (
        !current ||
        current.content_loaded === false ||
        current.user_id !== identity.current?.id
      )
        return;
      const next = {
        ...current,
        ...patch,
        id: current.id,
        user_id: current.user_id,
        tab_id: tab,
        mutation_id: crypto.randomUUID(),
        updated_at: new Date().toISOString(),
        dirty: true,
      };
      publish(docs.current.map((d) => (d.id === id ? next : d)));
      void persist(next);
    },
    [tab, persist, publish],
  );

  const create = useCallback(
    async (title?: string, copy?: Partial<Draft>) => {
      const owner = identity.current;
      if (!owner) return;
      const draft = {
        ...newDocument(owner.id, tab, title),
        ...copy,
        id: crypto.randomUUID(),
        user_id: owner.id,
        tab_id: tab,
        revision: 0,
        mutation_id: crypto.randomUUID(),
        dirty: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      publish([draft, ...docs.current]);
      setSelected(draft.id);
      await persist(draft);
      return draft;
    },
    [tab, publish, persist],
  );

  const recordActivity = useCallback(
    async (row: Activity) => {
      const owner = identity.current;
      if (!owner) return;
      const next = { ...row, dirty: true };
      publishActivity([
        ...activityRows.current.filter((a) => a.id !== row.id),
        next,
      ]);
      try {
        await cachePut(owner.id, "activity", row.id, next);
        schedule();
      } catch {
        setError(
          "Writing statistics could not be stored locally. Keep this page open and retry.",
        );
      }
    },
    [publishActivity, schedule],
  );

  const sync = useCallback(async () => {
    if (
      syncing.current ||
      !navigator.onLine ||
      !identity.current ||
      !active.current
    )
      return;
    syncing.current = true;
    const owner = identity.current.id;
    try {
      const verified = await currentWriter();
      if (verified.id !== owner || identity.current?.id !== owner)
        throw new ApiError(409, { detail: "account_changed" });
      setUser(verified);
      identity.current = verified;
      for (const draft of [...docs.current]) {
        if (!draft.dirty || conflictIds.current.has(draft.id)) continue;
        if (identity.current?.id !== owner || !active.current) return;
        setStatus("Saving to your account…");
        try {
          const saved = await apiPut<WritingDocument>(
            `/workspace/documents/${draft.id}`,
            {
              expected_user_id: owner,
              revision: draft.revision,
              mutation_id: draft.mutation_id,
              title: draft.title.trim() || "Untitled",
              content: draft.content,
              folder_id: draft.folder_id,
              favorite: draft.favorite,
              status: draft.status,
              ai_allowed: draft.ai_allowed,
            },
          );
          if (identity.current?.id !== owner || !active.current) return;
          await cachePut(owner, "document", saved.id, saved);
          const latest = docs.current.find((d) => d.id === saved.id);
          if (!latest) continue;
          const next =
            latest.mutation_id === draft.mutation_id
              ? { ...saved, tab_id: tab, dirty: false, content_loaded: true }
              : { ...latest, revision: saved.revision };
          publish(docs.current.map((d) => (d.id === next.id ? next : d)));
          if (next.dirty) await persist(next);
          else
            await cacheDeleteIfMutation(
              owner,
              "draft",
              `${tab}:${saved.id}`,
              draft.mutation_id,
            );
          // Remove a predecessor only when that exact mutation is on the server.
          // A cloned tab may have diverged; its original draft must survive.
          for (const [key, mutation] of adoptedSnapshots.current) {
            if (!key.endsWith(`:${saved.id}`)) continue;
            if (mutation === saved.mutation_id)
              await cacheDeleteIfMutation(owner, "draft", key, mutation);
            adoptedSnapshots.current.delete(key);
          }
        } catch (failure) {
          if (failure instanceof ApiError && failure.status === 409) {
            const remote = await apiGet<WritingDocument>(
              `/workspace/documents/${draft.id}`,
            );
            if (identity.current?.id !== owner || !active.current) return;
            conflictIds.current.add(draft.id);
            setConflicts((all) => ({ ...all, [draft.id]: remote }));
            setError(
              "This document changed elsewhere. Compare versions or keep your edits as a separate copy.",
            );
            continue;
          }
          throw failure;
        }
      }
      for (const row of [...activityRows.current]) {
        if (
          !row.dirty ||
          !docs.current.some((d) => d.id === row.document_id && d.revision > 0)
        )
          continue;
        if (identity.current?.id !== owner || !active.current) return;
        const { dirty: _, ...body } = row;
        await apiPut("/workspace/activity", {
          ...body,
          expected_user_id: owner,
        });
        const latest = activityRows.current.find((a) => a.id === row.id);
        if (latest?.sequence === row.sequence) {
          const saved = { ...row, dirty: false };
          publishActivity(
            activityRows.current.map((a) => (a.id === row.id ? saved : a)),
          );
          await cachePut(owner, "activity", row.id, saved);
        }
        window.postMessage(
          { type: "UNO_WORD_ACTIVITY_SAVED" },
          location.origin,
        );
      }
      if (!conflictIds.current.size) {
        setError("");
        setStatus(
          docs.current.some((d) => d.dirty)
            ? "Saved on this device · syncing…"
            : "All changes saved",
        );
      }
    } catch (failure) {
      if (identity.current?.id !== owner || !active.current) return;
      if (
        failure instanceof ApiError &&
        (failure.status === 401 ||
          (failure.body as { detail?: string })?.detail === "account_changed")
      ) {
        localStorage.removeItem(IDENTITY);
        identity.current = null;
        setUser(null);
        publish([]);
        publishActivity([]);
        setSelected(null);
      }
      setError(editorError(failure));
      setStatus("Saved on this device · sync paused");
    } finally {
      syncing.current = false;
      // Edits arriving during a network save get another pass, without polling
      // endlessly when the network or backend is unavailable.
    }
  }, [tab, publish, publishActivity, persist]);
  syncRef.current = sync;

  const resolveConflict = useCallback(
    async (id: string, keepLocal: boolean) => {
      const local = docs.current.find((d) => d.id === id),
        remote = conflicts[id];
      if (!local || !remote || !identity.current) return;
      if (keepLocal)
        await create(`${local.title} (recovered copy)`, {
          content: local.content,
          plain_text: local.plain_text,
          folder_id: local.folder_id,
        });
      const clean = { ...remote, tab_id: tab, dirty: false };
      publish(docs.current.map((d) => (d.id === id ? clean : d)));
      await cachePut(identity.current.id, "document", id, remote);
      await cacheDelete(identity.current.id, "draft", `${tab}:${id}`);
      conflictIds.current.delete(id);
      setConflicts((all) => {
        const next = { ...all };
        delete next[id];
        return next;
      });
      setError("");
      schedule();
    },
    [conflicts, create, publish, tab, schedule],
  );

  useEffect(() => {
    if (userId && selected)
      sessionStorage.setItem(`uno-writing-selected:${userId}`, selected);
  }, [userId, selected]);

  const selectedLoaded = documents.find(
    (document) => document.id === selected,
  )?.content_loaded;
  useEffect(() => {
    const writer = identity.current,
      draft = docs.current.find((document) => document.id === selected);
    if (!writer || !draft || draft.content_loaded !== false) return;
    let cancelled = false;
    if (!navigator.onLine) {
      setError("Open this document online once to make it available offline.");
      return;
    }
    setStatus("Opening document…");
    apiGet<WritingDocument>(`/workspace/documents/${draft.id}`)
      .then(async (saved) => {
        if (cancelled || identity.current?.id !== writer.id) return;
        publish(
          docs.current.map((document) =>
            document.id === saved.id && !document.dirty
              ? { ...saved, dirty: false, tab_id: tab, content_loaded: true }
              : document,
          ),
        );
        await cachePut(writer.id, "document", saved.id, saved);
        setStatus("All changes saved");
      })
      .catch((failure) => {
        if (!cancelled) setError(editorError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, user?.id, selectedLoaded, publish, tab]);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    async function boot() {
      try {
        let writer: AuthUser;
        try {
          writer = await currentWriter();
        } catch (failure) {
          const cached = localStorage.getItem(IDENTITY);
          if (!navigator.onLine && cached && !(failure instanceof ApiError))
            writer = JSON.parse(cached);
          else throw failure;
        }
        if (cancelled) return;
        identity.current = writer;
        setUser(writer);
        localStorage.setItem(IDENTITY, JSON.stringify(writer));
        const cached = await loadWritingCache(writer.id, tab, predecessorTab);
        if (cancelled) return;
        for (const draft of cached.adopted) {
          const priorKey = `${predecessorTab}:${draft.id}`;
          adoptedSnapshots.current.set(priorKey, draft.mutation_id);
          await cachePut(writer.id, "draft", `${tab}:${draft.id}`, draft);
        }
        publish(cached.documents);
        setFolders(cached.folders);
        publishActivity(cached.activities);
        setRecovery(cached.recovery);
        const previousSelection = sessionStorage.getItem(
          `uno-writing-selected:${writer.id}`,
        );
        setSelected(
          cached.documents.find((d) => d.id === previousSelection)?.id ||
            cached.documents.find((d) => d.status === "active")?.id ||
            cached.documents[0]?.id ||
            null,
        );
        setStatus(
          navigator.onLine
            ? "Saved on this device"
            : "Offline · writing stays on this device",
        );
        if (navigator.onLine) {
          const [remote, remoteFolders, remoteActivity] = await Promise.all([
            fetchDocumentIndex(),
            apiGet<Folder[]>("/workspace/folders"),
            fetchWritingActivity(),
          ]);
          if (cancelled || identity.current?.id !== writer.id) return;
          const merged = new Map<string, Draft>(
            remote.map((d) => {
              const cached = docs.current.find(
                (previous) =>
                  previous.id === d.id &&
                  previous.revision === d.revision &&
                  previous.content_loaded !== false,
              );
              const full = d.content ? d : cached;
              return [
                d.id,
                {
                  ...d,
                  content: full?.content || EMPTY_DOCUMENT,
                  plain_text: full?.plain_text || "",
                  tab_id: tab,
                  dirty: false,
                  content_loaded: Boolean(full),
                },
              ];
            }),
          );
          docs.current
            .filter((d) => d.dirty)
            .forEach((d) => merged.set(d.id, d));
          publish([...merged.values()]);
          setFolders(remoteFolders);
          await cachePut(writer.id, "activity_index", "all", remoteActivity);
          await cachePut(writer.id, "folders", "all", remoteFolders);
          const combined = new Map(remoteActivity.map((a) => [a.id, a]));
          activityRows.current
            .filter((a) => a.dirty)
            .forEach((a) => combined.set(a.id, a));
          publishActivity([...combined.values()]);
          await Promise.all(
            remote
              .filter((d) => Boolean(d.content))
              .map((d) => cachePut(writer.id, "document", d.id, d)),
          );
          setSelected(
            (current) =>
              current ||
              remote.find((d) => d.id === previousSelection)?.id ||
              remote.find((d) => d.status === "active")?.id ||
              null,
          );
        }
        await syncRef.current();
      } catch (failure) {
        if (failure instanceof ApiError && failure.status === 401) {
          localStorage.removeItem(IDENTITY);
          setUser(null);
        } else setError(editorError(failure));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    const reconnect = () => {
      setOnline(true);
      void syncRef.current();
    };
    const offline = () => {
      setOnline(false);
      setStatus("Offline · saved on this device");
    };
    const protect = (event: BeforeUnloadEvent) => {
      if (pendingLocal.current > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const accountChanged = (event: StorageEvent) => {
      if (event.key === IDENTITY && event.newValue === null) {
        identity.current = null;
        setUser(null);
        publish([]);
        publishActivity([]);
        setRecovery([]);
        setSelected(null);
      }
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", protect);
    window.addEventListener("storage", accountChanged);
    const retry = setInterval(() => {
      void syncRef.current();
    }, 30000);
    return () => {
      cancelled = true;
      active.current = false;
      clearInterval(retry);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", protect);
      window.removeEventListener("storage", accountChanged);
    };
  }, [tab, publish, publishActivity]);

  return {
    user,
    loading,
    documents,
    folders,
    setFolders,
    activities,
    selected,
    setSelected,
    status,
    error,
    setError,
    conflicts,
    resolveConflict,
    recovery,
    setRecovery,
    online,
    create,
    update,
    sync,
    recordActivity,
  };
}
