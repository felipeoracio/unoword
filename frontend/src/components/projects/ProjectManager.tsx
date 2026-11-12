import { useEffect, useRef, useState } from "react";
import { revealOpacity } from "@/lib/motion";
import { Link } from "react-router-dom";
import {
  Plus,
  FolderKanban,
  FileText,
  BookOpen,
  Search,
  ArrowRight,
} from "lucide-react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import {
  inProject,
  type Project,
  type ProjectStatistics,
  type Resource,
} from "../../../../shared/projects";
import type { useProjectWorkspace } from "@/lib/use-project-workspace";
type Workspace = ReturnType<typeof useProjectWorkspace>;
const projectTypes = [
  "novel",
  "memoir",
  "short_story",
  "poetry",
  "blog",
  "essay",
  "nonfiction_book",
  "academic_writing",
  "business_writing",
  "journal",
  "other",
];
const typeEs = [
  "Novela",
  "Memorias",
  "Cuento",
  "Poesía",
  "Blog",
  "Ensayo",
  "Libro de no ficción",
  "Escritura académica",
  "Escritura empresarial",
  "Diario",
  "Otro",
];
const statuses = [
  "planning",
  "in_progress",
  "paused",
  "completed",
  "archived",
] as const;
const statusEs = [
  "Planificación",
  "En curso",
  "En pausa",
  "Completado",
  "Archivado",
];
const label = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const blank = {
  name: "",
  description: "",
  project_type: "novel",
  status: "planning" as Project["status"],
  goals: {} as Project["goals"],
  preferences: {} as Project["preferences"],
  target_date: null as string | null,
};
export default function ProjectManager({
  workspace,
  active,
  onOpen,
  onProfile,
  language = "en",
  headingLevel = 1,
}: {
  workspace: Workspace;
  active: string | null;
  onOpen: (id: string | null) => void;
  onProfile: () => void;
  language?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const detailPanel = useRef<HTMLElement>(null);
  const detailFeedback = useRef(false);
  const es = language === "es",
    t = (en: string, spanish: string) => (es ? spanish : en);
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [sort, setSort] = useState("updated"),
    [detail, setDetail] = useState<string | null>(active),
    [tab, setTab] = useState("Overview"),
    [editing, setEditing] = useState<(Partial<Project> & typeof blank) | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [deleteName, setDeleteName] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [stats, setStats] = useState<Record<string, ProjectStatistics>>({}),
    [resourceQuery, setResourceQuery] = useState(""),
    [allResources, setAllResources] = useState(false),
    [addMode, setAddMode] = useState(""),
    [sourceTitle, setSourceTitle] = useState(""),
    [sourceText, setSourceText] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<{ title: string; text: string } | null>(
      null,
    );
  const latest = useRef({ workspace, es });
  latest.current = { workspace, es };
  useEffect(() => {
    if (!detailFeedback.current) return;
    detailFeedback.current = false;
    const dialog = detailPanel.current?.closest("dialog");
    if (dialog && !dialog.open) return;
    const animation = detailPanel.current ? revealOpacity(detailPanel.current, 0.98) : null;
    return () => animation?.cancel();
  }, [detail, tab]);
  const state = workspace.state,
    project = state?.projects.find((p) => p.id === detail),
    rows = workspace.catalog.filter(
      (r) =>
        r.title
          .toLocaleLowerCase()
          .includes(resourceQuery.toLocaleLowerCase()) &&
        (allResources ||
          (!!state && inProject(state, r.resource_kind, r.id, detail))),
    );
  useEffect(() => {
    void latest.current.workspace
      .loadResources()
      .catch(() =>
        setError(
          latest.current.es
            ? "No se pudieron cargar los recursos."
            : "Could not load resources.",
        ),
      );
  }, [state?.user_id, state?.updated_at]);
  useEffect(() => {
    if (!state || !workspace.online) return;
    let cancelled = false;
    void Promise.all(
      state.projects.map(async (p) => {
        try {
          const s = await apiGet<ProjectStatistics>(
            `/workspace/projects/${p.id}/statistics`,
          );
          if (!cancelled) setStats((old) => ({ ...old, [p.id]: s }));
        } catch {
          /* retain previous confirmed stats */
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [state, workspace.online]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(
        t(
          "Saved on this device. Cloud status is shown above.",
          "Guardado en este dispositivo. El estado de la nube aparece arriba.",
        ),
      );
    } catch {
      setError(
        t(
          "Could not save this change. Your writing is preserved.",
          "No se pudo guardar este cambio. Tus textos se conservan.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  async function addSource() {
    if (!workspace.online) throw Error("offline");
    let source: { id: string };
    if (addMode === "link") {
      source = await apiPost("/links", {
        url: sourceText,
        title: sourceTitle || undefined,
        expected_user_id: state?.user_id,
      });
    } else {
      const data = new FormData();
      const upload =
        addMode === "note"
          ? new File([sourceText], "research-note.txt", { type: "text/plain" })
          : file;
      if (!upload) throw Error("missing file");
      data.append("expected_user_id", state!.user_id);
      data.append("file", upload);
      data.append("document_title", sourceTitle || upload.name);
      data.append("document_type", addMode === "note" ? "notes" : "reference");
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: data,
      });
      if (!response.ok) throw Error("upload");
      source = await response.json();
    }
    await workspace.assign("source", source.id, detail ? [detail] : []);
    await workspace.flush();
    await workspace.loadResources();
    setAddMode("");
    setSourceTitle("");
    setSourceText("");
    setFile(null);
  }
  async function previewResource(row: Resource) {
    if (!workspace.online) {
      setError(
        t(
          "Resource previews need a connection. Cached editor documents remain available offline.",
          "Las vistas previas necesitan conexión. Los documentos guardados están disponibles sin conexión.",
        ),
      );
      return;
    }
    try {
      setPreview(
        await apiGet(
          `/workspace/projects/resources/${row.resource_kind}/${row.id}/preview`,
        ),
      );
    } catch {
      setError(
        t("Preview could not load.", "No se pudo abrir la vista previa."),
      );
    }
  }
  async function rename(row: Resource) {
    const title = window.prompt(
      t("Resource title", "Título del recurso"),
      row.title,
    );
    if (!title?.trim()) return;
    await run(async () => {
      await apiPatch(`/workspace/projects/resources/source/${row.id}`, {
        expected_user_id: state?.user_id,
        title,
      });
      await workspace.loadResources();
    });
  }
  function membership(row: Resource, checked: boolean) {
    const ids = workspace.ids(row.resource_kind, row.id);
    void run(() =>
      workspace.assign(
        row.resource_kind,
        row.id,
        checked ? [...ids, detail!] : ids.filter((id) => id !== detail),
      ),
    );
  }
  const projects = (state?.projects || [])
    .filter(
      (p) =>
        (archived || p.status !== "archived") &&
        `${p.name} ${p.description} ${p.project_type}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "progress"
          ? (stats[b.id]?.total_words || 0) / (b.goals.total_words || 1) -
            (stats[a.id]?.total_words || 0) / (a.goals.total_words || 1)
          : sort === "words"
            ? (stats[b.id]?.total_words || 0) - (stats[a.id]?.total_words || 0)
            : b.updated_at.localeCompare(a.updated_at),
    );
  return (
    <section className="uw-project-manager">
      <div className="uw-project-heading">
        <div>
          <p className="uw-project-eyebrow">
            {t(
              "YOUR WORDS. YOUR VOICE. YOUR STORY.",
              "TUS PALABRAS. TU VOZ. TU HISTORIA.",
            )}
          </p>
          <Heading>
            <FolderKanban size={26} /> {t("Projects", "Proyectos")}
          </Heading>
          <p>
            {t(
              "A space for every idea. Your writing stays yours.",
              "Un espacio para cada idea. Tus textos siguen siendo tuyos.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="uw-editor-primary"
          onClick={() => {
            setEditing({ ...blank });
            setError("");
          }}
        >
          <Plus size={16} />
          {t("New Project", "Nuevo proyecto")}
        </button>
      </div>
      <div className="uw-project-actions">
        <button
          type="button"
          onClick={() => {
            setDetail(null);
            setTab("Documents");
          }}
        >
          <FileText size={16} />
          {t("General Writing", "Escritura general")}
        </button>
        <button type="button" onClick={onProfile}>
          <BookOpen size={16} />
          {t(
            "Library → My Writing Profile",
            "Biblioteca → Mi perfil de escritura",
          )}
        </button>
        <Link to="/account">{t("Account", "Cuenta")}</Link>
      </div>
      {workspace.error && <p role="alert">{workspace.error}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <p role="status" className="uw-project-sync">
        {!workspace.online
          ? t(
              "Offline · Changes will sync when you reconnect.",
              "Sin conexión · Los cambios se sincronizarán al reconectar.",
            )
          : workspace.pending
            ? t(
                `${workspace.pending} change(s) pending cloud confirmation.`,
                `${workspace.pending} cambio(s) pendientes de confirmar.`,
              )
            : workspace.ready
              ? t("Projects synced", "Proyectos sincronizados")
              : t("Loading projects…", "Cargando proyectos…")}
      </p>
      {workspace.conflict && (
        <div className="uw-project-warning">
          <p>
            {t(
              "Another device changed this workspace. Choose which version to keep; your writing is safe.",
              "Otro dispositivo cambió este espacio. Elige qué versión conservar; tus textos están seguros.",
            )}
          </p>
          <button
            type="button"
            onClick={() => void run(() => workspace.resolveConflict(true))}
          >
            {t("Retry my change", "Reintentar mi cambio")}
          </button>
          <button
            type="button"
            onClick={() => void run(() => workspace.resolveConflict(false))}
          >
            {t(
              "Keep cloud version (local recovery retained)",
              "Conservar versión de la nube (copia local guardada)",
            )}
          </button>
        </div>
      )}
      {editing && (
        <form
          className="uw-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const id = await workspace.saveProject(editing);
              setDetail(id);
              setEditing(null);
              setTab("Overview");
            });
          }}
        >
          <h2>
            {editing.id
              ? t("Project settings", "Ajustes del proyecto")
              : t("Create a project", "Crear un proyecto")}
          </h2>
          <label>
            {t("Project name", "Nombre del proyecto")}
            <input
              required
              value={editing.name}
              maxLength={150}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label>
            {t("Description", "Descripción")}
            <textarea
              value={editing.description}
              maxLength={4000}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </label>
          <div className="uw-project-form-grid">
            <label>
              {t("Project type", "Tipo de proyecto")}
              <select
                value={
                  projectTypes.includes(editing.project_type)
                    ? editing.project_type
                    : "other"
                }
                onChange={(e) =>
                  setEditing({ ...editing, project_type: e.target.value })
                }
              >
                {projectTypes.map((type, i) => (
                  <option key={type} value={type}>
                    {es ? typeEs[i] : label(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Status", "Estado")}
              <select
                value={editing.status}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    status: e.target.value as Project["status"],
                  })
                }
              >
                {statuses.map((status, i) => (
                  <option key={status} value={status}>
                    {es ? statusEs[i] : label(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(!projectTypes.includes(editing.project_type) ||
            editing.project_type === "other") && (
            <label>
              {t("Custom project type", "Tipo personalizado")}
              <input
                maxLength={100}
                value={
                  editing.project_type === "other" ? "" : editing.project_type
                }
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    project_type: e.target.value || "other",
                  })
                }
              />
            </label>
          )}
          <h3>
            {t("Optional project goals", "Metas opcionales del proyecto")}
          </h3>
          <div className="uw-project-form-grid">
            {(["daily_words", "weekly_words", "total_words"] as const).map(
              (key, i) => (
                <label key={key}>
                  {
                    [
                      t("Daily words", "Palabras diarias"),
                      t("Weekly words", "Palabras semanales"),
                      t("Total words", "Palabras totales"),
                    ][i]
                  }
                  <input
                    type="number"
                    min={1}
                    max={1000000000}
                    value={editing.goals[key] || ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        goals: {
                          ...editing.goals,
                          [key]: e.target.value ? Number(e.target.value) : null,
                        },
                      })
                    }
                  />
                </label>
              ),
            )}
            <label>
              {t("Target date", "Fecha objetivo")}
              <input
                type="date"
                value={editing.target_date || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    target_date: e.target.value || null,
                  })
                }
              />
            </label>
          </div>
          <h3>
            {t("Project AI preferences", "Preferencias de IA del proyecto")}
          </h3>
          <p>
            {t(
              "These guide this project and take priority over general profile preferences. They never override privacy or coaching rules.",
              "Guían este proyecto y tienen prioridad sobre el perfil general, sin cambiar las reglas de privacidad o asesoramiento.",
            )}
          </p>
          {(
            [
              "audience",
              "tone",
              "objectives",
              "research_focus",
              "challenges",
            ] as const
          ).map((key, i) => (
            <label key={key}>
              {
                [
                  t("Audience", "Público"),
                  t("Tone", "Tono"),
                  t("Objectives", "Objetivos"),
                  t("Research focus", "Enfoque de investigación"),
                  t("Challenges", "Dificultades"),
                ][i]
              }
              <textarea
                maxLength={2000}
                rows={2}
                value={editing.preferences[key] || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    preferences: {
                      ...editing.preferences,
                      [key]: e.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
          <div className="uw-project-actions">
            <button disabled={busy} className="uw-editor-primary" type="submit">
              {t("Save project", "Guardar proyecto")}
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              {t("Cancel", "Cancelar")}
            </button>
          </div>
        </form>
      )}
      <div className="uw-project-search">
        <Search size={16} />
        <input
          aria-label={t("Search projects", "Buscar proyectos")}
          placeholder={t("Search projects…", "Buscar proyectos…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t("Sort projects", "Ordenar proyectos")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="updated">
            {t("Recently active", "Actividad reciente")}
          </option>
          <option value="name">{t("Name", "Nombre")}</option>
          <option value="progress">{t("Progress", "Progreso")}</option>
          <option value="words">
            {t("Words written", "Palabras escritas")}
          </option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          {t("Show archived", "Mostrar archivados")}
        </label>
      </div>
      <div className="uw-project-cards">
        {projects.map((p) => (
          <article key={p.id} className={detail === p.id ? "is-selected" : ""}>
            <button
              type="button"
              className="uw-project-card-title"
              onClick={() => {
                detailFeedback.current = true;
                setDetail(p.id);
                setTab("Overview");
                setEditing(null);
              }}
            >
              <FolderKanban size={21} />
              <strong>{p.name}</strong>
            </button>
            <small>
              {label(p.project_type)} ·{" "}
              {es ? statusEs[statuses.indexOf(p.status)] : label(p.status)}
            </small>
            <p>
              {p.description ||
                t("Ready for your next idea.", "Listo para tu próxima idea.")}
            </p>
            <div className="uw-project-card-numbers">
              <b>{stats[p.id]?.total_words?.toLocaleString() ?? "—"}</b>{" "}
              {t("words written", "palabras escritas")} ·{" "}
              {stats[p.id]?.document_count ??
                state?.associations.filter(
                  (a) =>
                    a.project_id === p.id && a.resource_kind === "document",
                ).length}{" "}
              {t("documents", "documentos")}
            </div>
            {!!p.goals.total_words && (
              <progress
                aria-label={t("Project progress", "Progreso del proyecto")}
                max={p.goals.total_words}
                value={stats[p.id]?.total_words || 0}
              />
            )}
            <small>
              {t("Last activity", "Última actividad")}:{" "}
              {new Date(
                stats[p.id]?.last_activity || p.updated_at,
              ).toLocaleDateString(es ? "es" : "en")}
            </small>
            <button
              type="button"
              disabled={p.status === "archived" || busy}
              onClick={() => onOpen(p.id)}
            >
              {t("Open project", "Abrir proyecto")} <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
      {!projects.length && !workspace.loading && (
        <p>
          {t(
            "Create your first project, or keep writing in General Writing.",
            "Crea tu primer proyecto o sigue en Escritura general.",
          )}
        </p>
      )}
      <section ref={detailPanel} className="uw-project-detail">
        <div className="uw-project-heading">
          <h2>{project?.name || t("General Writing", "Escritura general")}</h2>
          <button
            type="button"
            disabled={project?.status === "archived"}
            onClick={() => onOpen(detail)}
          >
            {t("Open in editor", "Abrir en editor")}
          </button>
        </div>
        <nav
          className="uw-project-tabs"
          aria-label={t("Project details", "Detalles del proyecto")}
        >
          {["Overview", "Documents", "Resources", "AI Context", "Settings"].map(
            (name, i) => (
              <button
                type="button"
                key={name}
                aria-current={tab === name ? "page" : undefined}
                onClick={() => {
                  detailFeedback.current = true;
                  setTab(name);
                  setPreview(null);
                }}
              >
                {es
                  ? [
                      "Resumen",
                      "Documentos",
                      "Recursos",
                      "Contexto de IA",
                      "Ajustes",
                    ][i]
                  : name}
              </button>
            ),
          )}
        </nav>
        {tab === "Overview" && (
          <>
            <p>
              {project?.description ||
                t(
                  "Unassigned writing and resources live here. Switching projects never moves your documents.",
                  "Aquí están los textos y recursos sin proyecto. Cambiar de proyecto nunca mueve documentos.",
                )}
            </p>
            {project && (
              <div className="uw-project-metrics">
                {(["daily_words", "weekly_words", "total_words"] as const).map(
                  (key, i) => (
                    <div key={key}>
                      <span>
                        {
                          [
                            t("Today", "Hoy"),
                            t("This week", "Esta semana"),
                            t("Project total", "Total del proyecto"),
                          ][i]
                        }
                      </span>
                      <strong>
                        {stats[project.id]?.[key]?.toLocaleString() ?? "—"}
                        {project.goals[key]
                          ? ` / ${project.goals[key]?.toLocaleString()}`
                          : ""}
                      </strong>
                    </div>
                  ),
                )}
              </div>
            )}
            <p>
              {t(
                "Project totals use existing document writing activity. A shared document can appear in several project views; account-wide words and time are never added again.",
                "Los totales usan la actividad existente de los documentos. Un documento compartido aparece en varios proyectos; nunca se suma de nuevo a los totales de tu cuenta.",
              )}
            </p>
          </>
        )}
        {["Documents", "Resources", "AI Context"].includes(tab) && (
          <>
            {tab === "AI Context" && (
              <>
                <h3>
                  {t(
                    "Current Project is the default",
                    "Proyecto actual es el contexto predeterminado",
                  )}
                </h3>
                <p>
                  {t(
                    "Only this project’s authorized resources and your Writing Profile are used by default. Choose another scope in the editor for a temporary override. Overrides reset when you switch projects.",
                    "Solo se usan los recursos autorizados de este proyecto y tu perfil. Elige otro contexto en el editor para una solicitud temporal. Se restablece al cambiar de proyecto.",
                  )}
                </p>
                <p>
                  {t(
                    "Private documents require explicit AI consent. Disabled or processing sources are excluded. No Library Context excludes profile and library; Profile Only excludes all library text.",
                    "Los documentos privados necesitan consentimiento explícito. Se excluyen recursos desactivados o en proceso. Sin contexto excluye perfil y biblioteca; Solo perfil excluye los textos de la biblioteca.",
                  )}
                </p>
              </>
            )}
            {headingLevel === 2 && tab !== "Documents" && <p><Link to="/library?view=references">{t("Review reference permissions and processing status", "Revisar permisos y procesamiento de referencias")}</Link></p>}
            <div className="uw-project-actions">
              <input
                aria-label={t("Search resources", "Buscar recursos")}
                placeholder={t("Search resources…", "Buscar recursos…")}
                value={resourceQuery}
                onChange={(e) => setResourceQuery(e.target.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={allResources}
                  onChange={(e) => setAllResources(e.target.checked)}
                />
                {t("Assign existing resources", "Asignar recursos existentes")}
              </label>
              {tab !== "Documents" &&
                ["file", "link", "note"].map((mode, i) => (
                  <button
                    type="button"
                    key={mode}
                    disabled={!workspace.online}
                    onClick={() => setAddMode(addMode === mode ? "" : mode)}
                  >
                    {
                      [
                        t("Upload file", "Subir archivo"),
                        t("Add website", "Añadir sitio web"),
                        t("Research note", "Nota de investigación"),
                      ][i]
                    }
                  </button>
                ))}
            </div>
            {addMode && (
              <form
                className="uw-project-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(addSource);
                }}
              >
                <h3>
                  {t(
                    "Add to your private knowledge library",
                    "Añadir a tu biblioteca privada",
                  )}
                </h3>
                <p>
                  {t(
                    "Adding this material makes it available for AI within its assigned projects, when processing finishes. Share only content you have permission to use.",
                    "Este material estará disponible para IA en sus proyectos cuando se procese. Comparte solo contenido que tengas permiso para usar.",
                  )}
                </p>
                <label>
                  {t("Title", "Título")}
                  <input
                    value={sourceTitle}
                    maxLength={300}
                    onChange={(e) => setSourceTitle(e.target.value)}
                  />
                </label>
                {addMode === "file" ? (
                  <input
                    type="file"
                    required
                    accept=".pdf,.txt,.md,.docx"
                    aria-label={t(
                      "Reference file (up to 5 MB)",
                      "Archivo de referencia (hasta 5 MB)",
                    )}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                ) : (
                  <label>
                    {addMode === "link" ? "URL" : t("Your notes", "Tus notas")}
                    <textarea
                      required
                      value={sourceText}
                      maxLength={addMode === "link" ? 2000 : 100000}
                      onChange={(e) => setSourceText(e.target.value)}
                    />
                  </label>
                )}
                <div className="uw-project-actions">
                  <button type="submit" disabled={busy}>
                    {t("Add resource", "Añadir recurso")}
                  </button>
                  <button type="button" onClick={() => setAddMode("")}>
                    {t("Cancel", "Cancelar")}
                  </button>
                </div>
              </form>
            )}
            <div className="uw-project-resource-list">
              {rows
                .filter(
                  (r) => tab !== "Documents" || r.resource_kind === "document",
                )
                .map((row) => (
                  <div
                    key={row.resource_kind + row.id}
                    className="uw-project-resource-row"
                  >
                    <span>
                      <strong>{row.title}</strong>
                      <small>
                        {row.resource_kind === "document" ? t("Authored writing", "Escritura propia") : row.resource_kind === "source" ? t("AI reference", "Referencia de IA") : row.resource_kind === "memory" ? t("AI memory", "Memoria de IA") : t("Saved writing context", "Contexto de escritura guardado")} · {row.state} ·{" "}
                        {workspace.ids(row.resource_kind, row.id).length > 1
                          ? t("Shared", "Compartido")
                          : ""}{" "}
                        {row.allowed
                          ? t("AI available", "Disponible para IA")
                          : t(
                              "AI not opted in / processing",
                              "Sin consentimiento / en proceso",
                            )}
                      </small>
                    </span>
                    <div className="uw-project-actions">
                      <button
                        type="button"
                        onClick={() => void previewResource(row)}
                      >
                        {t("Preview", "Vista previa")}
                      </button>
                      {row.resource_kind === "source" && (
                        <button
                          type="button"
                          disabled={!workspace.online}
                          onClick={() => void rename(row)}
                        >
                          {t("Rename", "Renombrar")}
                        </button>
                      )}
                      {detail && (
                        <label>
                          <input
                            type="checkbox"
                            checked={workspace
                              .ids(row.resource_kind, row.id)
                              .includes(detail)}
                            disabled={busy || project?.status === "archived"}
                            onChange={(e) => membership(row, e.target.checked)}
                          />
                          {t("In project", "En proyecto")}
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              {!rows.length && (
                <p>
                  {t(
                    "No resources here yet. Add a reference or assign existing material.",
                    "Aún no hay recursos. Añade referencias o asigna material existente.",
                  )}
                </p>
              )}
            </div>
            {preview && (
              <article className="uw-project-preview">
                <h3>{preview.title}</h3>
                <pre>
                  {preview.text ||
                    t(
                      "No text preview is available yet. Processing may still be underway.",
                      "Aún no hay vista previa de texto. Puede estar procesándose.",
                    )}
                </pre>
                <button type="button" onClick={() => setPreview(null)}>
                  {t("Close preview", "Cerrar vista previa")}
                </button>
              </article>
            )}
          </>
        )}
        {tab === "Settings" &&
          (project ? (
            <>
              <p>
                {t(
                  "Project settings only change project metadata. Your account goals and writing history remain intact.",
                  "Los ajustes solo cambian los metadatos del proyecto. Tus metas e historial de la cuenta se conservan.",
                )}
              </p>
              <div className="uw-project-actions">
                <button
                  type="button"
                  onClick={() => setEditing({ ...blank, ...project })}
                >
                  {t("Edit project settings", "Editar ajustes")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      workspace.saveProject({
                        ...project,
                        status:
                          project.status === "archived"
                            ? "planning"
                            : "archived",
                      }),
                    )
                  }
                >
                  {project.status === "archived"
                    ? t("Restore project", "Restaurar proyecto")
                    : t("Archive project", "Archivar proyecto")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(true);
                    setDeleteName("");
                  }}
                >
                  {t("Delete project…", "Eliminar proyecto…")}
                </button>
              </div>
              {confirmDelete && (
                <form
                  className="uw-project-warning"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await workspace.remove(project, deleteName);
                      setDetail(null);
                      setConfirmDelete(false);
                    });
                  }}
                >
                  <p>
                    {t(
                      "This removes the project and memberships only. Documents, files, writing activity, and other projects are preserved. Unassigned items remain in General Writing.",
                      "Solo elimina el proyecto y sus asignaciones. Se conservan documentos, archivos, actividad y otros proyectos. Los elementos sin proyecto quedan en Escritura general.",
                    )}
                  </p>
                  <label>
                    {t(
                      "Type the project name to confirm",
                      "Escribe el nombre del proyecto para confirmar",
                    )}
                    <input
                      required
                      value={deleteName}
                      onChange={(e) => setDeleteName(e.target.value)}
                    />
                  </label>
                  <div className="uw-project-actions">
                    <button
                      type="submit"
                      disabled={busy || deleteName !== project.name}
                    >
                      {t("Confirm deletion", "Confirmar eliminación")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      {t("Cancel", "Cancelar")}
                    </button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <p>
              {t(
                "General Writing is your permanent home for unassigned writing.",
                "Escritura general es el espacio permanente para textos sin proyecto.",
              )}
            </p>
          ))}
      </section>
    </section>
  );
}
