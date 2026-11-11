import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Check, Copy, Lightbulb, PenLine, RefreshCw, Search, Sparkles } from "lucide-react";
import AppShell from "@/components/studio/AppShell";
import { StudioButton, StudioCard, StudioLink } from "@/components/studio/StudioPrimitives";
import Brand from "@/components/marketing/Brand";
import SavedGuidance from "@/components/studio/SavedGuidance";
import { apiGet } from "@/lib/api";
import { useStudioAccount } from "@/lib/use-studio-account";
import { useStudioPreferences } from "@/lib/studio-preferences";
import { useQuickPrompt, type QuickPrompt } from "@/lib/use-quick-prompt";
import { useSavedPrompts } from "@/lib/use-saved-prompts";
import { promptThemeLabel } from "@/lib/prompt-themes";
import type { WritingPreferences } from "@/lib/use-account-writing";
import { prompts, writingDates } from "@/lib/writing";
import { preparePromptDraft } from "@/lib/editor-launch";
import { recoveryPath } from "@/lib/domain-recovery";
import promptArt from "@/assets/studio/prompts/writing-path.webp";
import emptyArt from "@/assets/studio/empty-states/ideas.webp";
import "@/styles/studio-home.css";
import "@/styles/studio-ideas.css";
import "@/styles/studio-coaching.css";

export default function Ideas() {
  const account = useStudioAccount(), { language } = useStudioPreferences(), navigate = useNavigate();
  const es = language === "es", t = (en: string, spanish: string) => es ? spanish : en;
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState("selected"), [search, setSearch] = useState("");
  const [view, setView] = useState<"explore" | "saved">("explore"), [limit, setLimit] = useState(9);
  const [notice, setNotice] = useState<{owner: string; text: string; copied?: string} | null>(null);
  const preferences = useQuery({ queryKey: ["studio-home-preferences", account.owner],
    queryFn: async () => {
      const value = await apiGet<WritingPreferences>("/progress/preferences");
      if (value.user_id!==account.owner) throw Error("account_changed");
      return value;
    }, enabled: !!account.owner && account.online, retry: false, gcTime: 0,
    refetchInterval: 15000, refetchOnWindowFocus: true, refetchOnReconnect: true });
  const selectedThemes = preferences.data?.themes || ["surprise-me"];
  const timezone = preferences.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const date = writingDates.dayKey(now,timezone);
  const { prompt, another } = useQuickPrompt(account.owner,date,language,selectedThemes,preferences.isFetched || !account.online);
  const saved = useSavedPrompts(account.owner);
  const library = useMemo(()=>prompts.buildPool(["surprise-me"],language),[language]);
  const savedLibrary = useMemo(()=>["en","es"].flatMap(lang=>prompts.buildPool(["surprise-me"],lang)),[]);
  const chosenThemes = filter==="selected" ? selectedThemes : [filter];
  const pool = prompts.buildPool(chosenThemes,language);
  const available = view==="saved" ? savedLibrary.filter(item=>saved.ids.includes(item.id)) : pool.length ? pool : library;
  const results = available.filter(item=>{
    const matchesTheme = view!=="saved" || filter==="surprise-me" || (filter==="selected" ? !pool.length || selectedThemes.includes("surprise-me") || !selectedThemes.length || selectedThemes.includes(item.theme) : item.theme===filter);
    return matchesTheme && (item.text+" "+promptThemeLabel(item.theme,language)).toLocaleLowerCase(language).includes(search.trim().toLocaleLowerCase(language));
  });
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return ()=>clearInterval(timer);},[]);
  useEffect(()=>{setLimit(9);},[filter,search,view,language,account.owner]);
  useEffect(()=>{setFilter("selected");setSearch("");setView("explore");setNotice(null);},[account.owner]);

  async function startPrompt(chosen: QuickPrompt) {
    const owner=account.owner;
    if (!owner) return;
    if(account.paid){
      try { navigate(recoveryPath(preparePromptDraft(owner,chosen))); }
      catch { setNotice({owner,text:t("Select the prompt to copy it, then open your editor.","Selecciona la idea para copiarla y abre el editor.")}); }
    }else{
      try { await navigator.clipboard.writeText(chosen.text);setNotice({owner,copied:chosen.id,text:t("Prompt copied. Write in your own words in your writing app.","Idea copiada. Escribe con tus propias palabras en tu aplicación de escritura.")}); }
      catch { setNotice({owner,text:t("Select the prompt text and copy it manually.","Selecciona el texto de la idea y cópialo manualmente.")}); }
    }
  }
  function saveButton(chosen: QuickPrompt) {
    const active=saved.ids.includes(chosen.id);
    return <StudioButton variant="ghost" size="icon" aria-pressed={active}
      aria-label={(active?t("Unsave prompt: ","Quitar idea guardada: "):t("Save prompt: ","Guardar idea: "))+chosen.text}
      onClick={()=>saved.toggle(chosen.id)}>{active?<Check aria-hidden="true" />:<Bookmark aria-hidden="true" />}</StudioButton>;
  }
  if(!account.user) return <main className="uw-home-gate" lang={language}><Brand /><h1>{t("A space for your next idea", "Un espacio para tu próxima idea")}</h1>
    {account.online && account.account.isPending ? <p role="status">{t("Opening your ideas…","Abriendo tus ideas…")}</p> : <><p>{account.online?t("Sign in to explore writing prompts and save your favorites.","Inicia sesión para explorar ideas de escritura y guardar tus favoritas."):t("Reconnect to verify your account. Your saved writing is available in the offline editor.","Conéctate para verificar tu cuenta. Tu escritura guardada está disponible en el editor sin conexión.")}</p><Link to={recoveryPath(account.online?"/account?next=%2Fideas":"/editor")}>{account.online?t("Sign in","Iniciar sesión"):t("Open writing editor","Abrir editor")}</Link></>}
  </main>;

  return <AppShell user={account.user}><main className="uw-home uw-ideas" data-testid="studio-ideas">
    <header className="uw-studio-page-header uw-ideas-welcome"><div><p className="uw-studio-eyebrow">{t("A little inspiration goes a long way.","Un poco de inspiración abre caminos.")}</p><h1>{t("Follow your curiosity.","Sigue tu curiosidad.")}</h1><p>{t("Find a question, a memory, a place to begin. The words are yours.","Encuentra una pregunta, un recuerdo, un punto de partida. Las palabras son tuyas.")}</p></div></header>
    <div className="uw-home-content">
      {!account.online && <p role="status" className="uw-ideas-status">{t("Offline · Quick Prompts and browser saves still work.","Sin conexión · las ideas rápidas y los guardados del navegador siguen disponibles.")}</p>}
      {preferences.isError && <p role="status" className="uw-ideas-status">{t("Your theme preferences are unavailable. You can still explore every prompt.","Tus preferencias de temas no están disponibles. Puedes explorar todas las ideas.")}</p>}
      <div className="uw-ideas-featured">
        <StudioCard className="uw-home-prompt"><img className="uw-home-prompt-art" src={promptArt} alt="" width={1200} height={800} />
          <div className="uw-home-prompt-content"><div className="uw-home-card-heading"><h2><Sparkles size={22} aria-hidden="true" />{t("Today’s Quick Prompt","Tu idea rápida de hoy")}</h2>{prompt && saveButton(prompt)}</div>
            <span className="uw-home-label">{t("Free + Pro · no AI credits","Free + Pro · sin créditos de IA")}</span>
            <p className="uw-home-prompt-text">{prompt?.text || t("Finding a little inspiration…","Buscando un poco de inspiración…")}</p>
            <div className="uw-home-actions"><StudioButton variant="outline" disabled={!prompt} onClick={()=>prompt && void startPrompt(prompt)}><PenLine aria-hidden="true" />{t("Use This Prompt","Usar esta idea")}<ArrowRight aria-hidden="true" /></StudioButton><StudioButton variant="ghost" size="icon" disabled={!prompt} aria-label={t("Another Quick Prompt","Otra idea rápida")} onClick={another}><RefreshCw aria-hidden="true" /></StudioButton></div>
            <p className="uw-home-note">{account.paid?t("Opens a new, empty draft. Your existing writing stays saved.","Abre un nuevo borrador vacío. Tu escritura existente se conserva."):t("Copy a prompt and write in the app you already use.","Copia una idea y escribe en la aplicación que ya usas.")}</p>
          </div>
        </StudioCard>
        <StudioCard className="uw-ideas-coach"><span className="uw-ideas-coach-icon"><Lightbulb size={28} aria-hidden="true" /></span><span className="uw-studio-eyebrow">{t("Your writing. New possibilities.","Tu escritura. Nuevas posibilidades.")}</span><h2>{t("A little help finding your next step.","Un poco de ayuda para dar el siguiente paso.")}</h2>
          <p>{account.paid?t("Open your draft to explore questions and directions with your writing coach. You choose what to share and when to ask.","Abre tu borrador para explorar preguntas y caminos con tu asistente de escritura. Tú eliges qué compartir y cuándo pedir ayuda."):t("Quick Prompts are always free. Pro also includes a writing coach, the built-in editor and your document library.","Las ideas rápidas siempre son gratis. Pro también incluye un asistente de escritura, el editor integrado y tu biblioteca.")}</p>
          <StudioLink variant="outline" to={recoveryPath(account.paid?"/editor?assistant=1":"/account?plan=pro")}>{account.paid?t("Open writing coach","Abrir asistente"):t("Explore Pro","Explorar Pro")}<ArrowRight aria-hidden="true" /></StudioLink>
          <small>{t("Opening the coach does not generate AI suggestions.","Abrir el asistente no genera sugerencias de IA.")}</small>
        </StudioCard>
      </div>
      <p role="status" className="uw-ideas-status" aria-live="polite">{notice && notice.owner===account.owner?notice.text:""}</p>
      <section className="uw-ideas-library" aria-labelledby="ideas-library-heading">
        <div className="uw-home-section-heading"><h2 id="ideas-library-heading"><Lightbulb size={23} aria-hidden="true" />{t("A place to begin","Un punto de partida")}</h2><span className="uw-home-label">{t("Quick Prompts · always free","Ideas rápidas · siempre gratis")}</span></div>
        <div className="uw-ideas-filters"><div className="uw-ideas-views" role="group" aria-label={t("Prompt collection","Colección de ideas")}><StudioButton variant={view==="explore"?"default":"outline"} aria-pressed={view==="explore"} onClick={()=>setView("explore")}>{t("Explore prompts","Explorar ideas")}</StudioButton><StudioButton variant={view==="saved"?"default":"outline"} aria-pressed={view==="saved"} onClick={()=>{setView("saved");setFilter("surprise-me");}}><Bookmark size={16} aria-hidden="true" />{t("Saved prompts","Ideas guardadas")} <span>({saved.ids.length})</span></StudioButton></div>
          <label className="uw-ideas-theme">{t("Theme","Tema")}<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="selected">{t("Your selected themes","Tus temas seleccionados")}</option><option value="surprise-me">{t("All themes","Todos los temas")}</option>{prompts.ALL_THEMES.filter(theme=>theme!=="surprise-me").map(theme=><option key={theme} value={theme}>{promptThemeLabel(theme,language)}</option>)}</select></label>
          <label className="uw-ideas-search"><span>{t("Search prompts","Buscar ideas")}</span><div><Search size={18} aria-hidden="true" /><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder={t("A word, a feeling, a theme…","Una palabra, un sentimiento, un tema…")} /></div></label>
        </div>
        <p className="uw-ideas-library-note">{t("Saved prompts stay on this browser for your account.","Las ideas guardadas se quedan en este navegador para tu cuenta.")} {saved.storageFailed && <strong role="status">{t("Browser storage is unavailable. Saves will last for this visit only.","El almacenamiento del navegador no está disponible. Los guardados duran solo esta visita.")}</strong>}</p>
        <p className="uw-ideas-result-count" role="status">{results.length} {t("prompts","ideas")}</p>
        {results.length ? <><div className="uw-ideas-grid">{results.slice(0,limit).map(item=><StudioCard className="uw-ideas-prompt-card" key={item.id} data-prompt-id={item.id}><div className="uw-home-card-heading"><span className="uw-studio-eyebrow">{promptThemeLabel(item.theme,language)}{view==="saved" && !item.id.startsWith(language+":")?" · "+(item.id.startsWith("es:")?"ES":"EN"):""}</span>{saveButton(item)}</div><h3>{item.text}</h3><StudioButton variant="ghost" className="uw-ideas-use" onClick={()=>void startPrompt(item)}>{account.paid?<PenLine size={16} aria-hidden="true" />:<Copy size={16} aria-hidden="true" />}{account.paid?t("Start a draft","Empezar un borrador"):notice?.owner===account.owner && notice?.copied===item.id?t("Copied","Copiada"):t("Copy prompt","Copiar idea")}<ArrowRight size={16} aria-hidden="true" /></StudioButton></StudioCard>)}</div>{results.length>limit && <StudioButton className="uw-ideas-more" variant="outline" onClick={()=>setLimit(value=>value+9)}>{t("Show more prompts","Ver más ideas")}</StudioButton>}</>
          : <StudioCard className="uw-home-empty"><img src={emptyArt} alt="" width={1000} height={700} /><div><h3>{view==="saved" && !search?t("Keep an idea for another day.","Guarda una idea para otro día."):t("Try a different word or theme.","Prueba otra palabra u otro tema.")}</h3><p>{view==="saved" && !search?t("Save a prompt with the bookmark button. It will be waiting here on this browser.","Guarda una idea con el botón de marcador. Te esperará aquí en este navegador."):t("There are more places to begin. Clear your search or explore all themes.","Hay más puntos de partida. Borra la búsqueda o explora todos los temas.")}</p><StudioButton variant="ghost" onClick={()=>{setSearch("");setFilter("surprise-me");setView("explore");}}>{t("Explore all prompts","Explorar todas las ideas")}<ArrowRight size={16} aria-hidden="true" /></StudioButton></div></StudioCard>}
      </section>
      <SavedGuidance key={account.owner} owner={account.user.id} paid={account.paid} online={account.online} language={language}/>
    </div>
  </main></AppShell>;
}
