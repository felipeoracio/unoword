import { useEffect, useLayoutEffect, useState } from "react";
function read(key: string) {
  try { return localStorage.getItem(key) !== "0"; } catch { return true; }
}
export function useSelectionTools(owner?: string) {
  const key = `uno-selection-tools:${owner || "guest"}`;
  const [enabled, setEnabled] = useState(() => read(key));
  useLayoutEffect(() => { setEnabled(read(key)); }, [key]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === key || event.key === null) setEnabled(read(key)); };
    window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, [key]);
  return [enabled, (value: boolean) => { setEnabled(value); try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* Presentation still works. */ } }] as const;
}
