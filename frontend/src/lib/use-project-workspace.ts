import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost, apiPut, ApiError } from "./api";
import {
  cachePut,
  cachedRecords,
  cacheDeleteIfMutation,
} from "./writing-cache";
import {
  recoverProjectCaches,
  validateProject,
  applyProjectOperation,
  projectIds,
  type Project,
  type ProjectOperation,
  type ProjectState,
  type ResourceKind,
  type Resource,
} from "../../../shared/projects";
export * from "../../../shared/projects";
const ROOT = "/workspace/projects";
type Cache = {
  server: ProjectState;
  pending: ProjectOperation[];
  mutation_id: string;
};
export function useProjectWorkspace(
  owner: string | undefined,
  enabled: boolean,
  online: boolean,
  beforeSync?: () => Promise<boolean>,
) {
  const [state, setState] = useState<ProjectState | null>(null),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [pending, setPending] = useState(0),
    [conflict, setConflict] = useState<ProjectOperation | null>(null),
    [catalog, setCatalog] = useState<Resource[]>([]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const tab = useRef(
    sessionStorage.getItem("uno-writing-tab") || crypto.randomUUID(),
  );
  const cached = useRef<Cache | null>(null),
    local = useRef<ProjectState | null>(null),
    running = useRef<string | null>(null),
    syncRef = useRef<() => Promise<boolean>>(async () => false),
    prepare = useRef(beforeSync),
    serial = useRef(Promise.resolve());
  prepare.current = beforeSync;
  const adopted = useRef<{id:string;stamp:string}[]>([]);
  const persist = useCallback(async (value: Cache) => {
    const id = currentOwner.current;
    if (!id || value.server.user_id !== id)
      throw Error("Your account changed.");
    const next = { ...value, mutation_id: crypto.randomUUID() };
    await cachePut(id, "project_workspace", tab.current, next);
    if (currentOwner.current !== id) throw Error("Your account changed.");
    cached.current = next;
    local.current = next.pending.reduce(applyProjectOperation, next.server);
    setState(local.current);
    setPending(next.pending.length);
  }, []);
  const modify = useCallback(
    (change: (value: Cache) => Cache) => {
      const id = currentOwner.current;
      const task = serial.current.then(async () => {
        if (!id || currentOwner.current !== id || !cached.current)
          throw Error("Your account changed.");
        await persist(change(cached.current));
      });
      serial.current = task.catch(() => {});
      return task;
    },
    [persist],
  );
  const refresh = useCallback(async () => {
    const id = currentOwner.current;
    if (!id || !enabled || running.current === id || !navigator.onLine)
      return false;
    running.current = id;
    try {
      if (
        cached.current?.pending.length &&
        prepare.current &&
        !(await prepare.current())
      )
        return false;
      while (cached.current?.pending.length && currentOwner.current === id) {
        const op = cached.current.pending[0];
        try {
          await (op.method === "PUT" ? apiPut : apiPost)(op.path, op.body);
        } catch (failure) {
          if (failure instanceof ApiError && [409,422,404].includes(failure.status) && !(op.type==="delete"&&failure.status===404&&(failure.body as {detail?:string})?.detail==="project_not_found")) {
            setConflict(op);
            setError(
              "Workspace changes need review. An item changed, was removed, or failed validation. Your pending changes and writing are preserved.",
            );
            return false;
          }
          if (
            op.type === "delete" &&
            failure instanceof ApiError &&
            failure.status === 404 &&
            (failure.body as { detail?: string })?.detail ===
              "project_not_found"
          ) {
            // A retry after a confirmed deletion is already complete.
          } else throw failure;
        }
        await modify((value) => ({
          ...value,
          pending: value.pending.filter((row) => row.id !== op.id),
          server: applyProjectOperation(value.server, op),
        }));
      }
      const remote = await apiGet<ProjectState>(ROOT);
      if (currentOwner.current !== id || remote.user_id !== id) return false;
      await modify((value) => ({
        server: remote,
        pending: value.pending,
        mutation_id: crypto.randomUUID(),
      }));
      setReady(true);
      setError("");
      setConflict(null);
      if (!cached.current?.pending.length && adopted.current.length) {
        for(const row of adopted.current)await cacheDeleteIfMutation(id,'project_workspace',row.id,row.stamp);
        adopted.current=[];
      }
      return true;
    } catch (failure) {
      if (currentOwner.current === id)
        setError(
          failure instanceof ApiError && failure.status === 503
            ? "Project setup or cloud storage is unavailable. Cached writing remains available."
            : "Project synchronization failed. Pending changes are saved on this device.",
        );
      return false;
    } finally {
      if (running.current === id) running.current = null;
      if (currentOwner.current === id) setLoading(false);
    }
  }, [enabled, modify]);
  syncRef.current = refresh;
  useEffect(() => {
    currentOwner.current = owner;
    cached.current = null;
    adopted.current = [];
    local.current = null;
    setState(null);
    setCatalog([]);
    setPending(0);
    setConflict(null);
    setReady(false);
    setLoading(!!owner && enabled);
    setError("");
    if (!owner || !enabled) return;
    const id = owner;
    let cancelled = false;
    void (async () => {
      try {
        const rows = (await cachedRecords(id))
          .filter((row) => row.kind === "project_workspace")
          .sort((a, b) =>
            String((b.value as Cache).server.updated_at).localeCompare(
              (a.value as Cache).server.updated_at,
            ),
          );
        const own = rows.find(
            (row) => row.key === `${id}:project_workspace:${tab.current}`,
          ),
          previous = own || rows[0];
        const recovered=recoverProjectCaches(id,rows.map(row=>row.value as Cache));
        const value:Cache={...recovered,mutation_id:crypto.randomUUID()};
        if (cancelled || currentOwner.current !== id) return;
        adopted.current=rows.filter(row=>row.key!==`${id}:project_workspace:${tab.current}`&&(row.value as Cache).pending.length).map(row=>({id:row.key.slice((id+':project_workspace:').length),stamp:(row.value as Cache).mutation_id}));
        await persist(value);
        setReady(!!previous);
        setLoading(false);
        if (navigator.onLine) await syncRef.current();
      } catch {
        if (!cancelled) {
          setError(
            "Project metadata could not be saved locally. Keep this page open.",
          );
          setLoading(false);
        }
      }
    })();
    const run = () => {
      if (!document.hidden) void syncRef.current();
    };
    const timer = setInterval(run, 15000);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
    };
  }, [owner, enabled, persist]);
  const enqueue = useCallback(
    async (op: Omit<ProjectOperation, "id" | "created_at">) => {
      const id = currentOwner.current;
      if (!id || !cached.current || !enabled)
        throw Error(
          "Open the project workspace online once before editing projects offline.",
        );
      const operation = {
        ...op,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };
      await modify((value) => ({
        ...value,
        pending: [...value.pending, operation],
      }));
      if (navigator.onLine) void syncRef.current();
      return operation;
    },
    [enabled, modify],
  );
  const owned = (revision: number) => ({
    expected_user_id: owner,
    revision,
    mutation_id: crypto.randomUUID(),
  });
  async function saveProject(value: Partial<Project> & { name: string }) {
    validateProject(value);
    const old = local.current?.projects.find((row) => row.id === value.id),
      id = value.id || crypto.randomUUID();
    const body = {
      ...owned(old?.revision || 0),
      name: value.name,
      description: value.description || "",
      project_type: value.project_type || "other",
      status: value.status || "planning",
      goals: value.goals || {},
      preferences: value.preferences || {},
      target_date: value.target_date || null,
    };
    await enqueue({
      type: "project",
      method: "PUT",
      path: ROOT + "/" + id,
      project_id: id,
      body,
    });
    return id;
  }
  async function assign(kind: ResourceKind, id: string, ids: string[]) {
    const version = local.current?.resource_versions.find(
      (row) => row.resource_kind === kind && row.resource_id === id,
    );
    await enqueue({
      type: "resource",
      method: "PUT",
      path: `${ROOT}/resources/${kind}/${id}`,
      resource: { kind, id },
      body: {
        ...owned(version?.revision || 0),
        project_ids: [...new Set(ids)],
      },
    });
  }
  async function select(
    project_id: string | null,
    last_documents: Record<string, string | null> = {},
  ) {
    await enqueue({
      type: "selection",
      method: "PUT",
      path: ROOT + "/active",
      body: {
        ...owned(local.current?.preferences.revision || 0),
        project_id,
        last_documents,
      },
    });
  }
  async function remove(project: Project, name: string) {
    await enqueue({
      type: "delete",
      method: "POST",
      path: `${ROOT}/${project.id}/delete`,
      project_id: project.id,
      body: {
        expected_user_id: owner,
        revision: project.revision,
        confirm_name: name,
      },
    });
  }
  async function saveAnswer(
    question_id: string,
    answer: {
      selected_option_ids: string[];
      custom_answer: string;
      notes: string;
      revision: number;
    },
  ) {
    await enqueue({
      type: "profile",
      method: "PUT",
      path: `${ROOT}/profile/answers/${question_id}`,
      question_id,
      body: {
        selected_option_ids: answer.selected_option_ids,
        custom_answer: answer.custom_answer,
        notes: answer.notes,
        ...owned(answer.revision),
      },
    });
  }
  async function loadResources() {
    const id = currentOwner.current;
    if (!id) return;
    if (!navigator.onLine) {
      const rows = await cachedRecords(id);
      setCatalog(
        (rows.find((row) => row.kind === "project_catalog")
          ?.value as Resource[]) || [],
      );
      return;
    }
    const rows = await apiGet<Resource[]>(
      ROOT + "/resources?expected_user_id=" + id,
    );
    if (currentOwner.current === id) {
      await cachePut(id, "project_catalog", "all", rows);
      setCatalog(rows);
    }
  }
  async function resolveConflict(keepLocal: boolean) {
    const id = currentOwner.current,
      op = conflict;
    if (!id || !op || !cached.current) return;
    const remote = await apiGet<ProjectState>(ROOT);
    if (currentOwner.current !== id) return;
    let replacement: ProjectOperation | null = null;
    if (keepLocal) {
      let revision = 0;
      if (op.type === "project" || op.type === "delete")
        revision =
          remote.projects.find((row) => row.id === op.project_id)?.revision ||
          0;
      else if (op.type === "selection") revision = remote.preferences.revision;
      else if (op.type === "resource")
        revision =
          remote.resource_versions.find(
            (row) =>
              row.resource_kind === op.resource?.kind &&
              row.resource_id === op.resource?.id,
          )?.revision || 0;
      else {
        const rows = await apiGet<{ question_id: string; revision: number }[]>(
          ROOT + "/profile/answers?expected_user_id=" + id,
        );
        revision =
          rows.find((row) => row.question_id === op.question_id)?.revision || 0;
      }
      replacement = {
        ...op,
        body: { ...op.body, revision, mutation_id: crypto.randomUUID() },
      };
    } else await cachePut(id, "project_recovery", op.id, op);
    await modify((value) => ({
      server: remote,
      pending: [
        ...(replacement ? [replacement] : []),
        ...value.pending.filter((row) => row.id !== op.id),
      ],
      mutation_id: crypto.randomUUID(),
    }));
    setConflict(null);
    setError("");
    void syncRef.current();
  }
  async function flush() {
    const id = currentOwner.current,
      deadline = Date.now() + 30000;
    await serial.current;
    while (running.current === id && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 30));
    if (!id || currentOwner.current !== id || running.current === id)
      return false;
    if (!navigator.onLine) return !!cached.current;
    return await refresh();
  }
  return {
    state: state?.user_id===owner ? state : null,
    ready: ready && state?.user_id===owner,
    loading,
    error,
    pending,
    conflict: state?.user_id===owner ? conflict : null,
    catalog: state?.user_id===owner ? catalog : [],
    online,
    refresh,
    flush,
    saveProject,
    assign,
    select,
    remove,
    saveAnswer,
    loadResources,
    resolveConflict,
    pendingOperations: () => cached.current?.pending || [],
    ids: (kind: ResourceKind, id: string) =>
      local.current ? projectIds(local.current, kind, id) : [],
    snapshot: () => local.current,
  };
}
