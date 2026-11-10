import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Brand from "@/components/marketing/Brand";
import ProjectManager from "@/components/projects/ProjectManager";
import GuidedWritingProfile from "@/components/projects/GuidedWritingProfile";
import { useWritingWorkspace } from "@/lib/use-writing-workspace";
import { useProjectWorkspace } from "@/lib/use-project-workspace";
import "@/styles/writing-editor.css";
import "@/styles/projects.css";
import AppShell from "@/components/studio/AppShell";
import { StudioPageHeader } from "@/components/studio/StudioPrimitives";
import { useStudioPreferences } from "@/lib/studio-preferences";
export default function Projects() {
  const ws = useWritingWorkspace(),
    workspace = useProjectWorkspace(
      ws.user?.id,
      !!ws.user?.ai_access,
      ws.online,
      ws.flushWrites,
    ),
    navigate = useNavigate(),
    dialog = useRef<HTMLDialogElement>(null),
    [error, setError] = useState("");
  const { language } = useStudioPreferences(),
    es = language === "es";
  if (ws.loading)
    return (
      <main className="uw-writing-gate" role="status">
        {es ? "Cargando proyectos…" : "Loading projects…"}
      </main>
    );
  if (!ws.user)
    return (
      <main className="uw-writing-gate">
        <Brand />
        <h1>
          {es
            ? "Tus proyectos, en un solo lugar"
            : "Your projects, in one place"}
        </h1>
        <Link to="/account?next=/editor">
          {es ? "Inicia sesión para continuar" : "Sign in to continue"}
        </Link>
      </main>
    );
  if (!ws.user.ai_access)
    return (
      <main className="uw-writing-gate">
        <Brand />
        <h1>
          {es ? "Proyectos con UnoWord Pro" : "Projects with UnoWord Pro"}
        </h1>
        <p>
          {es
            ? "Tus documents y recursos existentes se conservan."
            : "Your existing documents and resources are preserved."}
        </p>
        <Link to="/account?plan=pro">{es ? "Ver planes" : "View plans"}</Link>
      </main>
    );
  async function open(id: string | null) {
    try {
      setError("");
      await workspace.select(id);
      if (ws.online && !(await workspace.flush())) throw Error("sync");
      navigate("/editor");
    } catch {
      setError(
        es
          ? "No se pudo sincronizar la selección. Tus cambios siguen guardados."
          : "The project selection could not sync. Your changes are still saved.",
      );
    }
  }
  return (
    <AppShell user={ws.user}>
    <StudioPageHeader title={es ? "Biblioteca y proyectos" : "Library & projects"}
      description={es ? "Tu escritura y tus recursos, con espacio para cada idea." : "Your writing and resources, with space for every idea."} />
    <main className="uw-editor uw-project-page" lang={language}>
      <header className="uw-editor-header">
        <Brand />
        <nav className="uw-project-actions">
          <Link to="/editor">{es ? "Editor" : "Writing editor"}</Link>
          <Link to="/account">{es ? "Cuenta" : "Account"}</Link>
        </nav>
      </header>
      {error && <p role="alert">{error}</p>}
      <ProjectManager
        headingLevel={2}
        workspace={workspace}
        active={workspace.state?.preferences.active_project_id || null}
        onOpen={(id) => void open(id)}
        onProfile={() => dialog.current?.showModal()}
        language={language}
      />
      <dialog
        className="uw-editor-dialog uw-project-dialog"
        ref={dialog}
        aria-label={es ? "Mi perfil de escritura" : "My Writing Profile"}
      >
        <div className="uw-project-dialog-inner">
          <button type="button" onClick={() => dialog.current?.close()}>
            {es ? "Cerrar" : "Close"}
          </button>
          <GuidedWritingProfile
            owner={ws.user.id}
            workspace={workspace}
            language={language}
          />
          <p>
            <Link to="/editor?profile=1">
              {es
                ? "Editar mi perfil de texto libre en el editor"
                : "Edit my free-text profile in the editor"}
            </Link>
          </p>
        </div>
      </dialog>
    </main>
    </AppShell>
  );
}
