import { useEffect, useLayoutEffect, useState } from "react";

const widths = ["comfortable", "standard", "wide", "full"] as const;
export type PageWidth = (typeof widths)[number];
const valid = (value: unknown): value is PageWidth => widths.includes(value as PageWidth);
function readWidth(key: string): PageWidth {
  try {
    const value = localStorage.getItem(key);
    return valid(value) ? value : "comfortable";
  } catch { return "comfortable"; }
}

/** Browser presentation preference only; never mutates a writing document. */
export function usePageWidth(owner?: string) {
  const key = `uno-editor-page-width:${owner || "guest"}`;
  const [width, setWidth] = useState<PageWidth>(() => readWidth(key));
  useLayoutEffect(() => { setWidth(readWidth(key)); }, [key]);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setWidth(readWidth(key));
    };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [key]);
  return [width, (next: PageWidth) => {
    if (!valid(next)) return;
    setWidth(next);
    try { localStorage.setItem(key, next); }
    catch { /* The view remains usable when browser storage is unavailable. */ }
  }] as const;
}

