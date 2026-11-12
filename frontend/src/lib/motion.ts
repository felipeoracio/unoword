/** CSS minifiers may express the shared time tokens in seconds or milliseconds. */
export function motionMilliseconds(value: string, fallback = 0): number {
  const time = value.trim();
  const amount = Number.parseFloat(time);
  return Number.isFinite(amount) ? amount * (time.endsWith("ms") ? 1 : 1000) : fallback;
}

/** One brief surface cue. Does not schedule work, delay readiness or move focus. */
export function revealOpacity(element: HTMLElement, from = 0.96,
  token: "--uno-motion-panel" | "--uno-motion-page" | "--uno-motion-sidebar" = "--uno-motion-panel"): Animation | null {
  return animateSurface(element, [{ opacity: from }, { opacity: 1 }], token);
}

/** Progressive enhancement: the underlying surface is always fully visible. */
export function revealEntrance(element: HTMLElement, { hero = false, step = 0, opaque = false } = {}): Animation | null {
  const style = getComputedStyle(element);
  const offset = style.getPropertyValue(hero ? "--uno-motion-hero-offset" : "--uno-motion-reveal-offset").trim();
  return animateSurface(element, [
    { opacity: opaque ? 1 : 0.96, translate: `0 ${offset}` },
    { opacity: 1, translate: "0 0" },
  ], "--uno-motion-reveal", step * motionMilliseconds(style.getPropertyValue("--uno-motion-stagger")));
}

function animateSurface(element: HTMLElement, frames: Keyframe[], token: string, delay = 0): Animation | null {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  if (media.matches || !element.animate) return null;
  const style = getComputedStyle(element);
  const animation = element.animate(frames, {
    duration: motionMilliseconds(style.getPropertyValue(token)),
    delay,
    easing: style.getPropertyValue("--uno-motion-enter-ease").trim(),
    fill: "none",
  });
  const reduce = () => { if (media.matches) animation.cancel(); };
  const release = () => media.removeEventListener("change", reduce);
  media.addEventListener("change", reduce);
  void animation.finished.then(release, release);
  return animation;
}
