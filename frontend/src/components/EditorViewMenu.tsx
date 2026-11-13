import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import type { PageWidth } from "@/lib/use-page-width";

export default function EditorViewMenu({ width, onChange, spanish = false }: {
  width: PageWidth; onChange: (width: PageWidth) => void; spanish?: boolean;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const label = spanish ? "Vista" : "View";
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof globalThis.Node && !menu.current?.contains(event.target))
        menu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details className="uw-editor-view" ref={menu} onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        menu.current?.removeAttribute("open"); trigger.current?.focus();
      }
    }}>
      <summary ref={trigger} aria-label={label}>
        <span>{label}</span><ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="uw-editor-view-popover">
        <label>
          <span>{spanish ? "Ancho de página" : "Page Width"}</span>
          <select aria-label={spanish ? "Ancho de página" : "Page Width"} value={width} onChange={event => onChange(event.target.value as PageWidth)}>
            <option value="comfortable">{spanish ? "Cómodo" : "Comfortable"}</option>
            <option value="standard">{spanish ? "Página estándar" : "Standard Page"}</option>
            <option value="wide">{spanish ? "Amplio" : "Wide"}</option>
            <option value="full">{spanish ? "Ancho completo" : "Full Width"}</option>
          </select>
        </label>
        <p>{spanish ? "Tu espacio para escribir, a tu medida." : "A little room to find your words."}</p>
      </div>
    </details>
  );
}
