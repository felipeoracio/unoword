import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, BookOpen, FileText, FolderKanban, Lightbulb, LibraryBig, NotebookPen } from "lucide-react";
import Brand from "@/components/marketing/Brand";
import AppShell from "@/components/studio/AppShell";
import { StudioCard, StudioLink, StudioPageHeader } from "@/components/studio/StudioPrimitives";
import ProjectManager from "@/components/projects/ProjectManager";
import GuidedWritingProfile from "@/components/projects/GuidedWritingProfile";
import LibraryResources from "@/components/studio/LibraryResources";
import { useStudioAccount } from "@/lib/use-studio-account";
import { useProjectWorkspace } from "@/lib/use-project-workspace";
import { useStudioPreferences } from "@/lib/studio-preferences";
import { recoveryPath } from "@/lib/domain-recovery";
import { revealOpacity } from "@/lib/motion";
import "@/styles/projects.css";
import "@/styles/studio-library.css";

const sections = [
  ["writing", "Writing", "Escritura", FileText],
  ["projects", "Projects", "Proyectos", FolderKanban],
  ["references", "References", "Referencias", BookOpen],
  ["memory", "Memory", "Memoria", NotebookPen],
  ["ideas", "Ideas", "Ideas", Lightbulb],
  ["profile", "Writing profile", "Perfil de escritura", LibraryBig],
] as const;

export default function Library({ initialView = "writing" }: { initialView?: string }) {
  const account = useStudioAccount(), { language } = useStudioPreferences();
  const workspace = useProjectWorkspace(account.owner, account.paid, account.online);
  const [params] = useSearchParams(), navigate = useNavigate(), [error, setError] = useState("");
  const requested = params.get("view") || initialView;
  const view = sections.some(section => section[0] === requested) ? requested : "writing";
  const es = language === "es", t = (en: string, spanish: string) => es ? spanish : en;
  const panel = useRef<HTMLDivElement>(null);
  const panelMotion = useRef<Animation|null>(null);
  const previousView = useRef(view);
  useEffect(() => {
    const changed = previousView.current !== view;
    previousView.current = view;
    if (!changed || !panel.current || view === "profile") return;
    const animation = revealOpacity(panel.current, 0.98);
    panelMotion.current = animation;
    return () => animation?.cancel();
  }, [view, account.owner, account.paid]);
  async function openProject(id: string | null) {
    try {
      setError(""); await workspace.select(id);
      if (account.online && !(await workspace.flush())) throw Error("sync");
      navigate(recoveryPath("/editor"));
    } catch { setError(t("The project selection could not sync. Your writing is preserved.", "No se pudo sincronizar la selección. Tus textos se conservan.")); }
  }
  if (!account.user) return <main className="uw-library-gate" lang={language}><Brand /><h1>{t("A place for your writing.", "Un lugar para tu escritura.")}</h1>
    {account.online && account.account.isPending ? <p role="status">{t("Opening your library…", "Abriendo tu biblioteca…")}</p> : <><p>{account.online ? t("Sign in to open your private library.", "Inicia sesión para abrir tu biblioteca privada.") : t("Reconnect to verify your account. Saved writing is available in the offline editor.", "Conéctate para verificar tu cuenta. Tu escritura guardada está disponible en el editor sin conexión.")}</p><Link to={recoveryPath(account.online ? "/account?next=%2Flibrary" : "/editor")}>{account.online ? t("Sign in", "Iniciar sesión") : t("Open writing editor", "Abrir editor")}</Link></>}
  </main>;
  return <AppShell user={account.user}><main className="uw-library" data-testid="studio-library">
    <StudioPageHeader title={t("Your library", "Tu biblioteca")} eyebrow={t("Room for every chapter.", "Espacio para cada capítulo.")} description={t("Find your writing, organize projects, and choose what informs your writing coach.", "Encuentra tus textos, organiza proyectos y elige qué informa a tu asistente.")} actions={<StudioLink to={recoveryPath(account.paid ? "/editor" : "/account#install")}>{t("Start Writing", "Empezar a escribir")}<ArrowRight size={16} aria-hidden="true" /></StudioLink>} />
    <div className="uw-library-content">
      <nav className="uw-section-nav" aria-label={t("Library sections", "Secciones de biblioteca")}>{sections.map(([id, en, spanish, Icon]) => <Link key={id} to={recoveryPath("/library?view=" + id)} aria-current={view === id ? "page" : undefined}><Icon size={18} aria-hidden="true" />{es ? spanish : en}</Link>)}</nav>
      <div ref={panel} className="uw-library-panel" key={account.owner + ":" + account.paid}
        onBeforeInputCapture={() => panelMotion.current?.cancel()}>
        {!account.online && <p role="status">{t("Offline · last loaded library metadata. Source permissions need a connection.", "Sin conexión · últimos metadatos cargados. Los permisos de fuentes necesitan conexión.")}</p>}
        {error && <p role="alert">{error}</p>}
        {view === "ideas" ? <StudioCard className="uw-library-intro"><h2>{t("Ideas for another day", "Ideas para otro día")}</h2><p>{t("Quick Prompts and browser bookmarks live in Ideas. Saved AI guidance stays separate from authored writing, and loads only when you request it.", "Las ideas rápidas y los marcadores del navegador están en Ideas. La guía de IA guardada sigue separada de tus textos y se carga solo cuando la solicitas.")}</p><StudioLink variant="outline" to="/ideas">{t("Open Ideas", "Abrir Ideas")}<ArrowRight size={16} aria-hidden="true" /></StudioLink></StudioCard>
          : !account.paid ? <StudioCard className="uw-library-intro"><h2>{t("Your library stays yours.", "Tu biblioteca sigue siendo tuya.")}</h2><p>{t("Pro includes writing, projects, references, memory and your writing profile. Your existing content is preserved on Free. Quick Prompts remain available in Ideas.", "Pro incluye textos, proyectos, referencias, memoria y tu perfil de escritura. Tu contenido existente se conserva en Free. Las ideas rápidas siguen disponibles en Ideas.")}</p><StudioLink variant="outline" to="/account?plan=pro">{t("Explore Pro", "Explorar Pro")}</StudioLink></StudioCard>
          : view === "projects" ? <ProjectManager key={account.owner} headingLevel={2} workspace={workspace} active={workspace.state?.preferences.active_project_id || null} onOpen={id => void openProject(id)} onProfile={() => navigate(recoveryPath("/library?view=profile"))} language={language} />
          : view === "profile" ? <section className="uw-library-profile"><h2>{t("Your writing profile", "Tu perfil de escritura")}</h2><p>{t("Optional answers guide your coach. Your existing free-text profile is preserved, and project preferences still apply within each project.", "Las respuestas opcionales orientan a tu asistente. Tu perfil de texto existente se conserva y las preferencias de cada proyecto siguen aplicándose.")}</p>{workspace.ready ? <GuidedWritingProfile key={account.owner} owner={account.user.id} workspace={workspace} language={language} /> : <p role="status">{workspace.error || t("Opening your profile…", "Abriendo tu perfil…")}</p>}<StudioLink variant="outline" to={recoveryPath("/editor?profile=1")}>{t("Edit free-text profile in the editor", "Editar el perfil de texto en el editor")}</StudioLink></section>
          : <LibraryResources key={account.owner + ":" + view} owner={account.user.id} workspace={workspace} view={view as "writing" | "references" | "memory"} language={language} />}
      </div>
    </div>
  </main></AppShell>;
}
