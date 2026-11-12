import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motionMilliseconds } from "./motion";

type Snapshot = { left: number; top: number; scrollTop: number };

/** Layout only. Never touches editor content/selection, autosave or sessions. */
export function useFocusMode() {
  const [focus, updateFocus] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const current = useRef(false);
  const before = useRef<Snapshot | null>(null);
  const motion = useRef<Animation | null>(null);

  const setFocus = useCallback((next: boolean) => {
    if (next === current.current) return;
    const root = rootRef.current;
    const paper = root?.querySelector<HTMLElement>(".uw-editor-paper");
    const scroll = root?.querySelector<HTMLElement>(".uw-editor-paper-scroll");
    if (root && paper && scroll) {
      const rect = paper.getBoundingClientRect();
      before.current = { left: rect.left, top: rect.top, scrollTop: scroll.scrollTop };
      // Snapshot before canceling: rapid reversals start at the current visual position.
      motion.current?.cancel();
      motion.current = null;
      if (next) {
        // Read all geometry before any style write. Values belong to the
        // affected element, avoiding repeated style invalidation of long prose.
        const properties: [HTMLElement, string, string][] = [
          [paper, "--focus-paper-width", `${rect.width}px`],
          [scroll, "--focus-scroll-padding", getComputedStyle(scroll).paddingTop],
        ];
        const stats = root.querySelector<HTMLElement>(".uw-editor-stats");
        if (stats) properties.push([stats, "--focus-stats-height", `${stats.getBoundingClientRect().height}px`]);
        for (const [name, selector] of [
          ["project", ".uw-editor-focus-project"],
          ["toolbar", ".uw-editor-toolbar"],
          ["library", ".uw-editor-library"],
          ["assistant", ".uw-editor-assistant"],
        ]) {
          const element = root.querySelector<HTMLElement>(selector);
          if (!element?.getClientRects().length) continue;
          const box = element.getBoundingClientRect();
          for (const key of ["left", "top", "width", "height"] as const)
            properties.push([element, `--focus-${name}-${key}`, `${box[key]}px`]);
        }
        for (const [element, name, value] of properties) element.style.setProperty(name, value);
      }
    }
    current.current = next;
    updateFocus(next);
  }, []);

  useLayoutEffect(() => {
    const snapshot = before.current;
    before.current = null;
    const root = rootRef.current;
    const paper = root?.querySelector<HTMLElement>(".uw-editor-paper");
    const scroll = root?.querySelector<HTMLElement>(".uw-editor-paper-scroll");
    if (!snapshot || !root || !paper || !scroll) return;
    scroll.scrollTop = snapshot.scrollTop;
    if (focus) {
      // Move the vacated chrome space into the scrollable paper margin. This
      // expands the usable viewport without moving lines or clamping scroll.
      const padding = parseFloat(getComputedStyle(scroll).paddingTop);
      const delta = snapshot.top - paper.getBoundingClientRect().top;
      scroll.style.setProperty("--focus-scroll-padding", `${Math.max(0, padding + delta)}px`);
      scroll.scrollTop = snapshot.scrollTop;
    } else {
      scroll.scrollTop += paper.getBoundingClientRect().top - snapshot.top;
    }
    const deltaX = snapshot.left - paper.getBoundingClientRect().left;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && Math.abs(deltaX) > 0.5 && paper.animate) {
      const tokens = getComputedStyle(root);
      motion.current = paper.animate(
        [{ transform: `translateX(${deltaX}px)` }, { transform: "translateX(0)" }],
        { duration: motionMilliseconds(tokens.getPropertyValue("--uno-motion-focus"), 420),
          easing: tokens.getPropertyValue("--uno-motion-state-ease").trim(), fill: "none" },
      );
    }
    // No completion callback restores an old bookmark or scroll offset: typing
    // and intentional scrolling during the transition always belong to the user.
  }, [focus]);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => { if (media.matches) motion.current?.cancel(); };
    media.addEventListener("change", reduce);
    return () => { media.removeEventListener("change", reduce); motion.current?.cancel(); };
  }, []);

  return { focus, setFocus, rootRef };
}
