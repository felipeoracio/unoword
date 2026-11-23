import { useState } from "react";
import type { Project } from "../../../../shared/projects";
import type { useProjectWorkspace } from "@/lib/use-project-workspace";
import "@/styles/document-ai-context.css";

/** Small AI-target catalogue. It never selects a writing workspace or moves resources. */
export default function AIProjects({ workspace, active, onOpen, language = "en", headingLevel = 2 }: {
  workspace: ReturnType<typeof useProjectWorkspace>; active: string | null;
  onOpen: (id: string | null) => void; language?: string; headingLevel?: 1 | 2;
}) {
  const t = (en: string, es: string) => language === "es" ? es : en;
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const [selected, setSelected] = useState<string | null>(active);
  const [draft, setDraft] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const projects = workspace.state?.projects || [];
  const project = projects.find(row => row.id === selected);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      const existing = projects.find(row => row.id === draft.id);
      const matches = existing && existing.name === draft.name.trim() && existing.description === draft.description;
      const id = matches ? existing.id : await workspace.saveProject({ ...existing, ...draft, name: draft.name.trim(), status: existing?.status || "in_progress" });
      setDraft(current => current ? { ...current, id } : null);
      if (workspace.online && !(await workspace.flush())) throw Error("project_sync_pending");
      setSelected(id); setDraft(null);
    } catch { setError(t("The project could not sync. Your entries are still here; try again.", "No se pudo sincronizar el proyecto. Tus datos siguen aquí; inténtalo de nuevo.")); }
    finally { setBusy(false); }
  }
  async function archive(row: Project) {
    setBusy(true); setError("");
    try {
      await workspace.saveProject({ ...row, status: row.status === "archived" ? "in_progress" : "archived" });
      if (workspace.online && !(await workspace.flush())) throw Error("project_sync_pending");
    } catch { setError(t("The project change could not sync. Try again when connected.", "No se pudo sincronizar el cambio. Reintenta cuando tengas conexión.")); }
    finally { setBusy(false); }
  }
  async function resolve(keepLocal: boolean) {
    setBusy(true); setError("");
    try {
      await workspace.resolveConflict(keepLocal);
      if (workspace.online && !(await workspace.flush())) throw Error("project_sync_pending");
    } catch { setError(t("The project could not sync. Try again when connected.", "No se pudo sincronizar el proyecto. Reintenta cuando tengas conexión.")); }
    finally { setBusy(false); }
  }
  function list(rows: Project[]) {
    return rows.map(row => <div className="uw-ai-project-row" key={row.id}>
      <button type="button" onClick={() => { setSelected(row.id); setDraft(null); setError(""); }} disabled={busy}>{row.name}</button>
      {row.id === active && <small>{t("Chosen for suggestions", "Elegido para sugerencias")}</small>}
    </div>);
  }
  return <section className="uw-project-manager uw-ai-projects">
    <header><Heading>{t("Projects", "Proyectos")}</Heading><button type="button" disabled={busy || !workspace.ready} onClick={() => { setDraft({ name: "", description: "" }); setError(""); }}>{t("New Project", "Nuevo proyecto")}</button></header>
    <p>{t("Projects guide your AI suggestions. Your documents stay together in one library.", "Los proyectos orientan tus sugerencias de IA. Tus documentos permanecen juntos en una biblioteca.")}</p>
    {error && <p role="alert">{error}</p>}
    {workspace.conflict && <div role="alert"><p>{t("This project changed on another device. Choose the saved version or retry your changes.", "Este proyecto cambió en otro dispositivo. Elige la versión guardada o reintenta tus cambios.")}</p><button type="button" disabled={busy} onClick={() => void resolve(false)}>{t("Use saved version", "Usar versión guardada")}</button><button type="button" disabled={busy} onClick={() => void resolve(true)}>{t("Retry my changes", "Reintentar mis cambios")}</button></div>}
    {!workspace.ready && <p role="status">{workspace.error ? t("AI projects could not load.", "No se pudieron cargar los proyectos de IA.") : t("Opening AI projects…", "Abriendo proyectos de IA…")}{workspace.error && <button type="button" onClick={() => void workspace.refresh()}>{t("Retry", "Reintentar")}</button>}</p>}
    {!workspace.online && <p role="status">{t("Offline · project changes are saved on this device until you reconnect.", "Sin conexión · los cambios se guardan en este dispositivo hasta que te conectes.")}</p>}
    <div className="uw-ai-project-list">{list(projects.filter(row => row.status !== "archived"))}</div>
    {projects.some(row => row.status === "archived") && <details><summary>{t("Archived projects", "Proyectos archivados")}</summary>{list(projects.filter(row => row.status === "archived"))}</details>}
    {draft ? <form className="uw-project-detail uw-ai-project-form" onSubmit={event => void save(event)}>
      <h3>{draft.id ? t("Edit AI project", "Editar proyecto de IA") : t("New AI project", "Nuevo proyecto de IA")}</h3>
      <label>{t("Project name", "Nombre del proyecto")}<input value={draft.name} maxLength={150} required disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>{t("What should AI know about this project?", "¿Qué debe saber la IA sobre este proyecto?")}<textarea value={draft.description} maxLength={4000} disabled={busy} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      <div><button type="submit" disabled={busy || !draft.name.trim()}>{busy ? t("Saving…", "Guardando…") : t("Save project", "Guardar proyecto")}</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>{t("Cancel", "Cancelar")}</button></div>
    </form> : project ? <div className="uw-project-detail uw-ai-project-summary">
      <h3>{project.name}</h3>{project.description && <p>{project.description}</p>}
      <div><button type="button" disabled={busy || project.status === "archived"} onClick={() => onOpen(project.id)}>{t("Use for suggestions", "Usar para sugerencias")}</button>
        <button type="button" disabled={busy} onClick={() => setDraft({ id: project.id, name: project.name, description: project.description })}>{t("Edit project", "Editar proyecto")}</button>
        <button type="button" disabled={busy} onClick={() => void archive(project)}>{project.status === "archived" ? t("Restore project", "Restaurar proyecto") : t("Archive project", "Archivar proyecto")}</button></div>
    </div> : <p>{t("Choose a project to use or edit it, or add a new one.", "Elige un proyecto para usarlo o editarlo, o añade uno nuevo.")}</p>}
    <button type="button" disabled={busy} onClick={() => onOpen(null)}>{t("Use General writing", "Usar Escritura general")}</button>
  </section>;
}
