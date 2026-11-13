import type { JSONContent } from "@tiptap/react";
import { tableMarkdown } from "./table-markdown";
export function toMarkdown(node: JSONContent, depth = 0): string {
  if (node.type === "text") {
    let text = (node.text || "").replace(/([\\`*_[\]<>])/g, "\\$1");
    for (const mark of node.marks || []) {
      if (mark.type === "link")
        text = `[${text}](${String(mark.attrs?.href || "").replaceAll(")", "%29")})`;
      else if (["bold", "italic", "strike"].includes(mark.type)) {
        const wrapper = { bold: "**", italic: "*", strike: "~~" }[mark.type]!;
        text = wrapper + text + wrapper;
      }
    }
    return text;
  }
  if (node.type === "table") return tableMarkdown(node, toMarkdown);
  if (node.type === "image")
    return `![${String(node.attrs?.alt || "").replace(/([\\`*_[\]<>])/g, "\\$1")}](${String(node.attrs?.src || "")})` + ((node.content || []).length ? "\n\n" + (node.content || []).map(child => toMarkdown(child, depth)).join("") : "");
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "pageBreak") return '\n<div data-page-break="true"></div>\n';
  if (node.type === "horizontalRule") return "\n---\n";
  if (["bulletList", "orderedList", "taskList"].includes(node.type || ""))
    return (
      (node.content || [])
        .map(
          (item, i) =>
            "  ".repeat(depth) +
            (node.type === "orderedList"
              ? `${Number(node.attrs?.start || 1) + i}. `
              : node.type === "taskList" ? (item.attrs?.checked ? "- [x] " : "- [ ] ") : "- ") +
            toMarkdown(item, depth + 1).trim(),
        )
        .join("\n") + "\n"
    );
  const text = (node.content || [])
    .map((child) => toMarkdown(child, depth))
    .join(
      ["doc", "listItem", "taskItem", "blockquote"].includes(node.type || "") ? "\n\n" : "",
    );
  if (
    node.type === "doc" &&
    typeof node.attrs?.subtitle === "string" &&
    node.attrs.subtitle
  )
    return (
      toMarkdown({ type: "text", text: node.attrs.subtitle }) + "\n\n" + text
    );
  if (node.type === "heading")
    return "#".repeat(Number(node.attrs?.level || 1)) + " " + text;
  if (node.type === "blockquote")
    return text
      .split("\n")
      .map((line) => "> " + line)
      .join("\n");
  return text;
}
