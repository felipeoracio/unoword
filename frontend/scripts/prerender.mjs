import { readFile, writeFile } from "node:fs/promises";
import { renderLanding } from "../node_modules/.tmp/marketing-ssr/entry-marketing.js";
const file = new URL("../dist/index.html", import.meta.url);
const html = await readFile(file, "utf8");
await writeFile(
  file,
  html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="true">${renderLanding()}</div>`,
  ),
);
console.log(
  "Prerendered public landing content for fast first paint and search crawlers.",
);
