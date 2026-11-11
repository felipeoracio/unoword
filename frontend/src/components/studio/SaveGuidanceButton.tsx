import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, Check } from "lucide-react";
import { apiPut } from "@/lib/api";
import type { AISuggestion } from "@/lib/ai-types";

export default function SaveGuidanceButton({id,owner,online,language}:{id:string;owner:string;online:boolean;language:string}) {
  const [state,setState]=useState<"idle"|"busy"|"saved"|"error">("idle");
  const mounted=useRef(false),client=useQueryClient(),es=language==="es";
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  async function save(){
    if(state==="busy" || state==="saved" || !online)return;
    setState("busy");
    try{
      const result=await apiPut<AISuggestion>(`/ai/suggestions/${encodeURIComponent(id)}/save`,{});
      if(result.user_id!==owner)throw Error("account_changed");
      void client.invalidateQueries({queryKey:["saved-ai-ideas",owner]});
      if(mounted.current)setState("saved");
    }catch{if(mounted.current)setState("error");}
  }
  return <div className="uw-coach-save"><button type="button" disabled={!online || state==="busy" || state==="saved"} onClick={()=>void save()}>{state==="saved"?<Check size={15} aria-hidden="true"/>:<Bookmark size={15} aria-hidden="true"/>}{state==="saved"?(es?"Idea guardada":"Idea saved"):state==="busy"?(es?"Guardando…":"Saving…"):(es?"Guardar idea":"Save idea")}</button>{state==="error" && <p role="status">{es?"No se pudo guardar la idea. Inténtalo de nuevo.":"The idea could not be saved. Try again."}</p>}</div>;
}
