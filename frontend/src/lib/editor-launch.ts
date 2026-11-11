/** One-use, account-bound prompt handoff. Never carries writing or credentials. */
const prefix = "uno-home-prompt:";
export function preparePromptDraft(owner: string, prompt: { id: string; text: string }) {
  const nonce = crypto.randomUUID();
  sessionStorage.setItem(prefix + nonce, JSON.stringify({ owner, ...prompt, created: Date.now() }));
  return "/editor?prompt=" + nonce;
}
export function promptDraft(nonce: string, owner: string): { id: string; text: string } | null {
  if (!/^[a-f0-9-]{36}$/i.test(nonce)) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(prefix + nonce) || "null");
    if (value?.owner !== owner || typeof value.text !== "string" || !value.text.trim()
      || value.text.length > 300 || typeof value.id !== "string" || value.id.length > 200
      || typeof value.created !== "number" || value.created > Date.now() + 30000
      || value.created < Date.now() - 1800000) return null;
    return { id: value.id, text: value.text };
  } catch { return null; }
}
export function consumePromptDraft(nonce: string) { sessionStorage.removeItem(prefix + nonce); }
