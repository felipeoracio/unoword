import { useEffect, useRef, useState } from "react";
import type { ImportPreview } from "@/lib/document-import";
import { importNotes } from "@/lib/document-import";
export default function DocumentImportReview({preview,busy,spanish,onCancel,onCreate}:{preview:ImportPreview|null;busy:boolean;spanish:boolean;onCancel:()=>void;onCreate:(title:string)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),[title,setTitle]=useState('');
 useEffect(()=>{setTitle(preview?.title||'');if(preview)dialog.current?.showModal();else dialog.current?.close()},[preview]);
 function text(node:NonNullable<ImportPreview['content']>):string{return node.type==='text'?node.text||'':(node.content||[]).map(text).join(node.type==='paragraph'?'':'\n')}
 const tr=(en:string,es:string)=>spanish?es:en;
 return <dialog ref={dialog} className="uw-editor-dialog uw-import-review" aria-label={tr('Review import','Revisar importación')} onCancel={event=>{event.preventDefault();if(!busy)onCancel()}}>
  <form onSubmit={event=>{event.preventDefault();if(title.trim()&&!busy)onCreate(title.trim())}}><h2>{tr('Review import','Revisar importación')}</h2><p>{tr('This creates a new document in your current project. Your existing draft stays intact. Imported words do not count as newly typed session progress.','Se creará un documento nuevo en tu proyecto actual. Tu borrador se conserva. Las palabras importadas no cuentan como progreso escrito en la sesión.')}</p>
  <label>{tr('Document title','Título del documento')}<input aria-label={tr('Imported document title','Título del documento importado')} value={title} maxLength={300} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>
  <h3>{tr('Compatibility notes','Notas de compatibilidad')}</h3><ul>{(preview?.warnings||[]).map(code=><li key={code}>{(importNotes[code]||importNotes.unsupported_content)[spanish?1:0]}</li>)}</ul>
  <h3>{tr('Text preview','Vista previa del texto')}</h3><pre tabIndex={0} role="region" aria-label={tr('Imported text preview','Vista previa del texto importado')}>{preview?text(preview.content).slice(0,1200):''}</pre>
  <div className="uw-editor-dialog-actions"><button type="button" disabled={busy} onClick={onCancel}>{tr('Cancel','Cancelar')}</button><button type="submit" className="uw-editor-primary" disabled={busy||!title.trim()}>{busy?tr('Creating…','Creando…'):tr('Create new document','Crear documento nuevo')}</button></div></form>
 </dialog>;
}
