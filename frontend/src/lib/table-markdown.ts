import type { JSONContent } from "@tiptap/core";
const escape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function tableHTML(node: JSONContent): string {
  if (node.type === "text") {
    let text = escape(node.text);
    for (const mark of node.marks || []) {
      const tag = ({ bold: "strong", italic: "em", underline: "u", strike: "s" } as Record<string, string>)[mark.type];
      if (tag) text = `<${tag}>${text}</${tag}>`;
      else if (mark.type === "link") text = `<a href="${escape(mark.attrs?.href)}">${text}</a>`;
    }
    return text;
  }
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "horizontalRule") return "<hr>";
  let content = (node.content || []).map(tableHTML).join("");
  if (node.type === "image") return `<figure><img src="${escape(node.attrs?.src)}" alt="${escape(node.attrs?.alt)}"><figcaption>${content}</figcaption></figure>`;
  if (node.type === "taskItem") content = (node.attrs?.checked ? "[x] " : "[ ] ") + content;
  const tag = node.type === "heading" ? `h${Math.max(1, Math.min(3, Number(node.attrs?.level) || 1))}` : ({ table: "table", tableRow: "tr", tableCell: "td", tableHeader: "th", paragraph: "p", blockquote: "blockquote", bulletList: "ul", orderedList: "ol", listItem: "li", taskList: "ul", taskItem: "li" } as Record<string, string>)[node.type || ""];
  const attrs = ["tableCell", "tableHeader"].includes(node.type || "") ? ` colspan="${Math.max(1, Math.min(20, Number(node.attrs?.colspan) || 1))}" rowspan="${Math.max(1, Math.min(100, Number(node.attrs?.rowspan) || 1))}"` : "";
  return tag ? `<${tag}${attrs}>${content}</${tag}>` : content;
}

export function tableMarkdown(node: JSONContent, render: (node: JSONContent) => string): string {
  const rows = node.content || [];
  const simple = rows.length > 0 && rows.every(row => row.content?.every(cell => (cell.attrs?.colspan || 1) === 1 && (cell.attrs?.rowspan || 1) === 1 && cell.content?.length === 1 && cell.content[0].type === "paragraph"));
  if (!simple) return tableHTML(node) + "\n";
  const values = rows.map(row => (row.content || []).map(cell => render(cell.content![0]).trim().replaceAll("|", "\\|").replaceAll("\n", "<br>")));
  const header = rows[0].content!.every(cell => cell.type === "tableHeader");
  const first = header ? values.shift()! : values[0].map(() => "");
  return [first, first.map(() => "---"), ...values].map(row => "| " + row.join(" | ") + " |").join("\n") + "\n";
}
