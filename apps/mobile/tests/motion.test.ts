import { strict as assert } from "node:assert";
import { test } from "node:test";
import { observeReducedMotion } from "../src/components/reduced-motion";

test("native preference change wins a late initial read and cleanup stops updates", async () => {
  let resolve!: (value: boolean) => void, listener!: (value: boolean) => void, removed = false;
  const updates: boolean[] = [];
  const stop = observeReducedMotion({ isReduceMotionEnabled: () => new Promise(r => resolve = r),
    addEventListener: (_, callback) => { listener = callback; return { remove: () => { removed = true; } }; } }, value => updates.push(value));
  listener(true); resolve(false); await Promise.resolve();
  assert.deepEqual(updates, [true]);
  stop(); listener(false); assert.equal(removed, true); assert.deepEqual(updates, [true]);
});
test("failed or unmounted initial preference reads never introduce motion", async () => {
  const updates: boolean[] = [];
  observeReducedMotion({ isReduceMotionEnabled: () => Promise.reject(Error("unavailable")), addEventListener: () => ({ remove() {} }) }, v => updates.push(v));
  await Promise.resolve(); assert.deepEqual(updates, [true]);
  let resolve!: (value: boolean) => void;
  const stop = observeReducedMotion({ isReduceMotionEnabled: () => new Promise(r => resolve = r), addEventListener: () => ({ remove() {} }) }, v => updates.push(v));
  stop(); resolve(false); await Promise.resolve(); assert.deepEqual(updates, [true]);
});
