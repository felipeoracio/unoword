import { useEffect, useRef } from "react";
import { revealOpacity } from "./motion";

/** Cue a real view/state change; content updates do not drive the animation. */
export function useSurfaceCue<T extends HTMLElement>(identity: string, enabled = true, initial = true) {
  const ref = useRef<T>(null);
  const active = useRef<Animation | null>(null);
  const previous = useRef(identity);
  useEffect(() => {
    const changed = previous.current !== identity;
    previous.current = identity;
    if (!initial && !changed) return;
    if (!enabled || !ref.current) return;
    const animation = revealOpacity(ref.current, 0.98);
    active.current = animation;
    const release = () => { if (active.current === animation) active.current = null; };
    if (animation) void animation.finished.then(release, release);
    return () => { release(); animation?.cancel(); };
  }, [identity, enabled, initial]);
  return { ref, onBeforeInputCapture: () => {
    const animation = active.current;
    active.current = null;
    animation?.cancel();
  } };
}
