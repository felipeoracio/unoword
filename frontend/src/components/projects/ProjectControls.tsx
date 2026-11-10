import { useEffect, useRef, useState } from "react";
import { FolderKanban, SlidersHorizontal, X } from "lucide-react";
import { apiGet } from "@/lib/api";
import { cachePut, cachedRecords } from "@/lib/writing-cache";
import type { ProjectStatistics } from "../../../../shared/projects";
import type {
  useProjectWorkspace,
  ContextScope,
  ResourceRef,
} from "@/lib/use-project-workspace";
import { inProject } from "../../../../shared/projects";
const scopes: Record<ContextScope, [string, string]> = {
  current_project: ["Current Project", "Proyecto actual"],
  selected_resources: ["Selected Resources", "Recursos seleccionados"],
  all_projects: [
    "All Projects / Full Library",
    "Todos los proyectos / Biblioteca completa",
  ],
  profile_only: ["Writing Profile Only", "Solo perfil de escritura"],
  none: ["No Library Context", "Sin contexto de biblioteca"],
};
type Workspace = ReturnType<typeof useProjectWorkspace>;
export default function ProjectControls({
  workspace,
  active,
  scope,
  selected,
  onSwitch,
  onScope,
  onSelected,
  onManage,
  busy,
  language = "en",
}: {
  workspace: Workspace;
  active: string | null;
  scope: ContextScope;
  selected: ResourceRef[];
  onSwitch: (id: string | null) => void;
  onScope: (scope: ContextScope) => void;
  onSelected: (refs: ResourceRef[]) => void;
  onManage: () => void;
  busy: boolean;
  language?: string;
}) {
  const es = language === "es",
    i = es ? 1 : 0,
    [picking, setPicking] = useState(false),
    [query, setQuery] = useState(""),
    [draft, setDraft] = useState<ResourceRef[]>([]),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (picking) dialog.current?.showModal();
    else dialog.current?.close();
  }, [picking]);
  async function pick() {
    setDraft(selected);
    setPicking(true);
    try {
      await workspace.loadResources();
    } catch {
      setError(
        es
          ? "No se pudo cargar la biblioteca."
          : "The resource library could not load.",
      );
    }
  }
  const [statistics, setStatistics] = useState<ProjectStatistics | null>(null);
  const owner = workspace.state?.user_id;
  useEffect(() => {
    let cancelled = false;
    setStatistics(null);
    if (!owner || !active) return;
    async function load() {
      try {
        let value: ProjectStatistics | undefined;
        if (navigator.onLine) {
          value = await apiGet<ProjectStatistics>(
            `/workspace/projects/${active}/statistics`,
          );
          await cachePut(owner!, "project_statistics", active!, value);
        } else
          value = (await cachedRecords(owner!)).find(
            (row) =>
              row.kind === "project_statistics" &&
              (row.value as ProjectStatistics).project_id === active,
          )?.value as ProjectStatistics | undefined;
        if (!cancelled && value) setStatistics(value);
      } catch {
        /* Keep last confirmed project statistics; account totals stay independent. */
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [owner, active, workspace.online]);
  const project = workspace.state?.projects.find((p) => p.id === active);
  const rows = workspace.catalog.filter((row) =>
    row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  function checked(kind: string, id: string) {
    return draft.some((ref) => ref.kind === kind && ref.id === id);
  }
  return (
    <div
      className="uw-project-controls"
      aria-label={es ? "Proyecto y contexto de IA" : "Project and AI context"}
    >
      <label>
        <FolderKanban size={16} />
        <span>{es ? "Proyecto" : "Project"}</span>
        <select
          aria-label={es ? "Proyecto activo" : "Active project"}
          disabled={busy || !workspace.ready}
          value={active || ""}
          onChange={(e) => onSwitch(e.target.value || null)}
        >
          <option value="">
            {es ? "Escritura general" : "General Writing"}
          </option>
          {workspace.state?.projects
            .filter((p) => p.status !== "archived")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={onManage}>
        {es ? "Gestionar proyectos" : "Manage projects"}
      </button>
      <label>
        <SlidersHorizontal size={16} />
        <span>{es ? "Contexto de IA" : "AI Context"}</span>
        <select
          aria-label={es ? "Contexto de IA" : "AI Context"}
          value={scope}
          onChange={(e) => {
            const value = e.target.value as ContextScope;
            onScope(value);
            if (value === "selected_resources") void pick();
          }}
        >
          {Object.entries(scopes).map(([key, label]) => (
            <option key={key} value={key}>
              {label[i]}
            </option>
          ))}
        </select>
      </label>
      {scope === "selected_resources" && (
        <button type="button" onClick={() => void pick()}>
          {selected.length} {es ? "recursos · Elegir" : "resources · Choose"}
        </button>
      )}
      {scope !== "current_project" && (
        <button
          type="button"
          onClick={() => {
            onScope("current_project");
            onSelected([]);
          }}
        >
          {es ? "Restablecer contexto" : "Reset context"}
        </button>
      )}
      <span className="uw-project-sync" role="status">
        {busy
          ? es
            ? "Guardando antes de cambiar…"
            : "Saving before switching…"
          : !workspace.online
            ? es
              ? "Sin conexión · Guardado local"
              : "Offline · Saved locally"
            : workspace.pending
              ? es
                ? "Sincronización pendiente"
                : "Pending sync"
              : workspace.error
                ? es
                  ? "Error de sincronización"
                  : "Sync error"
                : workspace.ready
                  ? es
                    ? "Proyectos sincronizados"
                    : "Projects synced"
                  : es
                    ? "Cargando proyectos…"
                    : "Loading projects…"}
      </span>
      {project && (
        <small className="uw-project-current-progress" role="status">
          {es ? "Meta del proyecto hoy" : "Project today"}:{" "}
          {statistics?.daily_words?.toLocaleString() ?? "—"}
          {project.goals.daily_words
            ? ` / ${project.goals.daily_words.toLocaleString()}`
            : ""}{" "}
          · {es ? "Esta semana" : "This week"}:{" "}
          {statistics?.weekly_words?.toLocaleString() ?? "—"}
          {project.goals.weekly_words
            ? ` / ${project.goals.weekly_words.toLocaleString()}`
            : ""}{" "}
          · {es ? "Total del proyecto" : "Project total"}:{" "}
          {statistics?.total_words?.toLocaleString() ?? "—"}
          {project.goals.total_words
            ? ` / ${project.goals.total_words.toLocaleString()}`
            : ""}
        </small>
      )}
      <dialog
        ref={dialog}
        className="uw-editor-dialog uw-project-dialog"
        onCancel={() => setPicking(false)}
        aria-label={es ? "Elegir recursos para IA" : "Choose AI resources"}
      >
        <div className="uw-project-dialog-inner">
          <div className="uw-project-heading">
            <h2>
              {es
                ? "Elige el contexto para esta solicitud"
                : "Choose context for this request"}
            </h2>
            <button
              type="button"
              aria-label={es ? "Cerrar" : "Close"}
              onClick={() => setPicking(false)}
            >
              <X size={18} />
            </button>
          </div>
          <p>
            {es
              ? "Solo los recursos autorizados y listos se usan. Seleccionar no habilita documentos privados para IA."
              : "Only authorized, ready resources are used. Selecting a private document does not enable its ongoing AI consent."}
          </p>
          {error && <p role="alert">{error}</p>}
          <input
            aria-label={es ? "Buscar recursos" : "Search resources"}
            placeholder={es ? "Buscar recursos…" : "Search resources…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="uw-project-actions">
            <button
              type="button"
              onClick={() =>
                setDraft(
                  rows
                    .filter((row) => row.allowed)
                    .slice(0, 200)
                    .map((row) => ({ kind: row.resource_kind, id: row.id })),
                )
              }
            >
              {es ? "Seleccionar visibles" : "Select visible"}
            </button>
            <button type="button" onClick={() => setDraft([])}>
              {es ? "Borrar selección" : "Clear selection"}
            </button>
            <button
              type="button"
              onClick={() => {
                const state = workspace.snapshot();
                if (state)
                  setDraft(
                    workspace.catalog
                      .filter(
                        (r) =>
                          r.allowed &&
                          inProject(state, r.resource_kind, r.id, active),
                      )
                      .slice(0, 200)
                      .map((r) => ({ kind: r.resource_kind, id: r.id })),
                  );
              }}
            >
              {es ? "Recursos del proyecto" : "Project resources"}
            </button>
          </div>
          <div className="uw-project-resource-list">
            {rows.map((row) => (
              <label key={row.resource_kind + row.id}>
                <input
                  type="checkbox"
                  checked={checked(row.resource_kind, row.id)}
                  disabled={
                    !checked(row.resource_kind, row.id) && draft.length >= 200
                  }
                  onChange={(e) =>
                    setDraft((old) =>
                      e.target.checked
                        ? [...old, { kind: row.resource_kind, id: row.id }]
                        : old.filter(
                            (ref) =>
                              ref.kind !== row.resource_kind ||
                              ref.id !== row.id,
                          ),
                    )
                  }
                />
                <span>
                  {row.title}
                  <small>
                    {row.resource_kind} ·{" "}
                    {row.allowed
                      ? es
                        ? "Disponible"
                        : "Available"
                      : es
                        ? "No autorizado o en proceso"
                        : "Not opted in or still processing"}
                  </small>
                </span>
              </label>
            ))}
            {!rows.length && (
              <p>
                {es
                  ? "Aún no hay recursos. Añádelos desde Gestionar proyectos."
                  : "No resources yet. Add them in Manage projects."}
              </p>
            )}
          </div>
          <button
            type="button"
            className="uw-editor-primary"
            onClick={() => {
              onSelected(draft);
              onScope("selected_resources");
              setPicking(false);
            }}
          >
            {es ? "Aplicar selección" : "Apply selection"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
