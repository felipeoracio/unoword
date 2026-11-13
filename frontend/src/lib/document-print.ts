import DOMPurify from "dompurify";
import { typography, FONT_FAMILIES } from "./document-formatting";
import { printLayout } from "./document-tools";

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function printHTML(html: string, title: string, subtitle: string, attrs: Record<string, unknown>) {
  const layout = printLayout(attrs.printLayout), type = typography(attrs.typography);
  const margin = { narrow: 0.5, normal: 1, wide: 1.25 }[layout.margin];
  // Generate only from the current schema; sanitize again at the iframe boundary.
  const fragment = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"], FORBID_ATTR: ["srcset"] });
  // Tiptap emits fixed pixel widths. Convert them to relative print columns so
  // a wide editing table cannot override the printable area's margins.
  fragment.querySelectorAll("table").forEach(table => {
    const columns = [...table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")];
    const widths = columns.map(column => Math.max(80, Math.min(1600, parseFloat(column.style.width || column.getAttribute("width") || "") || 80)));
    const total = widths.reduce((sum, width) => sum + width, 0);
    columns.forEach((column, index) => { column.style.width = `${widths[index] / total * 100}%`; column.removeAttribute("width"); });
    table.style.width = "100%"; table.style.minWidth = "0";
  });
  fragment.querySelectorAll("img").forEach(image => { image.loading = "eager"; });
  const container = document.createElement("div"); container.append(fragment);
  const content = container.innerHTML;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>
@page{size:${layout.size === 'a4' ? 'A4' : 'letter'};margin:${margin}in}
*{box-sizing:border-box}html{color:#102b55;background:#e9edf3}body{margin:24px auto;padding:${margin}in;width:${layout.size === 'a4' ? '210mm' : '8.5in'};max-width:none;background:white;font-family:${FONT_FAMILIES[type.fontFamily]};font-size:${type.fontSize}px;line-height:${type.lineHeight};overflow-wrap:anywhere}
h1,h2,h3{line-height:1.25;break-after:avoid}p{margin:0 0 ${type.paragraphSpacing}em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}li p{margin-bottom:.3em}blockquote{border-left:3px solid #b8c5d9;padding-left:1em;margin-left:0}a{color:inherit}figure{break-inside:avoid;max-width:100%;margin-block:1.5em}figure img{display:block;width:100%;height:auto;max-width:100%}figcaption{font-size:.85em;line-height:1.5;margin-top:.5em}table{border-collapse:collapse;width:100%;max-width:100%;table-layout:fixed;margin-block:1em}td,th{border:1px solid #b8c5d9;padding:8px;overflow-wrap:anywhere}th{background:#f6f8fc}tr{break-inside:avoid}thead{display:table-header-group}ul[data-type=taskList]{list-style:none;padding-left:1.3em}li[data-type=taskItem]{position:relative}li[data-type=taskItem]>label{display:none}li[data-type=taskItem]:before{content:'☐';position:absolute;left:-1.3em}li[data-type=taskItem][data-checked=true]:before{content:'☑'}[data-document-style=title]{font-size:2em}[data-document-style=subtitle],.subtitle{font-style:italic;font-size:1.1em}[data-page-break]{break-after:page;page-break-after:always;height:0;margin:0;border:0}
@media print{html{background:white}body{width:auto;max-width:none;margin:0;padding:0;color:#102b55}p{orphans:3;widows:3}}
</style></head><body><header><h1>${escape(title)}</h1>${subtitle ? `<p class="subtitle">${escape(subtitle)}</p>` : ''}</header><main>${content}</main></body></html>`;
}
