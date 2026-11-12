/** CSS minifiers may express the shared time tokens in seconds or milliseconds. */
export function motionMilliseconds(value: string, fallback = 0): number {
  const time = value.trim();
  const amount = Number.parseFloat(time);
  return Number.isFinite(amount) ? amount * (time.endsWith("ms") ? 1 : 1000) : fallback;
}
