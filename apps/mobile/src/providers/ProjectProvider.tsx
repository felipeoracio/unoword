import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { useApp, useRepository } from "./AppProvider";
import {
  emptyProjectState,
  validateProject,
  applyProjectOperation,
  inProject,
  type ProjectState,
  type ProjectStatistics,
  type ProjectOperation,
  type Project,
  type ResourceKind,
  type Resource,
  type ResourceRef,
  type ContextScope,
} from "../../../../shared/projects";
export { inProject };
type Cache = { server: ProjectState; pending: ProjectOperation[] };
function useWorkspace() {
  const { account, api, online, writer } = useApp(),
    repo = useRepository(),
    owner = account?.id;
  const [state, setState] = useState<ProjectState | null>(null),
    [ready, setReady] = useState(false),
    [active, setActive] = useState<string | null>(null),
    [scope, setScope] = useState<ContextScope>("current_project"),
    [selected, setSelected] = useState<ResourceRef[]>([]),
    [catalog, setCatalog] = useState<Resource[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(0),
    [conflict, setConflict] = useState<ProjectOperation | null>(null);
  const [statistics,setStatistics]=useState<Record<string,ProjectStatistics>>({});
  useEffect(()=>{let cancelled=false;if(!repo||!owner||!state)return;
    void (async()=>{try{let values=await repo.store.get<Record<string,ProjectStatistics>>('project-statistics')||{};
      if(online){const rows=await Promise.all(state.projects.map(p=>api<ProjectStatistics>('GET',`/workspace/projects/${p.id}/statistics`)));values=Object.fromEntries(rows.map(row=>[row.project_id,row]));await repo.store.set('project-statistics',values)}
      if(!cancelled)setStatistics(values);
    }catch{/* Keep last confirmed totals. Account statistics use the existing ledger. */}})();return()=>{cancelled=true};
  },[owner,repo,state?.updated_at,online]);
  const cache = useRef<Cache | null>(null),
    ownerRef = useRef(owner),
    running = useRef(false),
    disk = useRef(Promise.resolve()),
    syncRef = useRef<() => Promise<boolean>>(async () => false),
    local = useRef<ProjectState | null>(null);
  ownerRef.current = owner;
  const current = useRef({ api, repo, online, writer });
  current.current = { api, repo, online, writer };
  function change(fn: (value: Cache) => Cache) {
    const id = owner;
    const task = disk.current.then(async () => {
      if (!id || ownerRef.current !== id || !cache.current || !repo)
        throw Error("Account changed");
      const next = fn(cache.current);
      await repo.store.set("project-workspace", next);
      if (ownerRef.current !== id) return;
      cache.current = next;
      local.current = next.pending.reduce(applyProjectOperation, next.server);
      setState(local.current);
      setPending(next.pending.length);
    });
    disk.current = task.catch(() => {});
    return task;
  }
  async function sync() {
    const id = ownerRef.current,
      c = current.current;
    if (!id || !c.repo || !c.online || running.current || !cache.current)
      return false;
    running.current = true;
    try {
      await c.repo.flush();
      await c.repo.sync(true);
      if (
        c.repo.diskError ||
        [...c.repo.documents.values()].some((d) => d.dirty || d.conflict)
      )
        throw Error("Save writing first");
      while (cache.current?.pending.length && ownerRef.current === id) {
        const op = cache.current.pending[0];
        await c.api(op.method, op.path, op.body);
        await change((value) => ({
          ...value,
          server: applyProjectOperation(value.server, op),
          pending: value.pending.filter((p) => p.id !== op.id),
        }));
      }
      const remote = await c.api<ProjectState>("GET", "/workspace/projects");
      if (ownerRef.current !== id || remote.user_id !== id) return false;
      await change((value) => ({ ...value, server: remote }));
      setReady(true);
      setError("");
      setConflict(null);
      return true;
    } catch (e) {
      if (ownerRef.current === id) {
        if ([409,404,422].includes((e as any)?.status))
          setConflict(cache.current?.pending[0] || null);
        setError(
          [409,404,422].includes((e as any)?.status)
            ? "Another device changed this project. Pending edits are preserved; choose which version to keep in Projects."
            : "Project sync is pending. Your writing and project changes are saved on this device.",
        );
      }
      return false;
    } finally {
      running.current = false;
    }
  }
  syncRef.current = sync;
  useEffect(() => {
    let cancelled = false;
    cache.current = null;
    local.current = null;
    setState(null);
    setReady(false);
    setActive(null);
    setScope("current_project");
    setSelected([]);
    setCatalog([]);
    setError("");
    setPending(0);
    setConflict(null);
    if (!owner || !repo || !account?.ai_access) return;
    void (async () => {
      try {
        const value = (await repo.store.get<Cache>("project-workspace")) || {
          server: emptyProjectState(owner),
          pending: [],
        };
        if (cancelled) return;
        cache.current = value;
        local.current = value.pending.reduce(
          applyProjectOperation,
          value.server,
        );
        setState(local.current);
        setPending(value.pending.length);
        const resources = await repo.store.get<Resource[]>("project-catalog");
        if (!cancelled) setCatalog(resources || []);
        if (online) await syncRef.current();
        if (!cancelled) {
          setActive(local.current?.preferences.active_project_id || null);
          setReady(true);
        }
      } catch {
        if (!cancelled)
          setError("Project cache could not load. Keep your writing open.");
      }
    })();
    const timer = setInterval(() => void syncRef.current(), 15000),
      sub = AppState.addEventListener("change", (status) => {
        if (status === "active") void syncRef.current();
      });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [owner, repo, account?.ai_access]);
  useEffect(() => {
    if (online && ready) void syncRef.current();
  }, [online, ready]);
  async function enqueue(op: Omit<ProjectOperation, "id" | "created_at">) {
    await change((value) => ({
      ...value,
      pending: [
        ...value.pending,
        {
          ...op,
          id: Crypto.randomUUID(),
          created_at: new Date().toISOString(),
        },
      ],
    }));
    if (online) void syncRef.current();
  }
  async function flush() {
    await disk.current;
    const limit = Date.now() + 30000;
    while (running.current && Date.now() < limit)
      await new Promise((resolve) => setTimeout(resolve, 30));
    if (!online) return !!cache.current;
    if (running.current) return false;
    return syncRef.current();
  }
  const owned = (revision: number) => ({
    expected_user_id: owner,
    revision,
    mutation_id: Crypto.randomUUID(),
  });
  async function select(
    id: string | null,
    last_documents: Record<string, string | null> = {},
  ) {
    setBusy(true);
    try {
      if (writer?.active?.timer.status === "active")
        await writer.change("paused");
      await repo?.flush();
      await enqueue({
        type: "selection",
        method: "PUT",
        path: "/workspace/projects/active",
        body: {
          ...owned(local.current?.preferences.revision || 0),
          project_id: id,
          last_documents,
        },
      });
      if (online && !(await flush()))
        throw Error(
          "Project selection not confirmed. Your writing is preserved.",
        );
      setActive(id);
      setScope("current_project");
      setSelected([]);
    } finally {
      setBusy(false);
    }
  }
  async function assign(kind: ResourceKind, id: string, ids: string[]) {
    const old = local.current?.resource_versions.find(
      (r) => r.resource_kind === kind && r.resource_id === id,
    );
    await enqueue({
      type: "resource",
      method: "PUT",
      path: `/workspace/projects/resources/${kind}/${id}`,
      resource: { kind, id },
      body: { ...owned(old?.revision || 0), project_ids: ids },
    });
  }
  async function saveProject(value: Partial<Project> & { name: string }) {
    validateProject(value);
    const id = value.id || Crypto.randomUUID(),
      old = local.current?.projects.find((p) => p.id === id);
    await enqueue({
      type: "project",
      method: "PUT",
      path: "/workspace/projects/" + id,
      project_id: id,
      body: {
        ...owned(old?.revision || 0),
        name: value.name,
        description: value.description || "",
        project_type: value.project_type || "other",
        status: value.status || "planning",
        goals: value.goals || {},
        preferences: value.preferences || {},
        target_date: value.target_date || null,
      },
    });
    return id;
  }
  async function resources() {
    if (!owner || !repo || !online) return;
    const rows = await api<Resource[]>(
      "GET",
      "/workspace/projects/resources?expected_user_id=" + owner,
    );
    if (ownerRef.current === owner) {
      await repo.store.set("project-catalog", rows);
      setCatalog(rows);
    }
  }
  async function saveAnswer(
    id: string,
    answer: {
      revision: number;
      selected_option_ids: string[];
      custom_answer: string;
      notes: string;
    },
  ) {
    await enqueue({
      type: "profile",
      method: "PUT",
      path: "/workspace/projects/profile/answers/" + id,
      question_id: id,
      body: {
        ...owned(answer.revision),
        selected_option_ids: answer.selected_option_ids,
        custom_answer: answer.custom_answer,
        notes: answer.notes,
      },
    });
  }
  async function resolveConflict(keep: boolean) {
    const op = conflict;
    if (!op || !repo || !owner) return;
    const remote = await api<ProjectState>("GET", "/workspace/projects");
    if (remote.user_id !== owner || ownerRef.current !== owner) return;
    let replacement: ProjectOperation | null = null;
    if (keep) {
      let revision = 0;
      if (op.type === "project" || op.type === "delete")
        revision =
          remote.projects.find((p) => p.id === op.project_id)?.revision || 0;
      else if (op.type === "selection") revision = remote.preferences.revision;
      else if (op.type === "resource")
        revision =
          remote.resource_versions.find(
            (r) =>
              r.resource_kind === op.resource?.kind &&
              r.resource_id === op.resource?.id,
          )?.revision || 0;
      else {
        const rows = await api<{ question_id: string; revision: number }[]>(
          "GET",
          "/workspace/projects/profile/answers",
        );
        revision =
          rows.find((r) => r.question_id === op.question_id)?.revision || 0;
      }
      replacement = {
        ...op,
        body: { ...op.body, revision, mutation_id: Crypto.randomUUID() },
      };
    } else await repo.store.set("project-recovery:" + op.id, op);
    await change((value) => ({
      server: remote,
      pending: [
        ...(replacement ? [replacement] : []),
        ...value.pending.filter((row) => row.id !== op.id),
      ],
    }));
    setConflict(null);
    void syncRef.current();
  }
  async function remember(document: string | null) {
    if (!local.current) return;
    await enqueue({
      type: "selection",
      method: "PUT",
      path: "/workspace/projects/active",
      body: {
        ...owned(local.current.preferences.revision),
        project_id: active,
        last_documents: { [active || "general"]: document },
      },
    });
  }
  useEffect(() => {
    if (
      ready &&
      active &&
      !busy &&
      state &&
      !state.projects.some((p) => p.id === active && p.status !== "archived")
    )
      void select(null).catch(() => {});
  }, [ready, active, state?.updated_at]);
  return {
    state,
    statistics,
    ready,
    active,
    scope,
    selected,
    catalog,
    error,
    busy,
    pending,
    conflict,
    resolveConflict,
    remember,
    online,
    setScope,
    setSelected,
    pendingOperations: () => cache.current?.pending || [],
    select,
    assign,
    saveProject,
    resources,
    flush,
    saveAnswer,
    snapshot: () => local.current,
  };
}
type Value = ReturnType<typeof useWorkspace>;
const Context = createContext<Value | null>(null);
function AccountProjectProvider({ children }: { children: React.ReactNode }) {
  const value = useWorkspace();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function ProjectProvider({children}:{children:React.ReactNode}) {
  const {account}=useApp();
  return <AccountProjectProvider key={account?.id||'signed-out'}>{children}</AccountProjectProvider>;
}
export function useProjects() {
  const value = useContext(Context);
  if (!value) throw Error("Project provider missing");
  return value;
}
