export type MotionAccessibility = {
  isReduceMotionEnabled: () => Promise<boolean>;
  addEventListener: (name: "reduceMotionChanged", listener: (value: boolean) => void) => { remove: () => void };
};
/** Subscribe first so a late initial read cannot override a newer OS choice. */
export function observeReducedMotion(api: MotionAccessibility, update: (value: boolean) => void) {
  let active = true, changed = false;
  const subscription = api.addEventListener("reduceMotionChanged", value => {
    changed = true;
    if (active) update(value);
  });
  void api.isReduceMotionEnabled().then(value => {
    if (active && !changed) update(value);
  }, () => { if (active && !changed) update(true); });
  return () => { active = false; subscription.remove(); };
}
