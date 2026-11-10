import { useEffect, useState } from "react";

export type StudioTheme = "light" | "dark";
export type StudioLanguage = "en" | "es";
const changed = "uno-studio-preferences";

function read(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}
function current() {
  const theme = typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return {
    theme: (read("uno-writing-theme", theme) === "dark" ? "dark" : "light") as StudioTheme,
    language: (read("uno-writing-language", typeof navigator !== "undefined" ? navigator.language : "en").startsWith("es") ? "es" : "en") as StudioLanguage,
  };
}

// Reuse the editor's presentation preferences. No account or writing data lives here.
export function useStudioPreferences() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const refresh = (event: Event) => {
      const next = (event as CustomEvent<ReturnType<typeof current>>).detail;
      setValue(next && ["light", "dark"].includes(next.theme) && ["en", "es"].includes(next.language) ? next : current());
    };
    window.addEventListener("storage", refresh);
    window.addEventListener(changed, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(changed, refresh);
    };
  }, []);
  function update(theme: StudioTheme, language: StudioLanguage) {
    setValue({ theme, language });
    try {
      localStorage.setItem("uno-writing-theme", theme);
      localStorage.setItem("uno-writing-language", language);
    } catch { /* Presentation controls still work when storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(changed, { detail: { theme, language } }));
  }
  return {
    ...value,
    setTheme: (theme: StudioTheme) => update(theme, value.language),
    setLanguage: (language: StudioLanguage) => update(value.theme, language),
  };
}
