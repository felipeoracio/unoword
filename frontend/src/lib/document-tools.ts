import "../../../extension/shared/wordcount.js";
import { Extension, Node } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";

export type PrintLayout = { size: "letter" | "a4"; margin: "normal" | "narrow" | "wide" };
export function printLayout(value: unknown): PrintLayout {
  const raw = value as Partial<PrintLayout> | null;
  return { size: raw?.size === "a4" ? "a4" : "letter", margin: ["normal", "narrow", "wide"].includes(raw?.margin || "") ? raw!.margin! : "normal" };
}
export const PrintSettings = Extension.create({ name: "printSettings", addGlobalAttributes: () => [{ types: ["doc"], attributes: { printLayout: { default: null, rendered: false } } }] });
export const DocumentPageBreak = Node.create({
  name: "pageBreak", group: "block", atom: true, selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ["div", { "data-page-break": "true", class: "uw-document-page-break", role: "separator", "aria-label": "Page break" }],
  addExtensions() { return [Extension.create({ name: "pageBreakShortcut", priority: 1100, addKeyboardShortcuts() { return { "Mod-Enter": () => insertPageBreak(this.editor) }; } })]; },
});
export function insertPageBreak(editor: Editor) {
  if (!editor.isEditable || editor.state.selection.$from.depth !== 1 || editor.isActive("image")) return false;
  return editor.chain().focus().command(({ tr }) => { closeHistory(tr); tr.setMeta("unoPreserveCredit", true); return true; }).insertContent({ type: "pageBreak" }).run();
}
export function countWords(text: string) { return (globalThis as unknown as { WCWordCount: { countWords: (text: string) => number } }).WCWordCount.countWords(text); }
export function documentStatistics(doc: ProseMirrorNode, from: number, to: number) {
  const text = doc.textBetween(0, doc.content.size, "\n", "\n");
  let paragraphs = 0;
  doc.descendants(node => { if (node.type.name === "paragraph") paragraphs++; });
  const words = countWords(text);
  return { words, characters: Array.from(text).length, withoutSpaces: Array.from(text.replace(/\s/gu, "")).length, paragraphs, readingMinutes: words ? Math.ceil(words / 200) : 0, selectedWords: countWords(doc.textBetween(from, to, "\n", "\n")) };
}
export function documentOutline(doc: ProseMirrorNode) {
  const headings: { pos: number; level: number; text: string }[] = [];
  doc.descendants((node, pos) => { if (node.type.name === "heading") headings.push({ pos, level: node.attrs.level, text: node.textContent || "Untitled heading" }); });
  return headings;
}
