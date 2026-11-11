import { useEffect, useRef, useState } from "react";

/** Presentation only: never mounts, selects, saves or starts a writing session. */
export function useEditorPanels() {
  const [compact, setCompact] = useState(()=>matchMedia("(max-width: 1199px)").matches);
  const [focus, setFocus] = useState(false);
  const [left, setLeft] = useState(()=>!matchMedia("(max-width: 1199px)").matches);
  const [right, setRight] = useState(false);
  const libraryRef = useRef<HTMLElement>(null), assistantRef = useRef<HTMLElement>(null);
  const libraryTrigger = useRef<HTMLButtonElement>(null), assistantTrigger = useRef<HTMLButtonElement>(null);
  const overlayOpen = compact && !focus && (left || right);
  useEffect(()=>{
    const media=matchMedia("(max-width: 1199px)");
    const resize=()=>{setCompact(media.matches);setLeft(!media.matches);};
    media.addEventListener("change",resize);
    return ()=>media.removeEventListener("change",resize);
  },[]);
  useEffect(()=>{if(compact && left && right)setRight(false);},[compact,left,right]);
  useEffect(()=>{
    const escape=(event: KeyboardEvent)=>{
      if(event.key!=="Escape" || event.defaultPrevented || document.querySelector("dialog[open]"))return;
      setFocus(false);if(compact)setLeft(false);setRight(false);
    };
    window.addEventListener("keydown",escape);
    return ()=>window.removeEventListener("keydown",escape);
  },[compact]);
  useEffect(()=>{
    if(!overlayOpen)return;
    const panel=left?libraryRef.current:assistantRef.current;
    if(!panel)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const controls=()=>[...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter(element=>element.getClientRects().length>0);
    const frame=requestAnimationFrame(()=>controls()[0]?.focus({preventScroll:true}));
    const contain=(event: KeyboardEvent)=>{
      if(event.key!=="Tab" || document.querySelector("dialog[open]"))return;
      const targets=controls(),first=targets[0],last=targets.at(-1);
      if(event.shiftKey && (document.activeElement===first || !panel.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !panel.contains(document.activeElement))){event.preventDefault();first?.focus();}
    };
    document.addEventListener("keydown",contain);
    return ()=>{cancelAnimationFrame(frame);document.removeEventListener("keydown",contain);if(previous?.isConnected && !document.querySelector("dialog[open]"))previous.focus({preventScroll:true});};
  },[overlayOpen,left]);
  function toggleLibrary(){setFocus(false);setLeft(focus?true:!left);if(compact)setRight(false);}
  function toggleAssistant(){setFocus(false);setRight(focus?true:!right);if(compact)setLeft(false);}
  function closePanel(){setLeft(false);setRight(false);}
  return {focus,setFocus,left,setLeft,right,setRight,compact,overlayOpen,libraryRef,assistantRef,libraryTrigger,assistantTrigger,toggleLibrary,toggleAssistant,closePanel};
}
