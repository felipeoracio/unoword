import { expect, it } from "vitest";
import { toMarkdown } from "../src/lib/writing-markdown";
import type { JSONContent } from "@tiptap/core";
const cell = (type: string, text: string, colspan = 1): JSONContent => ({ type, attrs: { colspan, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
it("exports simple tables as Markdown without losing pipes", () => {
  const table: JSONContent = { type: "table", content: [{ type: "tableRow", content: [cell("tableHeader", "Moment"), cell("tableHeader", "Detail")] }, { type: "tableRow", content: [cell("tableCell", "Morning"), cell("tableCell", "a | b")] }] };
  expect(toMarkdown(table)).toContain("| Moment | Detail |\n| --- | --- |");
  expect(toMarkdown(table)).toContain("a \\| b");
});
it("keeps merged cells as safe HTML instead of flattening their structure", () => {
  const table: JSONContent = { type: "table", content: [{ type: "tableRow", content: [cell("tableHeader", "<script>unsafe</script>", 2)] }] };
  const md = toMarkdown(table);
  expect(md).toContain('colspan="2"');
  expect(md).toContain("&lt;script&gt;");
  expect(md).not.toContain("<script>");
});
it("keeps captions associated with exported images", () => {
  const image: JSONContent = { type: "image", attrs: { src: "data:image/png;base64,AA==", alt: "Landscape" }, content: [{ type: "text", text: "Figure 1 — Beginning" }] };
  expect(toMarkdown(image)).toContain("\n\nFigure 1 — Beginning");
});
