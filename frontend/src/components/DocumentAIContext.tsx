import { useEffect, useState } from "react";
import type { WritingDocument } from "@/lib/writing";
import type { Project } from "../../../shared/projects";

export type DocumentContextChoice = "off" | "all" | "selected";

export default function DocumentAIContext({ document, projects, assigned, ready, spanish, onSave }: {
  document: WritingDocument & { dirty?: boolean }; projects: Project[]; assigned: string[]; ready: boolean; spanish: boolean;
  onSave: (choice: DocumentContextChoice, ids: string[]) => Promise<void>;
}) {
  const t = (en: string, es: string) => spanish ? es : en;
  const saved = !document.ai_allowed ? "off" : document.ai_context_all_projects ? "all" : "selected";
  const [choice, setChoice] = useState<DocumentContextChoice>(saved);
  const [ids, setIds] = useState(assigned), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const assignedKey = [...assigned].sort().join(",");
  useEffect(() => { setChoice(saved); setIds(assignedKey ? assignedKey.split(",") : []); setError(""); }, [document.id, saved, assignedKey]);
  useEffect(() => { if (document.dirty === false) setError(""); }, [document.dirty]);
  const dirty = choice !== saved || (choice === "selected" && [...ids].sort().join(",") !== assignedKey);
  async function save() {
    setBusy(true); setError("");
    try { await onSave(choice, ids); }
    catch { setError(t("AI context could not be saved. Check your connection and try again.", "No se pudo guardar el contexto de IA. Revisa tu conexión e inténtalo de nuevo.")); }
    finally { setBusy(false); }
  }
  return <details className="uw-document-ai-context">
    <summary>{t("Use this document as AI context", "Usar este documento como contexto de IA")} <strong>{saved === "off" ? t("Off", "Desactivado") : saved === "all" ? t("All projects", "Todos los proyectos") : assigned.length ? t("Selected projects", "Proyectos seleccionados") : t("General writing", "Escritura general")}</strong></summary>
    <label>{t("Available for", "Disponible para")}
      <select aria-label={t("Document AI context", "Contexto de IA del documento")} value={choice} disabled={busy || !ready} onChange={event => setChoice(event.target.value as DocumentContextChoice)}>
        <option value="off">{t("Off — keep out of saved AI context", "Desactivado — excluir del contexto guardado")}</option>
        <option value="all">{t("All projects", "Todos los proyectos")}</option>
        <option value="selected">{t("Selected projects", "Proyectos seleccionados")}</option>
      </select>
    </label>
    {choice === "selected" && <fieldset disabled={busy || !ready}>
      <legend>{t("Choose projects", "Elige proyectos")}</legend>
      {projects.map(project => <label key={project.id}><input type="checkbox" checked={ids.includes(project.id)} onChange={event => setIds(current => event.target.checked ? [...current, project.id] : current.filter(id => id !== project.id))} />{project.name}{project.status === "archived" ? t(" (archived)", " (archivado)") : ""}</label>)}
      <small>{ids.length ? t("Only these projects may use this document as saved context.", "Solo estos proyectos pueden usar este documento como contexto guardado.") : t("No projects selected: available only for General writing.", "Sin proyectos seleccionados: disponible solo para Escritura general.")}</small>
    </fieldset>}
    <p>{t("This controls saved context. Sharing your current draft for one request remains a separate choice.", "Esto controla el contexto guardado. Compartir el borrador actual para una solicitud sigue siendo una elección aparte.")}</p>
    <button type="button" disabled={busy || !ready || (!dirty && !error)} onClick={() => void save()}>{busy ? t("Saving…", "Guardando…") : error ? t("Retry AI context", "Reintentar contexto de IA") : t("Save AI context", "Guardar contexto de IA")}</button>
    {error && <p role="alert">{error}</p>}
  </details>;
}
