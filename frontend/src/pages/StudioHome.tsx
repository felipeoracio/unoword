import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PenLine, Lightbulb, ArrowRight, RefreshCw, Sparkles, Flame, Target, FileText, Clock3, Check, Copy, X, Chrome } from "lucide-react";
import AppShell from "@/components/studio/AppShell";
import { StudioButton, StudioLink, StudioCard, StudioStatus } from "@/components/studio/StudioPrimitives";
import Brand from "@/components/marketing/Brand";
import { useStudioHome } from "@/lib/use-studio-home";
import { useStudioPreferences } from "@/lib/studio-preferences";
import { prompts, writingDates } from "@/lib/writing";
import { apiPut, ApiError } from "@/lib/api";
import { preparePromptDraft } from "@/lib/editor-launch";
import { recoveryPath } from "@/lib/domain-recovery";
import { formatWritingTime } from "@/lib/use-account-writing";
import promptArt from "@/assets/studio/prompts/writing-path.webp";
import emptyArt from "@/assets/studio/empty-states/documents.webp";
import mountainCover from "@/assets/studio/covers/mountain-sunrise.webp";
import forestCover from "@/assets/studio/covers/forest-path.webp";
import lakeCover from "@/assets/studio/covers/lakeside-reflection.webp";
import "@/styles/studio-home.css";

type Prompt = { id: string; text: string };
const covers = [mountainCover, forestCover, lakeCover];

export default function StudioHome() {
  const home = useStudioHome(), { language } = useStudioPreferences(), navigate = useNavigate(), client = useQueryClient();
  const es = language === "es", t = (en: string, spanish: string) => es ? spanish : en;
  const [now, setNow] = useState(Date.now());
  const [prompt, setPrompt] = useState<Prompt | null>(null), history = useRef<string[]>([]);
  const [notice, setNotice] = useState("");
  const [goalOpen, setGoalOpen] = useState(false), [goalInput, setGoalInput] = useState(""),
    [goalBusy, setGoalBusy] = useState(false), [goalError, setGoalError] = useState("");
  const goalDialog = useRef<HTMLDialogElement>(null), goalTrigger = useRef<HTMLButtonElement>(null);
  const identity = useRef(home.owner); identity.current = home.owner;
  const summary = home.summary.isError ? undefined : home.summary.data;
  const preferences = home.preferences.isError ? undefined : home.preferences.data;
  const timezone = summary?.timezone || home.timezone;
  const date = summary?.reportingDate || writingDates.dayKey(now, timezone);
  const promptKey = home.owner ? `uno-home-quick-prompt:${home.owner}:${date}:${language}` : "";
  const themes = preferences?.themes || ["surprise-me"];
  const themesRef = useRef(themes); themesRef.current = themes;
  const promptReady = home.preferences.isFetched || !home.online;
  useEffect(() => { const timer=setInterval(()=>setNow(Date.now()),60000); return ()=>clearInterval(timer); }, []);
  useEffect(() => {
    if (!promptKey || !promptReady) { setPrompt(null); return; }
    let saved: { prompt?: Prompt; history?: string[] } | null = null;
    try { saved = JSON.parse(localStorage.getItem(promptKey) || "null"); } catch { /* Static prompts still work without storage. */ }
    history.current = Array.isArray(saved?.history) ? saved.history.filter(id=>typeof id==="string").slice(0,12) : [];
    const picked = saved?.prompt && typeof saved.prompt.id === "string" && typeof saved.prompt.text === "string" && saved.prompt.text.length <= 300
      ? saved.prompt : prompts.pickPrompt(themesRef.current, language, history.current);
    setPrompt(picked);
    try { localStorage.setItem(promptKey, JSON.stringify({prompt:picked,history:history.current})); } catch { /* Optional preference only. */ }
    setNotice("");
  }, [promptKey, language, promptReady]);
  useEffect(() => { if (goalOpen) goalDialog.current?.showModal(); else goalDialog.current?.close(); }, [goalOpen]);
  useEffect(() => { setGoalOpen(false); setGoalBusy(false); setGoalError(""); setNotice(""); }, [home.owner]);

  function anotherPrompt() {
    if (!prompt) return;
    history.current = [prompt.id, ...history.current].slice(0,12);
    const next=prompts.pickPrompt(themesRef.current, language, history.current);
    setPrompt(next); setNotice("");
    try { localStorage.setItem(promptKey,JSON.stringify({prompt:next,history:history.current})); } catch { /* Optional preference only. */ }
  }
  async function handlePrompt() {
    if (!prompt || !home.owner) return;
    if (home.paid) {
      try { navigate(recoveryPath(preparePromptDraft(home.owner,prompt))); }
      catch { setNotice(t("Your browser could not prepare the prompt. Copy it and open the editor.", "Tu navegador no pudo preparar la idea. Cópiala y abre el editor.")); }
    } else {
      try { await navigator.clipboard.writeText(prompt.text); setNotice(t("Prompt copied. Use it in your writing app and track your session with the extension.", "Idea copiada. Úsala en tu aplicación de escritura y registra la sesión con la extensión.")); }
      catch { setNotice(t("Select the prompt above and copy it manually.", "Selecciona la idea de arriba y cópiala manualmente.")); }
    }
  }
  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    const owner=home.owner, revision=preferences?.revision, goal=Number(goalInput);
    if (!owner || revision===undefined || goalBusy || !home.online) return;
    if (!Number.isInteger(goal) || goal<1 || goal>1000000) { setGoalError(t("Choose a whole number from 1 to 1,000,000.","Elige un número entero entre 1 y 1.000.000.")); return; }
    setGoalBusy(true); setGoalError("");
    try {
      const saved=await apiPut<{user_id:string}>("/progress/preferences",{expected_user_id:owner,revision,daily_goal:goal});
      if(identity.current!==owner || saved.user_id!==owner)return;
      await Promise.all([client.invalidateQueries({queryKey:["account-writing",owner]}),client.invalidateQueries({queryKey:["studio-home-preferences",owner]})]);
      if(identity.current===owner)setGoalOpen(false);
    } catch(error) {
      if(identity.current===owner){
        setGoalError(error instanceof ApiError && error.status===409
          ? t("Your goal changed on another device. The latest value was kept. Review it, then save again.","Tu meta cambió en otro dispositivo. Se conservó el valor más reciente. Revísalo y guarda de nuevo.")
          : t("Your goal could not be saved. Reconnect and try again.","No se pudo guardar la meta. Conéctate e inténtalo de nuevo."));
        void home.preferences.refetch();
      }
    } finally { if(identity.current===owner)setGoalBusy(false); }
  }
  if(!home.user) return <main className="uw-writing-gate uw-home-gate" lang={language}>
    <Brand /><h1>{t("Your writing studio", "Tu estudio de escritura")}</h1>
    {home.online && home.account.isPending ? <p role="status">{t("Opening your studio…", "Abriendo tu estudio…")}</p> : <>
      <p>{home.online ? t("Sign in to see your writing progress and find your next idea.", "Inicia sesión para ver tu progreso y encontrar tu próxima idea.") : t("Reconnect to open Home. Previously saved writing is available in the offline editor.", "Conéctate para abrir Inicio. La escritura guardada está disponible en el editor sin conexión.")}</p>
      <Link to={recoveryPath(home.online ? "/account?next=%2Fapp" : "/editor")}>{home.online ? t("Sign in", "Iniciar sesión") : t("Open writing editor", "Abrir editor")}</Link>
    </>}
  </main>;

  const number=(value: number | undefined)=>typeof value==="number"?value.toLocaleString(es?"es":"en"):"—";
  const hour=Number(new Intl.DateTimeFormat("en",{timeZone:timezone,hour:"numeric",hourCycle:"h23"}).format(now));
  const greeting=hour<12?t("Good morning!","¡Buenos días!"):hour<18?t("Good afternoon!","¡Buenas tardes!"):t("Good evening!","¡Buenas noches!");
  const goal=summary?.dailyGoal, written=summary?.dailyWordCount;
  const percent=goal && written!==undefined?Math.min(100,Math.round(written/goal*100)):undefined;
  const reached=goal && written!==undefined && written>=goal;
  const documents=home.paid && !home.recent.isError ? home.recent.data : undefined;
  return <AppShell user={home.user}>
    <main className="uw-home" data-testid="studio-home">
      <header className="uw-studio-page-header uw-home-welcome">
        <div><p className="uw-studio-eyebrow">{t("Every idea starts with UnoWord.", "Cada idea empieza con UnoWord.")}</p>
          <h1>{greeting}</h1><p>{t("A little space. A fresh thought. Your words.", "Un poco de espacio. Una nueva idea. Tus palabras.")}</p>
          <div className="uw-home-actions">
            <StudioLink to={recoveryPath(home.paid?"/editor":"/account#install")}><PenLine aria-hidden="true" />{t("Start Writing", "Empezar a escribir")}<ArrowRight aria-hidden="true" /></StudioLink>
            <StudioLink variant="outline" to="#home-prompt"><Lightbulb aria-hidden="true" />{t("Get Ideas", "Obtener ideas")}</StudioLink>
          </div>
          <p className="uw-home-start-note">{home.paid?t("Return to your unfinished writing, or begin a new draft in the editor.","Continúa tu escritura pendiente o empieza un nuevo borrador en el editor."):t("Use the Chrome extension to track writing in supported apps. The built-in editor requires Pro.","Usa la extensión de Chrome para registrar tu escritura en aplicaciones compatibles. El editor integrado requiere Pro.")}</p>
        </div>
      </header>
      <div className="uw-home-content">
        <div className="uw-home-sync"><StudioStatus tone={home.summary.isError?"error":!home.online?"pending":"neutral"}>
          {!home.online?t("Offline · last confirmed totals", "Sin conexión · últimos totales confirmados"):home.summary.isError?t("Progress unavailable · try refreshing", "Progreso no disponible · actualiza de nuevo"):home.summary.isFetching?t("Updating progress…", "Actualizando progreso…"):summary?t("Account progress updated", "Progreso de la cuenta actualizado"):t("Loading progress…", "Cargando progreso…")}
        </StudioStatus><StudioButton variant="ghost" disabled={!home.online || home.summary.isFetching} onClick={()=>void home.refresh()}><RefreshCw aria-hidden="true" />{t("Refresh", "Actualizar")}</StudioButton></div>
        <div className="uw-home-overview">
          <StudioCard className="uw-home-prompt" id="home-prompt" tabIndex={-1}>
            <img className="uw-home-prompt-art" src={promptArt} alt="" width="1200" height="800" />
            <div className="uw-home-prompt-content"><h2><Sparkles size={22} aria-hidden="true" />{t("Today’s Writing Prompt", "Tu idea de escritura de hoy")}</h2>
              <span className="uw-home-label">Quick Prompt · {t("Free + Pro · no AI credits", "Free + Pro · sin créditos de IA")}</span>
              <p className="uw-home-prompt-text">{prompt?.text || t("Finding a little inspiration…", "Buscando un poco de inspiración…")}</p>
              <div className="uw-home-actions"><StudioButton variant="outline" disabled={!prompt} onClick={()=>void handlePrompt()}>{home.paid?<PenLine aria-hidden="true" />:<Copy aria-hidden="true" />}{t("Use This Prompt", "Usar esta idea")}<ArrowRight aria-hidden="true" /></StudioButton>
                <StudioButton variant="ghost" size="icon" disabled={!prompt} aria-label={t("Another Quick Prompt", "Otra idea rápida")} onClick={anotherPrompt}><RefreshCw aria-hidden="true" /></StudioButton></div>
              <p className="uw-home-note">{home.paid?t("Opens a new draft. Your existing writing stays saved.","Abre un nuevo borrador. Tu escritura existente se conserva."):t("Copy the prompt and write in your own words.","Copia la idea y escribe con tus propias palabras.")}</p>
              <p role="status" className="uw-home-note">{notice}</p>
            </div>
          </StudioCard>
          <StudioCard className="uw-home-progress" id="home-progress" tabIndex={-1}>
            <div className="uw-home-card-heading"><h2><Target size={22} aria-hidden="true" />{t("Your Progress", "Tu progreso")}</h2>
              <StudioButton ref={goalTrigger} variant="ghost" size="icon" disabled={!home.online || !preferences} aria-label={t("Edit daily goal", "Editar meta diaria")} onClick={()=>{setGoalInput(String(goal||preferences?.daily_goal||250));setGoalError("");setGoalOpen(true);}}><PenLine aria-hidden="true" /></StudioButton></div>
            <div className="uw-home-goal-row"><div className="uw-home-ring" style={{"--goal-progress":`${percent||0}%`} as React.CSSProperties} role="progressbar" aria-label={t("Daily writing goal", "Meta diaria de escritura")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><strong>{percent===undefined?"—":`${percent}%`}</strong></div>
              <div><p><strong>{number(written)}</strong> / {number(goal)}</p><span>{t("words today", "palabras hoy")}</span></div></div>
            {reached && <p className="uw-home-achieved"><Check size={17} aria-hidden="true" />{t("You reached today’s goal. Enjoy what you’ve written.", "Alcanzaste tu meta de hoy. Disfruta lo que has escrito.")}</p>}
            <dl className="uw-home-metrics"><div><dt><Flame size={21} aria-hidden="true" />{t("Writing streak", "Racha de escritura")}</dt><dd>{number(summary?.displayedStreak)} {t("days", "días")}</dd></div><div><dt><PenLine size={20} aria-hidden="true" />{t("Total words", "Palabras totales")}</dt><dd>{number(summary?.lifetimeWordCount)}</dd></div></dl>
            <p className="uw-home-time"><Clock3 size={17} aria-hidden="true" />{t("Today’s Writing Time", "Tiempo de escritura de hoy")}<strong>{summary?formatWritingTime(summary.dailyActiveWritingSeconds):"—"}</strong></p>
            {!home.paid && summary && summary.displayedStreak>=7 && <p className="uw-home-note">{t("Your writing activity keeps being recorded. Pro reveals your full qualifying streak.", "Tu actividad sigue registrándose. Pro muestra tu racha completa válida.")} <Link to="/account?plan=pro">{t("Explore Pro", "Explorar Pro")}</Link></p>}
            <Link className="uw-home-text-link" to="/account#writing-progress">{t("View progress details", "Ver detalles del progreso")}<ArrowRight size={15} aria-hidden="true" /></Link>
          </StudioCard>
        </div>
        <section className="uw-home-recent" aria-labelledby="recent-heading"><div className="uw-home-section-heading"><h2 id="recent-heading"><FileText size={23} aria-hidden="true" />{t("Recent Writing", "Escritura reciente")}</h2>{home.paid && <Link className="uw-home-text-link" to="/projects">{t("View Library", "Ver biblioteca")}<ArrowRight size={16} aria-hidden="true" /></Link>}</div>
          {!home.paid ? <StudioCard className="uw-home-free"><Chrome size={26} aria-hidden="true" /><div><h3>{t("Your writing habit starts here.", "Tu hábito de escritura empieza aquí.")}</h3><p>{t("Track words, set goals, and explore unlimited Quick Prompts for free. The editor and document library are Pro features.", "Registra palabras, fija metas y explora ideas rápidas ilimitadas gratis. El editor y la biblioteca de documentos son funciones Pro.")}</p><Link className="uw-home-text-link" to="/account#install">{t("Set up the extension", "Configurar la extensión")}<ArrowRight size={16} aria-hidden="true" /></Link></div></StudioCard>
            : home.recent.isError ? <StudioCard className="uw-home-empty"><p role="status">{t("Recent writing could not be loaded. Your documents have not been changed.","No se pudo cargar la escritura reciente. Tus documentos no han cambiado.")}</p><Link to="/editor">{t("Open writing editor", "Abrir editor")}</Link></StudioCard>
            : !documents ? <p role="status">{t("Loading your recent writing…", "Cargando tu escritura reciente…")}</p>
            : documents.length ? <div className="uw-home-document-grid">{documents.map((document,index)=><StudioCard className="uw-home-document" key={document.id}>
              <Link to={recoveryPath("/editor?document="+encodeURIComponent(document.id))}><img src={covers[index%covers.length]} alt="" width="960" height="640" loading="lazy" /><div><h3>{document.title || t("Untitled", "Sin título")}</h3><span>{document.completion_status==="completed"?t("Completed", "Completado"):t("Draft", "Borrador")}</span><p>{t("Edited", "Editado")} <time dateTime={document.updated_at}>{new Intl.DateTimeFormat(es?"es":"en",{timeZone:timezone,month:"short",day:"numeric"}).format(new Date(document.updated_at))}</time></p></div><ArrowRight size={17} aria-hidden="true" /></Link>
            </StudioCard>)}</div> : <StudioCard className="uw-home-empty"><img src={emptyArt} alt="" width="1000" height="700" /><div><h3>{t("A little space for your next idea.", "Un poco de espacio para tu próxima idea.")}</h3><p>{t("Your recent writing will appear here. Open the editor to start a draft, or explore your library.","Tu escritura reciente aparecerá aquí. Abre el editor para empezar un borrador o explora tu biblioteca.")}</p><Link className="uw-home-text-link" to="/editor">{t("Start Writing", "Empezar a escribir")}<ArrowRight size={16} aria-hidden="true" /></Link></div></StudioCard>}
        </section>
      </div>
    </main>
    <dialog ref={goalDialog} className="uw-home-goal-dialog" aria-labelledby="home-goal-heading"
      onKeyDown={event=>{
        if(event.key!=="Tab")return;
        const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')].filter(element=>element.getClientRects().length>0);
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }}
      onCancel={event=>{if(goalBusy)event.preventDefault();else setGoalOpen(false);}} onClose={()=>{setGoalOpen(false);goalTrigger.current?.focus();}}>
      <form onSubmit={event=>void saveGoal(event)}><div className="uw-home-card-heading"><h2 id="home-goal-heading">{t("Your daily writing goal", "Tu meta diaria de escritura")}</h2><StudioButton type="button" variant="ghost" size="icon" disabled={goalBusy} aria-label={t("Close goal settings", "Cerrar ajustes de meta")} onClick={()=>setGoalOpen(false)}><X aria-hidden="true" /></StudioButton></div>
        <p>{t("Choose a target that feels right for today. It’s the same goal used across your account.","Elige una meta adecuada para hoy. Se usa la misma meta en toda tu cuenta.")}</p><label htmlFor="home-daily-goal">{t("Words per day", "Palabras al día")}</label><input id="home-daily-goal" type="number" min={1} max={1000000} step={1} required value={goalInput} onChange={event=>setGoalInput(event.target.value)} disabled={goalBusy}/>
        <small>{t("Current account goal:", "Meta actual de la cuenta:")} {number(preferences?.daily_goal)}</small>
        {goalError && <p role="alert">{goalError}</p>}<StudioButton type="submit" disabled={goalBusy || !home.online}>{goalBusy?t("Saving…", "Guardando…"):t("Save goal", "Guardar meta")}</StudioButton>
      </form>
    </dialog>
  </AppShell>;
}
