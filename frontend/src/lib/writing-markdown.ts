import type { JSONContent } from "@tiptap/react";
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
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "horizontalRule") return "\n---\n";
  if (["bulletList", "orderedList"].includes(node.type || ""))
    return (
      (node.content || [])
        .map(
          (item, i) =>
            "  ".repeat(depth) +
            (node.type === "orderedList"
              ? `${Number(node.attrs?.start || 1) + i}. `
              : "- ") +
            toMarkdown(item, depth + 1).trim(),
        )
        .join("\n") + "\n"
    );
  const text = (node.content || [])
    .map((child) => toMarkdown(child, depth))
    .join(
      ["doc", "listItem", "blockquote"].includes(node.type || "") ? "\n\n" : "",
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
