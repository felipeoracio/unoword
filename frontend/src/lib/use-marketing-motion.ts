import { useEffect, useRef } from "react";
import { revealEntrance } from "./motion";

/** One observer for static compositions, with no hidden state or scroll handler. */
export function useMarketingMotion() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const surface = root.current;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    if (!surface || media.matches || typeof IntersectionObserver === "undefined") return;
    const active = new Map<HTMLElement, Animation>();
    const seen = new Set<Element>();
    function enter(element: HTMLElement, hero = false, step = 0) {
      if (seen.has(element)) return;
      seen.add(element);
      if (media.matches || element.contains(document.activeElement)) return;
      const animation = revealEntrance(element, { hero, step, opaque: element.tagName === "H1" });
      if (!animation) return;
      active.set(element, animation);
      void animation.finished.then(() => active.delete(element), () => active.delete(element));
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const element = entry.target as HTMLElement;
        enter(element, element.hasAttribute("data-motion-hero"), Number(element.dataset.motionHero || 0));
      }
    }, { threshold: 0.01 });
    surface.querySelectorAll<HTMLElement>("[data-motion-hero]").forEach(element => {
      const box = element.getBoundingClientRect();
      if (box.bottom > 0 && box.top < innerHeight) enter(element, true, Number(element.dataset.motionHero));
      else observer.observe(element);
    });
    surface.querySelectorAll<HTMLElement>(
      ".lp-journey-grid, .lp-problem-cards, .lp-features .uw-shared-section-heading, " +
      ".lp-feature-index, .lp-feature-story, .lp-showcase > .uw-shared-container, " +
      ".lp-how > .uw-shared-container, .lp-ai-grid, .lp-audiences > .uw-shared-container, " +
      ".lp-pricing > .uw-shared-container, .lp-trust > .uw-shared-container, " +
      ".lp-faq > .uw-shared-container, .lp-final-cta > .uw-shared-container",
    ).forEach(element => observer.observe(element));
    const settle = (event: Event) => {
      for (const [element, animation] of active) {
        if (event.target instanceof Node && element.contains(event.target)) animation.cancel();
      }
    };
    const reduce = () => {
      if (!media.matches) return;
      observer.disconnect();
      for (const animation of active.values()) animation.cancel();
    };
    surface.addEventListener("focusin", settle);
    surface.addEventListener("pointerdown", settle);
    media.addEventListener("change", reduce);
    return () => {
      observer.disconnect();
      for (const animation of active.values()) animation.cancel();
      surface.removeEventListener("focusin", settle);
      surface.removeEventListener("pointerdown", settle);
      media.removeEventListener("change", reduce);
    };
  }, []);
  return root;
}
