import { useEffect, useState } from "react";
import { prompts } from "./writing";

const known = new Set(["en", "es"].flatMap(language=>prompts.buildPool(["surprise-me"],language).map(prompt=>prompt.id)));
export function useSavedPrompts(owner: string | undefined) {
  const key = owner ? "uno-saved-prompts:" + owner : "";
  const [state, setState] = useState<{key:string; ids:string[]}>({key:"",ids:[]});
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    const read = () => {
      let ids: string[] = [];
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(saved)) ids = [...new Set(saved.filter(id=>typeof id==="string" && known.has(id)))].slice(0,known.size);
        setStorageFailed(false);
      } catch { setStorageFailed(true); }
      setState({key,ids});
    };
    read();
    const change = (event: StorageEvent) => { if (event.key===key || event.key===null) read(); };
    window.addEventListener("storage", change);
    return () => window.removeEventListener("storage", change);
  }, [key]);
  const ids = state.key===key ? state.ids : [];
  function toggle(id: string) {
    if (!owner || !known.has(id)) return;
    // Read current storage before editing so another tab's latest saves survive.
    let current = ids;
    try { if (!storageFailed) { const stored = JSON.parse(localStorage.getItem(key) || "null"); if (Array.isArray(stored)) current = stored.filter(id=>typeof id==="string" && known.has(id)); } } catch { /* Session-only fallback. */ }
    const next = [...new Set(current.includes(id) ? current.filter(value=>value!==id) : [...current,id])].slice(0,known.size);
    setState({key,ids:next});
    try { localStorage.setItem(key,JSON.stringify(next)); setStorageFailed(false); } catch { setStorageFailed(true); }
  }
  return { ids, toggle, storageFailed };
}
