/** CSS minifiers may express the shared time tokens in seconds or milliseconds. */
export function motionMilliseconds(value: string, fallback = 0): number {
  const time = value.trim();
  const amount = Number.parseFloat(time);
  return Number.isFinite(amount) ? amount * (time.endsWith("ms") ? 1 : 1000) : fallback;
}

/** One brief surface cue. Does not schedule work, delay readiness or move focus. */
export function revealOpacity(element: HTMLElement, from = 0.96): Animation | null {
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  if (media.matches || !element.animate) return null;
  const style = getComputedStyle(element);
  const animation = element.animate([{ opacity: from }, { opacity: 1 }], {
    duration: motionMilliseconds(style.getPropertyValue("--uno-motion-panel")),
    easing: style.getPropertyValue("--uno-motion-enter-ease").trim(),
    fill: "none",
  });
  const reduce = () => { if (media.matches) animation.cancel(); };
  const release = () => media.removeEventListener("change", reduce);
  media.addEventListener("change", reduce);
  void animation.finished.then(release, release);
  return animation;
}
