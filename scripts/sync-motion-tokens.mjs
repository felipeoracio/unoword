import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("frontend/src/styles/studio-motion.css", root), "utf8");
const block = source.match(/:root\s*\{([^}]+)\}/)?.[1];
if (!block) throw Error("Shared motion root is missing");
const entries = [...block.matchAll(/--uno-motion-([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]);
const duration = {}, easing = {};
for (const [key, value] of entries) {
  const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (/^\d+ms$/.test(value)) duration[camel] = Number.parseInt(value);
  if (value.startsWith("cubic-bezier(")) easing[camel] = value.slice(13, -1).split(",").map(Number);
}
if (!duration.page || !easing.enterEase || easing.enterEase.length !== 4) throw Error("Shared motion values are invalid");
const outputs = [
  ["extension/shared/motion-tokens.css", `/* Generated from frontend/src/styles/studio-motion.css. Run scripts/sync-motion-tokens.mjs --write. */\n:root {${block}}\n`],
  ["apps/mobile/src/components/motion-tokens.ts", `// Generated from frontend/src/styles/studio-motion.css; do not edit independently.\nexport const motion = ${JSON.stringify({ duration, easing }, null, 2)} as const;\n`],
];
for (const [path, content] of outputs) {
  const target = new URL(path, root);
  if (process.argv.includes("--write")) writeFileSync(target, content);
  else if (readFileSync(target, "utf8") !== content) throw Error(`Motion token drift: ${fileURLToPath(target)}`);
}
const counterFile = new URL("extension/content.js", root);
const counterSource = readFileSync(counterFile, "utf8");
const counterCSS = `:host {${block}}\n#row, #stop-btn { transition: color var(--uno-motion-feedback) var(--uno-motion-state-ease), background-color var(--uno-motion-feedback) var(--uno-motion-state-ease); }\n@media(prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; transition:none !important; } }`;
const counterBlock = `/* GENERATED-MOTION:START */\n  const counterMotion = ${JSON.stringify(counterCSS)};\n  /* GENERATED-MOTION:END */`;
const nextCounter = counterSource.replace(/\/\* GENERATED-MOTION:START \*\/[\s\S]*?\/\* GENERATED-MOTION:END \*\//, () => counterBlock);
if (nextCounter === counterSource && !counterSource.includes(counterBlock)) throw Error("Counter motion marker missing");
if (process.argv.includes("--write")) writeFileSync(counterFile, nextCounter);
else if (nextCounter !== counterSource) throw Error("Counter motion token drift");
console.log("Shared web, extension and native motion tokens match.");
