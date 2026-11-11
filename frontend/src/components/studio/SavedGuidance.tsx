import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Copy, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AISuggestion } from "@/lib/ai-types";
import { StudioButton, StudioCard, StudioLink } from "./StudioPrimitives";
import WritingTask from "@/components/WritingTask";
import emptyArt from "@/assets/studio/empty-states/ideas.webp";

export default function SavedGuidance({owner,paid,online,language}:{owner:string;paid:boolean;online:boolean;language:string}) {
  const es=language==="es",t=(en:string,spanish:string)=>es?spanish:en;
  const [open,setOpen]=useState(false),[search,setSearch]=useState("");
  const [copied,setCopied]=useState(""),[copyError,setCopyError]=useState(false);
  const ideas=useQuery({queryKey:["saved-ai-ideas",owner],
    queryFn:async()=>{const rows=await apiGet<AISuggestion[]>("/ai/ideas");if(!Array.isArray(rows)||rows.some(row=>row.user_id!==owner))throw Error("account_changed");return rows;},
    enabled:open&&paid&&online,retry:false,gcTime:0,staleTime:0,refetchOnWindowFocus:true,refetchOnReconnect:true});
  const rows=paid && !ideas.isError?ideas.data:undefined;
  const filtered=rows?.filter(idea=>(idea.title+" "+idea.suggestion).toLocaleLowerCase(language).includes(search.trim().toLocaleLowerCase(language)));
  async function copy(idea:AISuggestion){try{await navigator.clipboard.writeText([idea.title,idea.suggestion,...idea.questions].filter(Boolean).join("\n\n"));setCopied(idea.id);setCopyError(false);}catch{setCopyError(true);}}
  return <section className="uw-saved-guidance" aria-labelledby="saved-guidance-heading">
    <div className="uw-home-section-heading"><h2 id="saved-guidance-heading"><Bookmark size={22} aria-hidden="true"/>{t("Saved AI ideas","Ideas de IA guardadas")} <span className="uw-coach-pro">Pro</span></h2><StudioButton variant="outline" aria-expanded={open} aria-controls="saved-guidance-list" onClick={()=>setOpen(!open)}>{open?t("Hide saved ideas","Ocultar ideas guardadas"):t("View saved ideas","Ver ideas guardadas")}</StudioButton></div>
    <p className="uw-ideas-library-note">{t("Revisit ideas you saved from your writing coach or extension. Reading saved ideas uses no AI credits.","Vuelve a las ideas que guardaste desde el asistente o la extensión. Leer ideas guardadas no consume créditos de IA.")}</p>
    {open && <div id="saved-guidance-list">
      {!paid?<StudioCard className="uw-home-empty"><div><h3>{t("Keep your next direction close.","Ten cerca tu próximo camino.")}</h3><p>{t("Pro includes saved AI ideas and personalized coaching. Quick Prompts remain free.","Pro incluye ideas de IA guardadas y asistencia personalizada. Las ideas rápidas siguen siendo gratis.")}</p><StudioLink variant="outline" to="/account?plan=pro">{t("Explore Pro","Explorar Pro")}<ArrowRight size={16} aria-hidden="true"/></StudioLink></div></StudioCard>
        :ideas.isError?<StudioCard><p role="status">{t("Saved ideas could not be loaded. Try again when connected.","No se pudieron cargar las ideas guardadas. Inténtalo cuando estés conectado.")}</p><StudioButton variant="ghost" disabled={!online} onClick={()=>void ideas.refetch()}><RefreshCw size={16} aria-hidden="true"/>{t("Try again","Reintentar")}</StudioButton></StudioCard>
        :!rows?<p role="status">{online?t("Loading your saved ideas…","Cargando tus ideas guardadas…"):t("Reconnect to load saved AI ideas. Quick Prompts are available above.","Conéctate para cargar las ideas de IA guardadas. Las ideas rápidas están disponibles arriba.")}</p>
        :<>{!online && <p role="status" className="uw-ideas-library-note">{t("Offline · last loaded saved ideas","Sin conexión · últimas ideas guardadas cargadas")}</p>}
          {!!rows.length && <label className="uw-saved-guidance-search">{t("Search saved AI ideas","Buscar ideas de IA guardadas")}<input type="search" value={search} onChange={event=>setSearch(event.target.value)}/></label>}
          {filtered?.length?<div className="uw-saved-guidance-grid">{filtered.map(idea=><StudioCard key={idea.id} className="uw-coach-idea" data-saved-idea={idea.id}>
            <span className="uw-studio-eyebrow">{t("AI idea · separate from your writing","Idea de IA · separada de tu escritura")}</span><h3>{idea.title}</h3><p className="uw-coach-idea-text">{idea.suggestion}</p>
            {!!idea.questions.length && <ul>{idea.questions.map((question,index)=><li key={index}>{question}</li>)}</ul>}
            {(idea.reason || idea.context_summary || idea.inspired_by.length>0) && <details><summary>{t("Why this idea · context","Por qué esta idea · contexto")}</summary>{idea.reason && <p>{idea.reason}</p>}{idea.context_summary && <p>{idea.context_summary}</p>}{!!idea.inspired_by.length && <ul>{idea.inspired_by.map(source=><li key={source.kind+source.source_id}>{source.title}</li>)}</ul>}</details>}
            <WritingTask task={idea.writing_task || undefined} owner={owner} id={idea.id} language={language}/>
            <StudioButton variant="ghost" onClick={()=>void copy(idea)}><Copy size={16} aria-hidden="true"/>{copied===idea.id?t("Idea copied","Idea copiada"):t("Copy idea","Copiar idea")}</StudioButton>
          </StudioCard>)}</div>:<StudioCard className="uw-home-empty"><img src={emptyArt} alt="" width={1000} height={700}/><div><h3>{rows.length?t("Try another search.","Prueba otra búsqueda."):t("A little room for new possibilities.","Un pequeño espacio para nuevas posibilidades.")}</h3><p>{rows.length?t("No saved ideas match those words.","Ninguna idea guardada coincide con esas palabras."):t("Save an idea from the writing coach or extension to find it here.","Guarda una idea del asistente o la extensión para encontrarla aquí.")}</p><StudioLink variant="outline" to="/editor?assistant=1">{t("Open writing coach","Abrir asistente")}<ArrowRight size={16} aria-hidden="true"/></StudioLink></div></StudioCard>}
        </>}
      <p role="status" className="uw-ideas-status">{copyError?t("Select the idea text and copy it manually.","Selecciona el texto de la idea y cópialo manualmente."):copied?t("Idea copied. It has not been inserted into your document.","Idea copiada. No se ha insertado en tu documento."):""}</p>
    </div>}
  </section>;
}
