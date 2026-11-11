import { useEffect, useRef, useState } from "react";
import { prompts } from "./writing";

export type QuickPrompt = { id: string; text: string };

/** Home and Ideas share the same daily static prompt; no AI or account writes. */
export function useQuickPrompt(owner: string | undefined, date: string, language: string, themes: string[], ready: boolean) {
  const key = owner ? `uno-home-quick-prompt:${owner}:${date}:${language}` : "";
  const [state, setState] = useState<{ key: string; prompt: QuickPrompt } | null>(null);
  const history = useRef<string[]>([]), themesRef = useRef(themes);
  themesRef.current = themes;
  function save(prompt: QuickPrompt, storageKey: string) {
    setState({ key: storageKey, prompt });
    try { localStorage.setItem(storageKey, JSON.stringify({ prompt, history: history.current })); } catch { /* Optional preference only. */ }
  }
  useEffect(() => {
    if (!key || !ready) return;
    const pool = prompts.buildPool(themesRef.current, language);
    const validThemes = pool.length ? themesRef.current : ["surprise-me"];
    let saved: { prompt?: QuickPrompt; history?: string[] } | null = null;
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* Storage is optional. */ }
    history.current = Array.isArray(saved?.history) ? saved.history.filter(id=>typeof id==="string").slice(0,12) : [];
    // Only library entries can be restored from browser storage.
    const bank = prompts.buildPool(["surprise-me"], language);
    const restored = bank.find(prompt=>prompt.id===saved?.prompt?.id);
    const picked = restored || prompts.pickPrompt(validThemes, language, history.current);
    setState({ key, prompt: picked });
    try { localStorage.setItem(key, JSON.stringify({ prompt: picked, history: history.current })); } catch { /* Storage is optional. */ }
  }, [key, language, ready]);
  const prompt = ready && state?.key===key ? state.prompt : null;
  function another() {
    if (!prompt) return;
    history.current = [prompt.id, ...history.current].slice(0,12);
    const selected = prompts.buildPool(themesRef.current, language).length ? themesRef.current : ["surprise-me"];
    save(prompts.pickPrompt(selected, language, history.current), key);
  }
  return { prompt, another };
}
