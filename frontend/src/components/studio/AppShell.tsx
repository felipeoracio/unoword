import { useEffect, useId, useRef, useState, type ReactNode, type CSSProperties, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { House, PenLine, Lightbulb, ChartNoAxesColumnIncreasing, LibraryBig, Settings2, Award, Menu, X, Moon, Sun, ArrowUpRight } from "lucide-react";
import type { AuthUser } from "@/lib/auth-types";
import { recoveryPath } from "@/lib/domain-recovery";
import { useStudioPreferences, type StudioLanguage, type StudioTheme } from "@/lib/studio-preferences";
import { StudioButton } from "./StudioPrimitives";
import { studioArtwork } from "@/lib/studio-artwork";
import "@/styles/studio.css";

type Props = {
  user: Pick<AuthUser, "id" | "ai_access">;
  children: ReactNode;
  editor?: boolean;
  focusMode?: boolean;
  theme?: StudioTheme;
  language?: StudioLanguage;
  beforeNavigate?: () => Promise<boolean>;
};

/** Presentation-only shell. Existing screens retain their auth, saving and timers. */
export default function AppShell({ user, children, editor = false, focusMode = false, theme: suppliedTheme, language: suppliedLanguage, beforeNavigate }: Props) {
  const location = useLocation(), navigate = useNavigate(), preferences = useStudioPreferences();
  const theme = suppliedTheme || preferences.theme, language = suppliedLanguage || preferences.language;
  const es = language === "es", t = (en: string, spanish: string) => es ? spanish : en;
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const departure = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const contentId = useId(), titleId = useId();
  const paid = user.ai_access;
  const items = [
    { id: "home", label: t("Home", "Inicio"), href: "/app", icon: House },
    { id: "write", label: t("Write", "Escribir"), href: paid ? "/editor" : "/account#install", icon: PenLine },
    { id: "ideas", label: t("Ideas", "Ideas"), href: "/ideas", icon: Lightbulb },
    { id: "progress", label: t("Progress", "Progreso"), href: "/progress", icon: ChartNoAxesColumnIncreasing },
    { id: "library", label: t("Library", "Biblioteca"), href: "/projects", icon: LibraryBig, pro: !paid },
  ];
  const secondary = [
    { id: "rewards", label: t("Milestones", "Logros"), href: "/rewards", icon: Award },
    { id: "settings", label: t("Settings", "Ajustes"), href: "/account#account-settings", icon: Settings2 },
  ];
  const active = location.pathname === "/editor" ? (location.search.includes("assistant=1") ? "ideas" : "write")
    : location.pathname === "/projects" ? "library"
    : location.pathname === "/rewards" ? "rewards"
    : location.pathname === "/ideas" ? "ideas"
    : location.pathname === "/progress" ? "progress"
    : location.hash === "#writing-progress" ? "progress"
    : location.hash === "#account-settings" || location.search.includes("plan=") || location.search.includes("offer=") ? "settings"
    : location.hash === "#install" ? "write"
    : location.hash === "#quick-prompt" || location.hash === "#home-prompt" ? "ideas"
    : location.pathname === "/account" ? "settings" : "home";

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => { setOpen(false); }, [location.pathname, location.search, location.hash]);
  useEffect(() => {
    const media = matchMedia("(min-width: 900px)");
    const close = () => { if (media.matches) setOpen(false); };
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  useEffect(() => {
    if (!location.hash) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      if (target) { target.scrollIntoView({ block: "start" }); target.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);

  async function follow(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    setOpen(false);
    if (!beforeNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      || new URL(destination, window.location.origin).pathname === location.pathname) return;
    event.preventDefault();
    if (departure.current) return;
    departure.current = true;
    setLeaving(true);
    try {
      if (await beforeNavigate()) navigate(destination);
    } finally {
      departure.current = false;
      setLeaving(false);
    }
  }

  function navigation(mobile: boolean) {
    return <>
      <Link to={recoveryPath("/app")} className="uw-studio-brand" aria-label={t("UnoWord home", "Inicio de UnoWord")} onClick={event => void follow(event, recoveryPath("/app"))}>
        <img src="/brand/unoword.svg" alt="" width="40" height="40" />
        <span>Uno<span>Word</span></span>
      </Link>
      <nav aria-label={t("Writing studio", "Estudio de escritura")}>
        {[items, secondary].map((group, index) => <div className="uw-studio-nav-group" key={index}>
          {group.map(({ id, label, href, icon: Icon, ...item }) => <Link
            key={id} to={recoveryPath(href)} className="uw-studio-nav-link"
            aria-current={active === id ? "page" : undefined}
            aria-label={label + ("pro" in item && item.pro ? " · Pro" : "")}
            title={editor && !mobile ? label : undefined}
            onClick={event => void follow(event, recoveryPath(href))}
          >
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <span className="uw-studio-nav-label">{label}</span>
            {"pro" in item && item.pro === true && <small className="uw-studio-pro">Pro</small>}
          </Link>)}
        </div>)}
      </nav>
      <div className="uw-studio-sidebar-footer">
        <p>{t("Every idea starts with UnoWord.", "Cada idea empieza con UnoWord.")}</p>
        <Link to="/" onClick={event => void follow(event, "/")}>{t("Visit website", "Visitar sitio web")} <ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
    </>;
  }

  return <div className={`uw-studio${editor ? " uw-studio-editor" : ""}${focusMode ? " uw-studio-focused" : ""}`}
    data-studio-theme={theme} lang={language} data-testid="studio-shell"
    style={{
      ...(studioArtwork.sidebar ? { "--studio-sidebar-art": `url("${studioArtwork.sidebar}")` } : {}),
      ...(studioArtwork.header && theme !== "dark" ? { "--studio-header-art": `url("${studioArtwork.header}")` } : {}),
      ...(studioArtwork.mobileHeader && theme !== "dark" ? { "--studio-header-art-mobile": `url("${studioArtwork.mobileHeader}")` } : {}),
    } as CSSProperties}>
    <a className="uw-studio-skip" href={`#${contentId}`}>{t("Skip to content", "Saltar al contenido")}</a>
    <aside className="uw-studio-sidebar" aria-label={t("Main navigation", "Navegación principal")}>{navigation(false)}</aside>
    <div className="uw-studio-body">
      <div className="uw-studio-mobile-bar">
        <StudioButton ref={trigger} variant="ghost" size="icon" aria-label={t("Open navigation", "Abrir navegación")}
          aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Menu aria-hidden="true" /></StudioButton>
        <Link to={recoveryPath("/app")} onClick={event => void follow(event, recoveryPath("/app"))} className="uw-studio-mobile-brand"><img src="/brand/unoword.svg" alt="" width="28" height="28" />UnoWord</Link>
        <span className="uw-studio-plan">{paid ? "Pro" : t("Free", "Gratis")}</span>
      </div>
      {!editor && <div className="uw-studio-utility-bar">
        <span>{t("Your writing studio", "Tu estudio de escritura")}</span>
        <div>
          <span className="uw-studio-plan">{paid ? "Pro" : t("Free", "Gratis")}</span>
          <StudioButton variant="ghost" size="icon" onClick={() => preferences.setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t(theme === "dark" ? "Use light theme" : "Use dark theme", theme === "dark" ? "Usar tema claro" : "Usar tema oscuro")}>
            {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </StudioButton>
          <label className="uw-studio-language"><span className="uw-studio-sr-only">{t("Interface language", "Idioma de la interfaz")}</span>
            <select value={language} onChange={event => preferences.setLanguage(event.target.value as StudioLanguage)}><option value="en">EN</option><option value="es">ES</option></select>
          </label>
        </div>
      </div>}
      {leaving && <p className="uw-studio-departure" role="status">{t("Saving your writing before leaving…", "Guardando tu escritura antes de salir…")}</p>}
      <div id={contentId} className="uw-studio-content" tabIndex={-1}>{children}</div>
    </div>
    <dialog ref={dialog} className="uw-studio-drawer" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab") return;
        const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled), [tabindex="0"]')]
          .filter(element => element.getClientRects().length > 0);
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={() => setOpen(false)} onClose={() => { setOpen(false); trigger.current?.focus(); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="uw-studio-drawer-content">
        <h2 id={titleId} className="uw-studio-sr-only">{t("Navigation", "Navegación")}</h2>
        <StudioButton className="uw-studio-drawer-close" variant="ghost" size="icon" aria-label={t("Close navigation", "Cerrar navegación")} onClick={() => setOpen(false)}><X aria-hidden="true" /></StudioButton>
        {navigation(true)}
      </div>
    </dialog>
  </div>;
}
