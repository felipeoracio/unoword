import { useEffect, useRef, useState } from 'react';
import { GUIDED_PRESETS, GUIDED_MAX_WORDS, GUIDED_INTENTIONS, validGuidedGoal, validGuidedDirection, readGuidedPlan, guidedProgress, type GuidedPlan, type GuidedRequest, type GuidedIntention } from '../../../shared/guided-writing';
import type { Activity } from '@/lib/writing';
import '@/styles/guided-writing.css';

type Direction = NonNullable<GuidedPlan['direction']>;
export type GuidedGeneration = GuidedRequest & { adaptive: boolean };
export default function GuidedWritingSession({owner,documentId,currentSession,sessions,language,focus,disabled,aiDisabled,contextKey,contextLabel,onGenerate,onStart,onStatus,onFocus,onReview}: {
 owner:string;documentId:string;currentSession:Activity|null;sessions:Activity[];language:string;focus:boolean;disabled:boolean;aiDisabled:boolean;contextKey:string;contextLabel:string;
 onGenerate:(request:GuidedGeneration)=>Promise<Direction>;onStart:()=>string|null;onStatus:(id:string,status:'active'|'paused'|'ended')=>void;onFocus:()=>void;onReview:()=>void;
}) {
 const es=language==='es',t=(en:string,spanish:string)=>es?spanish:en;
 const key=`uno-guided-session:${owner}:${documentId}`,preferenceKey=`uno-guided-goal:${owner}`;
 const [plan,setPlan]=useState<GuidedPlan>(()=>{try{const recovered=readGuidedPlan(localStorage.getItem(key),owner,documentId);if(recovered)return recovered;const goal=Number(localStorage.getItem(preferenceKey));return {version:1,owner,documentId,goal:validGuidedGoal(goal)?goal:250,intention:'surprise',sessionId:null,direction:null,contextKey,completionDismissed:false};}catch{return {version:1,owner,documentId,goal:250,intention:'surprise',sessionId:null,direction:null,contextKey,completionDismissed:false};}});
 const [goalInput,setGoalInput]=useState(String(plan.goal)),[custom,setCustom]=useState(!GUIDED_PRESETS.includes(plan.goal as typeof GUIDED_PRESETS[number]));
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[storageError,setStorageError]=useState(false);
 const details=useRef<HTMLDetailsElement>(null),request=useRef(0),inFlight=useRef(false);
 const record=currentSession?.id===plan.sessionId?currentSession:sessions.find(s=>s.id===plan.sessionId);
 const running=!!record && record.timer?.status!=='ended';
 const progress=guidedProgress(record?.typed_words||0,plan.goal);
 const validInput=validGuidedGoal(Number(goalInput)) && goalInput.trim()!=='';
 useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(plan));localStorage.setItem(preferenceKey,String(plan.goal));setStorageError(false);}catch{setStorageError(true);}},[key,preferenceKey,plan]);
 useEffect(()=>{setConsent(false);request.current++;},[contextKey]);
 useEffect(()=>()=>{request.current++;},[]);
 function changeGoal(value:string){setGoalInput(value);setConsent(false);const goal=Number(value);if(validGuidedGoal(goal))setPlan(p=>({...p,goal,direction:null,sessionId:record?.timer?.status==='ended'?null:p.sessionId,completionDismissed:false}));}
 function another(){setPlan(p=>({...p,sessionId:null,direction:null,completionDismissed:false,contextKey}));setConsent(false);setError('');if(details.current)details.current.open=true;}
 async function generate(adaptive=false){
  if(inFlight.current || aiDisabled || disabled || !consent || !validInput)return;
  inFlight.current=true;setBusy(true);setError('');const nonce=++request.current;
  try{const direction=await onGenerate({goal:plan.goal,written_words:running?progress.written:0,intention:plan.intention,original_direction:plan.contextKey===contextKey?plan.direction?.text||'':'',session_text:'',adaptive});
   if(nonce!==request.current)return;
   if(!validGuidedDirection(direction.guided_direction) || direction.guided_direction.goal!==plan.goal || direction.guided_direction.target_words!==Math.max(0,plan.goal-(running?progress.written:0)) || typeof direction.text!=='string' || direction.text.length>1100)throw Error(t('The direction could not be validated. Please try again.','No se pudo validar la orientación. Inténtalo de nuevo.'));
   setPlan(p=>({...p,direction,contextKey,sessionId:record?.timer?.status==='ended'?null:p.sessionId}));
  }catch(e){if(nonce===request.current)setError(e instanceof Error?e.message:t('Guidance is unavailable. You can still start writing.','La guía no está disponible. Puedes empezar a escribir.'));}
  finally{inFlight.current=false;setBusy(false);}
 }
 const intentions:Record<GuidedIntention,[string,string]>={continue:['Continue writing','Continuar escribiendo'],expand:['Expand an idea','Desarrollar una idea'],new:['Start something new','Empezar algo nuevo'],perspective:['Explore a different perspective','Explorar otra perspectiva'],surprise:['Surprise me','Sorpréndeme']};
 return <details className="uw-guided-session" ref={details} data-focus-mode={focus} data-session-id={plan.sessionId||undefined}>
  <summary><strong>{t('Guided Writing Session','Sesión de escritura guiada')}</strong>{plan.sessionId && <span>{progress.written.toLocaleString()} / {plan.goal.toLocaleString()} {t('words','palabras')}</span>}</summary>
  <div className="uw-guided-content">
   {!running && <header><h2>{t('How much would you like to write today?','¿Cuánto te gustaría escribir hoy?')}</h2><p>{t('Set a goal, find your direction, and make progress one word at a time.','Elige una meta, encuentra tu rumbo y avanza palabra a palabra.')}</p></header>}
   <p className="uw-guided-muted">{t('AI context','Contexto de IA')}: {contextLabel} <button type="button" onClick={onReview}>{t('Review context','Revisar contexto')}</button></p>
   <div className="uw-guided-fields">
    <label>{t('Session word goal','Meta de palabras de la sesión')}<select aria-label={t('Session word goal','Meta de palabras de la sesión')} value={custom?'custom':String(plan.goal)} disabled={busy||disabled} onChange={e=>{if(e.target.value==='custom')setCustom(true);else{setCustom(false);changeGoal(e.target.value);}}}>{GUIDED_PRESETS.map(n=><option key={n} value={n}>{n.toLocaleString()} {t('words','palabras')}</option>)}<option value="custom">{t('Custom word count','Cantidad personalizada')}</option></select></label>
    {custom && <label>{t('Custom session goal','Meta personalizada')}<input aria-label={t('Custom session goal','Meta personalizada')} type="number" min={1} max={GUIDED_MAX_WORDS} step={1} value={goalInput} disabled={busy||disabled} onChange={e=>changeGoal(e.target.value)} /></label>}
    <label>{t('Writing intention','Intención de escritura')}<select aria-label={t('Writing intention','Intención de escritura')} value={plan.intention} disabled={busy||disabled} onChange={e=>{setPlan(p=>({...p,intention:e.target.value as GuidedIntention,direction:null}));setConsent(false);}}>{GUIDED_INTENTIONS.map(i=><option key={i} value={i}>{intentions[i][es?1:0]}</option>)}</select></label>
   </div>
   {!validInput && <p role="alert">{t('Choose a whole number from 1 to 10,000.','Elige un número entero entre 1 y 10.000.')}</p>}
   {plan.direction && <section className="uw-guided-direction" aria-label={t('Your writing direction','Tu orientación de escritura')}><h3>{plan.direction.title}</h3><p>{plan.direction.text}</p><details><summary>{t('Suggested breakdown','Desglose sugerido')} · {plan.direction.guided_direction.target_words.toLocaleString()} {t('words','palabras')}</summary><ul>{plan.direction.guided_direction.sections.map((s,i)=><li key={i}>{s.title} — {s.words.toLocaleString()} {t('words','palabras')}</li>)}</ul></details></section>}
   {plan.sessionId && <div className="uw-guided-progress"><span>{progress.written.toLocaleString()} / {plan.goal.toLocaleString()} {t('words','palabras')} · {progress.percent}%</span><progress max={100} value={progress.percent} aria-label={t('Guided session progress','Progreso de la sesión guiada')}/><span>{progress.remaining.toLocaleString()} {t('words to go.','palabras por escribir.')}</span></div>}
   {progress.complete && plan.sessionId && !plan.completionDismissed && <p role="status">{t('Your goal is complete. Your story is still yours to tell.','Tu meta está cumplida. Tu historia sigue siendo tuya.')}</p>}
   {record?.timer?.status==='ended' && <p role="status">{t('Session finished. Every word was progress.','Sesión terminada. Cada palabra fue un avance.')}</p>}
   {error && <p role="alert">{error} {t('You can still write and track this session without AI.','Puedes escribir y registrar esta sesión sin IA.')}</p>}
   {storageError && <p role="alert">{t('Session guidance could not be saved on this device. Keep this page open; document saving remains separate.','No se pudo guardar la guía en este dispositivo. Mantén esta página abierta; el documento se guarda por separado.')}</p>}
   <label className="uw-guided-consent"><input type="checkbox" checked={consent} disabled={busy||disabled||aiDisabled} onChange={e=>setConsent(e.target.checked)}/>{t('Allow this AI request using the project and permitted document context shown above.','Permitir esta solicitud de IA con el proyecto y contexto autorizado indicados arriba.')}</label>
   <small className="uw-guided-muted">{t('Directions use your suggestion allowance. Help me continue uses Writing Guidance. AI never inserts or changes your writing.','Las orientaciones usan tu asignación de sugerencias. Ayúdame a continuar usa la guía de escritura. La IA nunca inserta ni cambia tu texto.')}</small>
   <div className="uw-guided-actions">
    {!running && record?.timer?.status!=='ended' && <button type="button" className="uw-editor-primary" disabled={busy||disabled||!validInput} onClick={()=>{const id=onStart();if(id){setPlan(p=>({...p,sessionId:id,completionDismissed:false}));onFocus();}}}>{t('Start writing','Empezar a escribir')}</button>}
    {running && <><button type="button" disabled={disabled} onClick={()=>{setPlan(p=>({...p,completionDismissed:true}));onFocus();}}>{t('Continue writing','Continuar escribiendo')}</button><button type="button" disabled={disabled} onClick={()=>onStatus(plan.sessionId!,record?.timer?.status==='paused'?'active':'paused')}>{record?.timer?.status==='paused'?t('Resume guided session','Reanudar sesión guiada'):t('Pause guided session','Pausar sesión guiada')}</button><button type="button" disabled={disabled} onClick={()=>onStatus(plan.sessionId!,'ended')}>{t('Finish session','Terminar sesión')}</button></>}
    <button type="button" disabled={busy||disabled||aiDisabled||!consent||!validInput||(running&&progress.complete)} onClick={()=>void generate()}>{busy?t('Finding your direction…','Buscando tu rumbo…'):plan.direction?t('Generate another suggestion','Generar otra sugerencia'):t('Find my direction','Encontrar mi rumbo')}</button>
    {running && plan.direction && progress.remaining>0 && <button type="button" disabled={busy||disabled||aiDisabled||!consent||plan.contextKey!==contextKey} onClick={()=>void generate(true)}>{t('Help me continue','Ayúdame a continuar')}</button>}
    {plan.sessionId && <button type="button" disabled={busy||disabled} onClick={()=>{if(running)onStatus(plan.sessionId!,'ended');another();}}>{t('Start another session','Empezar otra sesión')}</button>}
   </div>
  </div>
 </details>;
}
