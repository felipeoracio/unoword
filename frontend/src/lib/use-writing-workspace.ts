import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet, apiPut, apiPost } from "./api";
import type { AuthUser } from "./auth-types";
import {
  cachePut,
  cacheDelete,
  loadWritingCache,
  cacheDeleteIfMutation,
  cacheRemoveDocuments,
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
  documentToReopen,
  FRESH_DOCUMENT,
  activitySnapshot,
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
  const [folders, setFolderState] = useState<Folder[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const localActivityIds = useRef(new Set<string>());
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Opening your writing space…");
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<Record<string, WritingDocument>>(
    {},
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [completionBusy, setCompletionBusy] = useState(false);
  const completionLock = useRef<string | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);
  const trashOperation = useRef(false);
  const trashLocks = useRef(new Set<string>());
  const completionAttempts = useRef(
    new Map<string, { revision: number; state: string; mutation: string }>(),
  );
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
  const lastRemoteRead = useRef(0);
  const folderRows = useRef<Folder[]>([]);
  const setFolders = useCallback((next: Folder[]) => {
    folderRows.current = next;
    setFolderState(next);
  }, []);
  const publish = useCallback((next: Draft[]) => {
    docs.current = next;
    setDocuments(next);
  }, []);
  const publishActivity = useCallback((next: Activity[]) => {
    activityRows.current = next;
    setActivities(next);
  }, []);
  const verifyAccess = useCallback(
    (writer: AuthUser) => {
      identity.current = writer;
      setUser(writer);
      localStorage.setItem(IDENTITY, JSON.stringify(writer));
      if (!writer.ai_access) {
        // Retain account-scoped IndexedDB drafts; a downgrade never deletes writing.
        publish([]);
        publishActivity([]);
        setFolders([]);
        setRecovery([]);
        setSelected(null);
        setConflicts({});
      }
      return writer.ai_access;
    },
    [publish, publishActivity, setFolders],
  );
  const recheckIdentity = useCallback(async () => {
    const owner = identity.current?.id;
    if (!owner) return;
    let changed = false;
    try {
      const verified = await currentWriter();
      changed = verified.id !== owner;
      if (!changed && identity.current?.id === owner) {
        const upgraded = !identity.current.ai_access && verified.ai_access;
        verifyAccess(verified);
        if (upgraded) window.location.reload();
      }
    } catch (failure) {
      changed = failure instanceof ApiError && failure.status === 401;
    }
    if (changed && identity.current?.id === owner) {
      localStorage.removeItem(IDENTITY);
      identity.current = null;
      setUser(null);
      publish([]);
      publishActivity([]);
      setRecovery([]);
      setSelected(null);
      setError(
        "Your account changed. Sign in again; your local draft is preserved.",
      );
    }
  }, [publish, publishActivity, verifyAccess]);
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
        completionLock.current === id ||
        trashLocks.current.has(id) ||
        current.content_loaded === false ||
        current.user_id !== identity.current?.id ||
        !identity.current?.ai_access
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
      if (!owner || !owner.ai_access) return;
      const draft = {
        ...newDocument(owner.id, tab, title),
        ...copy,
        completion_status: "draft" as const,
        completed_at: null,
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
      if (!owner || !owner.ai_access) return;
      localActivityIds.current.add(row.id);
      const next = { ...activitySnapshot(row), dirty: true };
      publishActivity([
        ...activityRows.current.filter((a) => a.id !== row.id),
        next,
      ]);
      pendingLocal.current++;
      try {
        await cachePut(owner.id, "activity", row.id, next);
        schedule();
      } catch {
        pendingLocal.current++;
        setError(
          "Writing statistics could not be stored locally. Keep this page open and retry.",
        );
      } finally {
        pendingLocal.current--;
      }
    },
    [publishActivity, schedule],
  );

  const createFolder = useCallback(
    async (name: string) => {
      const owner = identity.current;
      if (!owner?.ai_access) throw new Error("Pro access is required.");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Enter a folder name.");
      const folder: Folder = {
        id: crypto.randomUUID(),
        name: trimmed,
        dirty: true,
      };
      // Publish only after IndexedDB commits, so closing the dialog never loses it.
      await cachePut(owner.id, "folder", folder.id, folder);
      if (identity.current?.id !== owner.id || !identity.current?.ai_access)
        return;
      setFolders([...folderRows.current, folder]);
      schedule();
      return folder;
    },
    [setFolders, schedule],
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
      if (!identity.current?.ai_access && verified.ai_access) {
        verifyAccess(verified);
        window.location.reload();
        return;
      }
      if (!verifyAccess(verified)) return;
      // Folder UUIDs must exist remotely before document foreign keys reference them.
      for (const folder of [...folderRows.current]) {
        if (!folder.dirty) continue;
        const saved = await apiPut<Folder>(`/workspace/folders/${folder.id}`, {
          expected_user_id: owner,
          name: folder.name,
        });
        if (
          identity.current?.id !== owner ||
          !identity.current?.ai_access ||
          !active.current
        )
          return;
        setFolders(
          folderRows.current.map((f) => (f.id === folder.id ? saved : f)),
        );
        await cachePut(owner, "folders", "all", folderRows.current);
        await cacheDelete(owner, "folder", folder.id);
      }
      for (const draft of [...docs.current]) {
        if (!draft.dirty || conflictIds.current.has(draft.id)) continue;
        if (
          identity.current?.id !== owner ||
          !identity.current?.ai_access ||
          !active.current
        )
          return;
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
              ...(draft.completion_status
                ? { completion_status: draft.completion_status }
                : {}),
              ai_allowed: draft.ai_allowed,
            },
          );
          if (
            identity.current?.id !== owner ||
            !identity.current?.ai_access ||
            !active.current
          )
            return;
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
            if (
              identity.current?.id !== owner ||
              !identity.current?.ai_access ||
              !active.current
            )
              return;
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
        if (
          identity.current?.id !== owner ||
          !identity.current?.ai_access ||
          !active.current
        )
          return;
        await apiPut("/workspace/activity", {
          ...activitySnapshot(row),
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
      if (Date.now() - lastRemoteRead.current >= 12000) {
        const [remoteIndex, remoteFolders, remoteActivity] = await Promise.all([
          fetchDocumentIndex(),
          apiGet<Folder[]>("/workspace/folders"),
          fetchWritingActivity(),
        ]);
        if (
          identity.current?.id !== owner ||
          !identity.current.ai_access ||
          !active.current
        )
          return;
        const newlyCompleted = new Set(
          remoteIndex
            .filter(
              (remote) =>
                remote.completion_status === "completed" &&
                docs.current.some(
                  (local) =>
                    local.id === remote.id &&
                    local.completion_status !== "completed",
                ),
            )
            .map((d) => d.id),
        );
        const merged = new Map(
          remoteIndex.map((remote) => {
            const local = docs.current.find((d) => d.id === remote.id);
            if (local?.dirty || completionLock.current === remote.id)
              return [remote.id, local!];
            const full = remote.content
              ? remote
              : local?.revision === remote.revision &&
                  local.content_loaded !== false
                ? local
                : null;
            return [
              remote.id,
              {
                ...remote,
                content: full?.content || EMPTY_DOCUMENT,
                plain_text: full?.plain_text || "",
                dirty: false,
                tab_id: tab,
                content_loaded: Boolean(full),
              },
            ] as const;
          }),
        );
        for (const local of docs.current.filter((d) => d.dirty))
          merged.set(local.id, local);
        publish([...merged.values()]);
        // A completed document arriving from another device must not be reopened
        // automatically. Unsynchronized local edits remain in the conflict workflow.
        setSelected((id) => {
          const document = id ? merged.get(id) : null;
          if (
            document?.completion_status === "completed" &&
            !document.dirty &&
            newlyCompleted.has(document.id)
          ) {
            localStorage.setItem(
              `uno-writing-selected:${owner}`,
              FRESH_DOCUMENT,
            );
            return null;
          }
          return id && !merged.has(id) ? null : id;
        });
        const folderMap = new Map(remoteFolders.map((f) => [f.id, f]));
        folderRows.current
          .filter((f) => f.dirty)
          .forEach((f) => folderMap.set(f.id, f));
        setFolders([...folderMap.values()]);
        const activityMap = new Map(remoteActivity.map((a) => [a.id, a]));
        activityRows.current
          .filter((a) => a.dirty)
          .forEach((a) => activityMap.set(a.id, a));
        publishActivity([...activityMap.values()]);
        await cachePut(owner, "folders", "all", folderRows.current);
        await cachePut(owner, "activity_index", "all", remoteActivity);
        for (const document of merged.values())
          if (!document.dirty) {
            await cachePut(owner, "document", document.id, document);
          }
        lastRemoteRead.current = Date.now();
      }
      if (!conflictIds.current.size) {
        setError("");
        setStatus(
          docs.current.some((d) => d.dirty) ||
            activityRows.current.some((a) => a.dirty) ||
            folderRows.current.some((f) => f.dirty)
            ? "Saved on this device · syncing…"
            : "All changes saved",
        );
      }
    } catch (failure) {
      if (
        identity.current?.id !== owner ||
        !identity.current?.ai_access ||
        !active.current
      )
        return;
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
  }, [tab, publish, publishActivity, persist, verifyAccess, setFolders]);
  syncRef.current = sync;

  const changeCompletion = useCallback(
    async (id: string, state: "draft" | "completed") => {
      const owner = identity.current;
      if (!owner?.ai_access || completionLock.current || trashOperation.current)
        return false;
      if (!navigator.onLine) {
        setError(
          "Connect to the internet to confirm document completion. Your draft stays saved on this device.",
        );
        return false;
      }
      completionLock.current = id;
      setCompletionBusy(true);
      try {
        // Finish the existing autosave before changing status. Never claim success
        // for a local-only save, a failed save, a conflict, or an account switch.
        const deadline = Date.now() + 30000;
        while (syncing.current || pendingLocal.current) {
          if (Date.now() > deadline) throw new Error("save_pending");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await syncRef.current();
        const draft = docs.current.find((d) => d.id === id);
        if (
          !draft ||
          draft.dirty ||
          (draft.content_loaded === false && state === "completed") ||
          conflictIds.current.has(id) ||
          identity.current?.id !== owner.id
        )
          throw new Error("save_pending");
        const prior = completionAttempts.current.get(id);
        const attempt =
          prior?.revision === draft.revision && prior.state === state
            ? prior
            : {
                revision: draft.revision,
                state,
                mutation: crypto.randomUUID(),
              };
        completionAttempts.current.set(id, attempt);
        const saved = await apiPost<WritingDocument>(
          `/workspace/documents/${id}/completion`,
          {
            expected_user_id: owner.id,
            revision: draft.revision,
            mutation_id: attempt.mutation,
            completion_status: state,
          },
        );
        if (
          identity.current?.id !== owner.id ||
          !identity.current.ai_access ||
          !active.current
        )
          return false;
        if (
          saved.completion_status !== state ||
          (state === "completed" && !saved.completed_at)
        )
          throw new Error("completion_unconfirmed");
        await cachePut(owner.id, "document", saved.id, saved);
        publish(
          docs.current.map((d) =>
            d.id === id
              ? { ...saved, dirty: false, content_loaded: true, tab_id: tab }
              : d,
          ),
        );
        completionAttempts.current.delete(id);
        if (state === "completed") {
          localStorage.setItem(
            `uno-writing-selected:${owner.id}`,
            FRESH_DOCUMENT,
          );
          sessionStorage.removeItem(`uno-writing-selected:${owner.id}`);
          setSelected(null);
        }
        setError("");
        return true;
      } catch (failure) {
        setError(
          failure instanceof ApiError
            ? editorError(failure)
            : "Document status was not confirmed. Keep this page open, resolve any save errors, and try again.",
        );
        return false;
      } finally {
        completionLock.current = null;
        setCompletionBusy(false);
      }
    },
    [publish, tab],
  );

  const emptyTrash = useCallback(
    async (confirmedIds: string[]) => {
      const owner = identity.current;
      if (!owner?.ai_access || trashOperation.current || completionLock.current)
        return false;
      if (!navigator.onLine) {
        setError(
          "Connect to the internet to empty Trash. No documents were deleted.",
        );
        return false;
      }
      trashOperation.current = true;
      setTrashBusy(true);
      trashLocks.current = new Set(confirmedIds);
      try {
        const deadline = Date.now() + 30000;
        while (syncing.current || pendingLocal.current) {
          if (Date.now() > deadline) throw new Error("save_pending");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await syncRef.current();
        if (identity.current?.id !== owner.id || !identity.current.ai_access)
          throw new Error("account_changed");
        const snapshot = docs.current.filter(
          (d) => confirmedIds.includes(d.id) && d.status === "trashed",
        );
        if (
          snapshot.some(
            (d) => d.dirty || !d.revision || conflictIds.current.has(d.id),
          ) ||
          activityRows.current.some(
            (a) =>
              a.dirty && a.document_id && confirmedIds.includes(a.document_id),
          )
        )
          throw new Error("save_pending");
        let skipped = false;
        for (let offset = 0; offset < snapshot.length; offset += 1000) {
          const batch = snapshot.slice(offset, offset + 1000);
          const result = await apiPost<{
            removed_ids: string[];
            deleted_ids: string[];
            activities: Activity[];
          }>("/workspace/trash/empty", {
            expected_user_id: owner.id,
            confirm: true,
            documents: batch.map((d) => ({ id: d.id, revision: d.revision })),
          });
          if (identity.current?.id !== owner.id || !identity.current.ai_access)
            return false;
          const removed = new Set(result.removed_ids);
          await cacheRemoveDocuments(owner.id, result.removed_ids);
          publish(docs.current.filter((d) => !removed.has(d.id)));
          setRecovery((all) => all.filter((d) => !removed.has(d.id)));
          setSelected((id) => (id && removed.has(id) ? null : id));
          const changed = new Map(
            result.activities.map((a) => [a.id, activitySnapshot(a)]),
          );
          const activities = activityRows.current.map(
            (a) =>
              changed.get(a.id) ||
              (a.document_id && removed.has(a.document_id)
                ? { ...a, document_id: null, dirty: false }
                : a),
          );
          publishActivity(activities);
          for (const activity of activities.filter((a) => changed.has(a.id)))
            await cachePut(owner.id, "activity", activity.id, activity);
          await cachePut(owner.id, "activity_index", "all", activities);
          localStorage.setItem(
            `uno-writing-trash:${owner.id}`,
            JSON.stringify({ ids: result.removed_ids, at: Date.now() }),
          );
          skipped ||= result.removed_ids.length < batch.length;
        }
        setError(
          skipped
            ? "Some documents changed or were restored in another tab, so they were kept. Review Trash before trying again."
            : "",
        );
        return !skipped;
      } catch (failure) {
        setError(
          failure instanceof ApiError
            ? editorError(failure)
            : "Trash was not fully emptied. Resolve any pending saves and try again. Writing activity remains saved.",
        );
        return false;
      } finally {
        trashOperation.current = false;
        trashLocks.current.clear();
        setTrashBusy(false);
      }
    },
    [publish, publishActivity],
  );

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
    if (userId && !loading && user?.ai_access && selected)
      localStorage.setItem(`uno-writing-selected:${userId}`, selected);
  }, [userId, selected, loading, user?.ai_access]);

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
        if (
          cancelled ||
          identity.current?.id !== writer.id ||
          !identity.current?.ai_access
        )
          return;
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
        if (!verifyAccess(writer)) return;
        const cached = await loadWritingCache(writer.id, tab, predecessorTab);
        if (cancelled) return;
        for (const draft of cached.adopted) {
          const priorKey = `${predecessorTab}:${draft.id}`;
          adoptedSnapshots.current.set(priorKey, draft.mutation_id);
          await cachePut(writer.id, "draft", `${tab}:${draft.id}`, draft);
        }
        publish(cached.documents);
        setFolders(cached.folders);
        localActivityIds.current = new Set(cached.locallyCreatedActivityIds);
        publishActivity(cached.activities);
        setRecovery(cached.recovery);
        const previousSelection =
          localStorage.getItem(`uno-writing-selected:${writer.id}`) ??
          sessionStorage.getItem(`uno-writing-selected:${writer.id}`);
        setSelected(documentToReopen(cached.documents, previousSelection));
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
          if (
            cancelled ||
            identity.current?.id !== writer.id ||
            !identity.current?.ai_access
          )
            return;
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
          const mergedFolders = new Map(remoteFolders.map((f) => [f.id, f]));
          folderRows.current
            .filter((f) => f.dirty)
            .forEach((f) => mergedFolders.set(f.id, f));
          setFolders([...mergedFolders.values()]);
          await cachePut(writer.id, "activity_index", "all", remoteActivity);
          await cachePut(writer.id, "folders", "all", folderRows.current);
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
          setSelected((current) =>
            documentToReopen(
              [...merged.values()],
              current || previousSelection,
            ),
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
      lastRemoteRead.current = 0;
      void syncRef.current();
    };
    const regainFocus = () => {
      if (document.visibilityState === "visible") {
        lastRemoteRead.current = 0;
        void recheckIdentity();
        void syncRef.current();
      }
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
      if (
        identity.current &&
        event.key === `uno-writing-trash:${identity.current.id}` &&
        event.newValue
      ) {
        try {
          const removed = new Set<string>(JSON.parse(event.newValue).ids);
          publish(docs.current.filter((d) => !removed.has(d.id)));
          setSelected((id) => (id && removed.has(id) ? null : id));
          setError(
            "Trash was emptied in another tab. Any unsaved writing is available in Recovered drafts after reopening the editor.",
          );
        } catch {
          /* Ignore unrelated or malformed browser messages. */
        }
      }
      if (event.key === IDENTITY && event.newValue === null) {
        identity.current = null;
        setUser(null);
        publish([]);
        publishActivity([]);
        setRecovery([]);
        setSelected(null);
      }
    };
    window.addEventListener("focus", regainFocus);
    document.addEventListener("visibilitychange", regainFocus);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", offline);
    window.addEventListener("beforeunload", protect);
    window.addEventListener("storage", accountChanged);
    const retry = setInterval(() => {
      void syncRef.current();
    }, 15000);
    return () => {
      cancelled = true;
      active.current = false;
      clearInterval(retry);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("focus", regainFocus);
      document.removeEventListener("visibilitychange", regainFocus);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", offline);
      window.removeEventListener("beforeunload", protect);
      window.removeEventListener("storage", accountChanged);
    };
  }, [
    tab,
    publish,
    publishActivity,
    verifyAccess,
    recheckIdentity,
    setFolders,
  ]);

  return {
    user,
    loading,
    documents,
    folders,
    createFolder,
    activities,
    localActivityIds,
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
    recheckIdentity,
    completionBusy,
    changeCompletion,
    emptyTrash,
    trashBusy,
  };
}
