/** Shared project metadata; no browser APIs, credentials or writing bodies. */
export type ResourceKind = "document" | "source" | "memory" | "writing_session";
export type ResourceRef = { kind: ResourceKind; id: string };
export type ContextScope =
  | "current_project"
  | "selected_resources"
  | "all_projects"
  | "profile_only"
  | "none";
export type Project = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  project_type: string;
  status: "planning" | "in_progress" | "paused" | "completed" | "archived";
  goals: {
    daily_words?: number | null;
    weekly_words?: number | null;
    total_words?: number | null;
  };
  preferences: {
    audience?: string;
    tone?: string;
    objectives?: string;
    research_focus?: string;
    challenges?: string;
  };
  target_date: string | null;
  revision: number;
  mutation_id: string;
  created_at: string;
  updated_at: string;
};
export type Association = {
  user_id: string;
  project_id: string;
  resource_kind: ResourceKind;
  resource_id: string;
};
export type ResourceVersion = {
  user_id: string;
  resource_kind: ResourceKind;
  resource_id: string;
  revision: number;
  mutation_id?: string;
};
export type ProjectPreferences = {
  user_id: string;
  active_project_id: string | null;
  last_documents: Record<string, string | null>;
  revision: number;
  mutation_id?: string;
};
export type ProjectState = {
  user_id: string;
  projects: Project[];
  associations: Association[];
  resource_versions: ResourceVersion[];
  preferences: ProjectPreferences;
  updated_at: string;
};
export type Resource = {
  resource_kind: ResourceKind;
  id: string;
  title: string;
  allowed: boolean;
  state: string;
  updated_at: string;
};
export type ProjectStatistics = {
  project_id: string;
  timezone: string;
  reporting_date: string;
  total_words: number;
  daily_words: number;
  weekly_words: number;
  document_count: number;
  last_activity: string | null;
};
export type ProjectOperation = {
  id: string;
  method: "PUT" | "POST";
  path: string;
  type: "project" | "resource" | "selection" | "delete" | "profile";
  body: Record<string, unknown>;
  project_id?: string;
  question_id?: string;
  resource?: ResourceRef;
  created_at: string;
};
export function emptyProjectState(owner: string): ProjectState {
  return {
    user_id: owner,
    projects: [],
    associations: [],
    resource_versions: [],
    preferences: {
      user_id: owner,
      active_project_id: null,
      last_documents: {},
      revision: 0,
    },
    updated_at: "",
  };
}
export function projectIds(
  state: ProjectState,
  kind: ResourceKind,
  id: string,
) {
  return state.associations
    .filter((a) => a.resource_kind === kind && a.resource_id === id)
    .map((a) => a.project_id);
}
export function inProject(
  state: ProjectState,
  kind: ResourceKind,
  id: string,
  project: string | null,
) {
  const ids = projectIds(state, kind, id);
  return project ? ids.includes(project) : ids.length === 0;
}
export function applyProjectOperation(
  state: ProjectState,
  op: ProjectOperation,
): ProjectState {
  const next = JSON.parse(JSON.stringify(state)) as ProjectState,
    body = op.body,
    now = op.created_at;
  if (op.type === "project") {
    const old = next.projects.find((p) => p.id === op.project_id);
    const row = {
      ...old,
      ...body,
      id: op.project_id,
      user_id: state.user_id,
      revision: Number(body.revision) + 1,
      created_at: old?.created_at || now,
      updated_at: now,
    } as Project;
    next.projects = [
      row,
      ...next.projects.filter((p) => p.id !== op.project_id),
    ];
    if (
      row.status === "archived" &&
      next.preferences.active_project_id === row.id
    )
      next.preferences.active_project_id = null;
  } else if (op.type === "resource" && op.resource) {
    const { kind, id } = op.resource;
    next.associations = next.associations.filter(
      (a) => !(a.resource_kind === kind && a.resource_id === id),
    );
    for (const project_id of body.project_ids as string[])
      next.associations.push({
        user_id: state.user_id,
        project_id,
        resource_kind: kind,
        resource_id: id,
      });
    next.resource_versions = next.resource_versions.filter(
      (v) => !(v.resource_kind === kind && v.resource_id === id),
    );
    next.resource_versions.push({
      user_id: state.user_id,
      resource_kind: kind,
      resource_id: id,
      revision: Number(body.revision) + 1,
      mutation_id: String(body.mutation_id),
    });
  } else if (op.type === "selection") {
    next.preferences = {
      ...next.preferences,
      active_project_id: body.project_id as string | null,
      last_documents: {
        ...next.preferences.last_documents,
        ...(body.last_documents as Record<string, string | null>),
      },
      revision: Number(body.revision) + 1,
      mutation_id: String(body.mutation_id),
    };
  } else if (op.type === "delete") {
    const affected = next.associations.filter(
      (a) => a.project_id === op.project_id,
    );
    next.projects = next.projects.filter((p) => p.id !== op.project_id);
    next.associations = next.associations.filter(
      (a) => a.project_id !== op.project_id,
    );
    for (const version of next.resource_versions)
      if (
        affected.some(
          (a) =>
            a.resource_kind === version.resource_kind &&
            a.resource_id === version.resource_id,
        )
      )
        version.revision++;
    if (next.preferences.active_project_id === op.project_id)
      next.preferences.active_project_id = null;
    delete next.preferences.last_documents[op.project_id!];
  }
  next.updated_at = now;
  return next;
}

/** Recover every account-owned tab outbox; duplicate IDs remain one request.
 * Conflicting revisions are kept for explicit resolution, never discarded here.
 */
export function recoverProjectCaches(owner: string, caches: {server: ProjectState; pending: ProjectOperation[]}[]) {
  const owned=caches.filter(row=>row.server.user_id===owner);
  const server=[...owned].sort((a,b)=>b.server.updated_at.localeCompare(a.server.updated_at))[0]?.server||emptyProjectState(owner);
  const operations=new Map<string,ProjectOperation>();
  for(const row of owned)for(const op of row.pending)if(!operations.has(op.id))operations.set(op.id,op);
  return {server,pending:[...operations.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at))};
}

/** Validate before persisting an offline operation; server validation still applies. */
export function validateProject(value: Partial<Project> & {name: string}) {
  if(!value.name.trim()||value.name.trim().length>150)throw Error('Enter a project name of 1–150 characters.');
  if((value.description||'').length>4000)throw Error('Project descriptions are limited to 4,000 characters.');
  if(value.project_type!==undefined&&(!value.project_type.trim()||value.project_type.trim().length>100))throw Error('Enter a project type of 1–100 characters.');
  for(const amount of Object.values(value.goals||{}))if(amount!==null&&amount!==undefined&&(!Number.isSafeInteger(amount)||amount<1||amount>1000000000))throw Error('Word goals must be whole numbers between 1 and 1,000,000,000.');
  if(value.target_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(value.target_date)||!Number.isFinite(Date.parse(value.target_date+'T00:00:00Z'))||new Date(value.target_date+'T00:00:00Z').toISOString().slice(0,10)!==value.target_date))throw Error('Use a valid target date in YYYY-MM-DD format.');
  for(const text of Object.values(value.preferences||{}))if(text&&text.length>2000)throw Error('Each project preference is limited to 2,000 characters.');
}
