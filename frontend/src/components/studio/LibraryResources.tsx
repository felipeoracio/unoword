import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { inProject, type Resource, type useProjectWorkspace } from "@/lib/use-project-workspace";
import { recoveryPath } from "@/lib/domain-recovery";
import { StudioButton, StudioCard, StudioLink } from "./StudioPrimitives";

type Source = { id: string; document_title: string; enabled: boolean; source_kind: string; processing_status?: string; processing_phase?: string; processing_progress?: number };
type Preview = { id: string; kind: string; title: string; text: string };
type Props = { owner: string; workspace: ReturnType<typeof useProjectWorkspace>; view: "writing" | "references" | "memory"; language: string };

/** Catalog browsing changes no project memberships or source permissions. */
export default function LibraryResources({ owner, workspace, view, language }: Props) {
  const es = language === "es", t = (en: string, spanish: string) => es ? spanish : en;
  const [search, setSearch] = useState(""), [project, setProject] = useState("all"), [limit, setLimit] = useState(24);
  const [load, setLoad] = useState<"loading" | "refreshing" | "ready" | "error">("loading"), [busy, setBusy] = useState<string[]>([]), [error, setError] = useState("");
  const [selected, setSelected] = useState<Resource | null>(null);
  const client = useQueryClient(), latest = useRef(workspace), mounted = useRef(false);
  latest.current = workspace;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function refresh() {
    setLoad(current => current === "ready" || current === "refreshing" ? "refreshing" : "loading");
    try {
      if (!latest.current.ready && latest.current.online && !(await latest.current.refresh())) throw Error("workspace_unavailable");
      await latest.current.loadResources(); if (mounted.current) setLoad("ready");
    }
    catch { if (mounted.current) setLoad("error"); }
  }
  useEffect(() => {
    if (!workspace.ready) return;
    void refresh();
    // Catalog metadata follows the current owner's project snapshot and reconnects.
  }, [workspace.ready, workspace.state?.updated_at, workspace.online]);
  useEffect(() => { setLimit(24); setSelected(null); }, [search, project]);
  const sources = useQuery({ queryKey: ["library-sources", owner], queryFn: () => apiGet<Source[]>("/workspace/sources"), enabled: view === "references" && workspace.online, retry: false, gcTime: 0, refetchInterval: 15000, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const preview = useQuery({ queryKey: ["library-preview", owner, selected?.resource_kind, selected?.id], queryFn: async () => {
    const result = await apiGet<Preview>(`/workspace/projects/resources/${selected!.resource_kind}/${selected!.id}/preview`);
    if (result.id !== selected!.id || result.kind !== selected!.resource_kind) throw Error("resource_changed");
    return result;
  }, enabled: !!selected && workspace.online, retry: false, gcTime: 0 });
  async function permission(source: Source, enabled: boolean) {
    if (!workspace.online || busy.includes(source.id)) return;
    setBusy(ids => [...ids, source.id]); setError("");
    try {
      const result = await apiPatch<{ id: string; enabled: boolean }>(`/workspace/sources/${source.id}`, { expected_user_id: owner, enabled });
      if (result.id !== source.id || result.enabled !== enabled) throw Error("source_changed");
      if (!mounted.current) return;
      await client.invalidateQueries({ queryKey: ["library-sources", owner] }); await refresh();
    } catch { if (mounted.current) setError(t("The permission could not be confirmed. Refresh and try again; your writing is preserved.", "No se pudo confirmar el permiso. Actualiza y reintenta; tus textos se conservan.")); }
    finally { if (mounted.current) setBusy(ids => ids.filter(id => id !== source.id)); }
  }
  const rows = workspace.catalog.filter(row => (view === "writing" ? row.resource_kind === "document" : view === "references" ? row.resource_kind === "source" : row.resource_kind === "memory" || row.resource_kind === "writing_session")
    && row.title.toLocaleLowerCase(language).includes(search.trim().toLocaleLowerCase(language))
    && (project === "all" || !!workspace.state && inProject(workspace.state, row.resource_kind, row.id, project === "general" ? null : project)));
  const titles = { writing: t("Your writing", "Tus textos"), references: t("References for your coach", "Referencias para tu asistente"), memory: t("Memory and saved context", "Memoria y contexto guardado") };
  return <section className="uw-library-resources" aria-labelledby="library-collection-heading">
    <div className="uw-library-heading"><div><h2 id="library-collection-heading">{titles[view]}</h2><p>{view === "writing" ? t("Your authored documents. Project filters only change this view; they never move writing or enable AI access.", "Tus documentos de autoría propia. Los filtros solo cambian esta vista; nunca mueven textos ni habilitan acceso de IA.") : view === "references" ? t("Files, websites and research notes for AI context. Permission and processing status are separate; an enabled source must also be ready before it can be used.", "Archivos, sitios y notas para el contexto de IA. El permiso y el procesamiento son distintos; una fuente habilitada también debe estar lista para usarse.") : t("AI memories and saved writing context are separate from your authored documents. Project filters do not change their permissions.", "La memoria de IA y el contexto de escritura guardado están separados de tus documentos de autoría propia. Los filtros no cambian sus permisos.")}</p></div><StudioButton variant="outline" disabled={!workspace.online || (load === "loading" || load === "refreshing") && !workspace.error} onClick={() => { void refresh(); if (view === "references") void sources.refetch(); }}><RefreshCw size={16} aria-hidden="true" />{t("Refresh library", "Actualizar biblioteca")}</StudioButton></div>
    <div className="uw-library-filters"><label>{t("Search titles", "Buscar títulos")}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><label>{t("Filter by project", "Filtrar por proyecto")}<select value={project} onChange={event => setProject(event.target.value)}><option value="all">{t("All projects", "Todos los proyectos")}</option><option value="general">{t("General Writing", "Escritura general")}</option>{workspace.state?.projects.map(row => <option key={row.id} value={row.id}>{row.name}{row.status === "archived" ? t(" · Archived", " · Archivado") : ""}</option>)}</select></label></div>
    {(load === "error" || workspace.error) && <p role="alert">{workspace.error || t("Library metadata could not be loaded. Refresh to try again.", "No se pudieron cargar los metadatos. Actualiza para reintentar.")}</p>}
    {view === "references" && sources.isError && <p role="status">{t("Source permissions are unavailable. Refresh before making changes.", "Los permisos de fuentes no están disponibles. Actualiza antes de cambiar nada.")}</p>}
    {error && <p role="alert">{error}</p>}
    {load === "loading" ? <p role="status">{t("Loading library metadata…", "Cargando metadatos de la biblioteca…")}</p> : load !== "error" && <><p role="status">{rows.length} {t("items in this view", "elementos en esta vista")}</p><div className="uw-library-grid">{rows.slice(0, limit).map(row => {
      const source = !sources.isError ? sources.data?.find(item => item.id === row.id) : undefined;
      const names = workspace.state?.projects.filter(item => workspace.ids(row.resource_kind, row.id).includes(item.id)).map(item => item.name) || [];
      const kind = row.resource_kind === "document" ? t("Authored writing", "Escritura propia") : row.resource_kind === "source" ? t("AI reference", "Referencia de IA") : row.resource_kind === "memory" ? t("AI memory", "Memoria de IA") : t("Saved writing context", "Contexto de escritura guardado");
      const state = source?.processing_status || row.state;
      const stateLabels: Record<string, string> = { active: t("Active", "Activo"), archived: t("Archived", "Archivado"), ready: t("Ready", "Listo"), pending: t("Pending processing", "Procesamiento pendiente"), processing: t("Processing", "Procesando"), failed: t("Processing failed", "Error de procesamiento") };
      return <StudioCard key={row.resource_kind + row.id} className="uw-library-resource" aria-busy={busy.includes(row.id)}><span className="uw-studio-eyebrow">{kind}</span><h3>{row.title || t("Untitled", "Sin título")}</h3><p className="uw-library-resource-state">{stateLabels[state] || state}{source?.processing_status === "processing" && typeof source.processing_progress === "number" ? ` · ${source.processing_progress}%` : ""}</p><p>{names.length ? names.join(" · ") : t("General Writing", "Escritura general")}</p>
        {view === "references" && source && <p>{source.enabled ? state === "ready" ? t("AI access allowed", "Acceso de IA permitido") : t("AI enabled · waiting for processing", "IA habilitada · esperando procesamiento") : t("AI access disabled", "Acceso de IA deshabilitado")}</p>}
        {view === "references" ? source ? <label className="uw-library-permission"><input type="checkbox" checked={source.enabled} disabled={!workspace.online || busy.includes(row.id)} onChange={event => void permission(source, event.target.checked)} />{t("Allow this reference for AI", "Permitir esta referencia para IA")}</label> : <p>{t("Permission not confirmed", "Permiso sin confirmar")}</p> : <p>{row.allowed ? t("AI access allowed", "Acceso de IA permitido") : t("AI access not allowed", "Acceso de IA no permitido")}</p>}
        {busy.includes(row.id) && <p role="status">{t("Saving permission…", "Guardando permiso…")}</p>}<div className="uw-library-actions">{row.resource_kind === "document" && <StudioLink variant="outline" to={recoveryPath(row.state === "archived" ? "/editor" : "/editor?document=" + encodeURIComponent(row.id))}>{row.state === "archived" ? t("Manage archived writing in the editor", "Gestionar textos archivados en el editor") : t("Open writing", "Abrir texto")}</StudioLink>}<StudioButton variant="ghost" disabled={!workspace.online} aria-label={t("Preview: ", "Vista previa: ") + row.title} onClick={() => setSelected(row)}>{t("Preview", "Vista previa")}</StudioButton></div>
      </StudioCard>;
    })}</div>{!rows.length && <StudioCard className="uw-library-intro"><h3>{t("A little room for what comes next.", "Un poco de espacio para lo que viene.")}</h3><p>{search || project !== "all" ? t("Try another title or project filter.", "Prueba otro título o filtro de proyecto.") : t("Nothing in this collection yet. Your other library sections are still available.", "Esta colección aún está vacía. Las otras secciones de tu biblioteca siguen disponibles.")}</p></StudioCard>}{rows.length > limit && <StudioButton variant="outline" onClick={() => setLimit(value => value + 24)}>{t("Show more items", "Ver más elementos")}</StudioButton>}</>}
    {selected && <StudioCard className="uw-library-preview" role="region" aria-label={t("Resource preview", "Vista previa del recurso")}><h3>{preview.data?.title || selected.title}</h3><p>{t("Previewing does not change AI permissions.", "La vista previa no cambia los permisos de IA.")}</p>{preview.isError ? <p role="status">{t("Preview unavailable. Close it and try again when connected.", "Vista previa no disponible. Ciérrala y reintenta al conectarte.")}</p> : preview.data ? <pre>{preview.data.text || t("No text preview is available yet.", "Aún no hay vista previa de texto.")}</pre> : <p role="status">{t("Loading preview…", "Cargando vista previa…")}</p>}<StudioButton variant="outline" onClick={() => setSelected(null)}>{t("Close preview", "Cerrar vista previa")}</StudioButton></StudioCard>}
    <div className="uw-library-footer">{view === "writing" ? <Link to={recoveryPath("/editor")}>{t("Manage folders, completed writing and trash in the editor", "Gestionar carpetas, textos completados y papelera en el editor")}</Link> : <Link to={recoveryPath("/library?view=projects")}>{t("Manage project memberships and add references in Projects", "Gestionar asignaciones y añadir referencias en Proyectos")}</Link>}{view === "references" && <p>{t("Use the extension to retry failed processing. Source permissions apply across projects; assigning a source to a project does not grant permission.", "Usa la extensión para reintentar el procesamiento fallido. Los permisos se aplican en todos los proyectos; asignar una fuente no concede permiso.")}</p>}</div>
  </section>;
}
