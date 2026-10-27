// Scan project text without printing source lines, which may contain private fixtures.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const excluded = new Set([
  ".git",
  "node_modules",
  "dist",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".cache",
  ".ruff_cache",
  ".mypy_cache",
]);
if (process.argv.includes("--artifacts")) excluded.delete("dist");
const textTypes = new Set([
  ".tsx",
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".py",
  ".html",
  ".css",
  ".md",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".sql",
  ".sh",
  ".svg",
]);
const problems = [];
let count = 0;
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excluded.has(entry.name)) scan(file);
      continue;
    }
    if (!entry.isFile() || !textTypes.has(extname(file))) continue;
    const raw = readFileSync(file, "utf8");
    if (raw.includes("\0")) continue;
    count++;
    const text = raw
      .replace(/&(?:nbsp|#0*32|#x0*20);/gi, " ")
      .replace(/\\(?:u00(?:20|a0)|x20)/gi, " ")
      .replace(/<[^>\n]*>/g, "");
    for (const match of text.matchAll(
      /\buno[\s\u00a0]+word\b|\buno(?:word)\b/gi,
    )) {
      // Lowercase paths/domains and uppercase environment identifiers are APIs,
      // not wordmarks. Preserve these and existing underscore/hyphen storage IDs.
      if (["UnoWord", "unoword", "UNOWORD"].includes(match[0])) continue;
      const line = text.slice(0, match.index).split("\n").length;
      problems.push(`${relative(root, file)}:${line}`);
    }
  }
}
scan(root);
if (problems.length) {
  console.error(
    `UnoWord branding check failed in ${problems.length} places:\n${problems.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `UnoWord branding: ${count} project text files checked; no spelling variants found.`,
  );
}
