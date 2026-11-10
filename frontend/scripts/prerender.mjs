import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  renderLanding,
  renderInformation,
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

const site = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
if (!site) throw new Error("A canonical site URL is required for public metadata");
for (const [kind, pageTitle] of [
  ["privacy", "Privacy & data — UnoWord"],
  ["terms", "Terms of service — UnoWord"],
  ["support", "Support — UnoWord"],
]) {
  const target = new URL(`../dist/${kind}/`, import.meta.url);
  await mkdir(target, { recursive: true });
  const page = html
    .replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${renderInformation(kind)}</div>`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${pageTitle}</title>`)
    .replace(/(<link rel="canonical" href=")[^"]+"/, `$1${site}${kind}"`)
    .replace(/(<meta property="og:url" content=")[^"]+"/, `$1${site}${kind}"`)
    .replace(/(<meta (?:property|name)="(?:og|twitter):title" content=")[^"]+"/g, `$1${pageTitle}"`);
  const pageDescription = kind === "privacy" ? "Privacy and data practices for UnoWord writing, accounts, and cloud features."
    : kind === "support" ? "Installation, account help, and recovery of offline writing for UnoWord."
      : "Terms of service for UnoWord writing and subscription features.";
  const described = page.replace(/(<meta\s+(?:name="description"|(?:property|name)="(?:og|twitter):description")\s+content=")[^"]+"/g, `$1${pageDescription}"`);
  await writeFile(new URL("index.html", target), kind === "terms" ? described.replace('content="index, follow"', 'content="noindex, nofollow"') : described);
}
const preview = /name="robots" content="noindex/.test(html);
const sitemap = ['','privacy','support'].map(path => `  <url><loc>${site}${path}</loc></url>`).join('\n');
await writeFile(new URL('../dist/sitemap.xml', import.meta.url), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap}\n</urlset>\n`);
await writeFile(new URL('../dist/robots.txt', import.meta.url), preview
  ? 'User-agent: *\nDisallow: /\n'
  : `User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /projects\nDisallow: /editor\nDisallow: /rewards\nDisallow: /terms\nSitemap: ${site}sitemap.xml\n`);
