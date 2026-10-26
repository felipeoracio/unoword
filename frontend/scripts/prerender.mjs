import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  renderLanding,
  renderLifetime,
} from "../node_modules/.tmp/marketing-ssr/entry-marketing.js";
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

const lifetime = html.replace(
  '<div id="root"></div>',
  `<div id="root" data-prerendered="true">${renderLifetime()}</div>`,
);
const directory = new URL("../dist/lifetime/", import.meta.url);
await mkdir(directory, { recursive: true });
const site = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const title = "UnoWord Pro — $100 Lifetime Deal";
const description =
  "Make room for a lifetime of ideas. Explore UnoWord Pro’s limited-time $100 USD lifetime offer: your writing editor, AI companion, and progress tools in one place.";
let promoHtml = lifetime
  .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
  .replace(
    /(<meta\s+name="description"\s+content=")[^"]+"/,
    (_, prefix) => `${prefix}${description}"`,
  )
  .replace(
    /(<meta\s+(?:property|name)="(?:og|twitter):title"\s+content=")[^"]+"/g,
    (_, prefix) => `${prefix}${title}"`,
  )
  .replace(
    /(<meta\s+(?:property|name)="(?:og|twitter):description"\s+content=")[^"]+"/g,
    (_, prefix) => `${prefix}${description}"`,
  );
if (site)
  promoHtml = promoHtml
    .replace(
      /(<link rel="canonical" href=")[^"]+"/,
      (_, prefix) => `${prefix}${site}lifetime"`,
    )
    .replace(
      /(<meta property="og:url" content=")[^"]+"/,
      (_, prefix) => `${prefix}${site}lifetime"`,
    );
await writeFile(new URL("index.html", directory), promoHtml);
console.log("Prerendered lifetime promotion at /lifetime.");
