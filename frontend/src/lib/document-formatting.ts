import { Extension, Mark, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { CSSProperties } from "react";

export const FONT_FAMILIES = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Inter Variable", Inter, system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", monospace',
} as const;
export const FONT_SIZES = [12, 14, 16, 17, 18, 20, 22, 24, 28, 32, 36, 48, 64];
export const LINE_HEIGHTS = [1.2, 1.4, 1.5, 1.6, 1.7, 1.75, 2];
export const PARAGRAPH_SPACING = [0, 0.5, 0.9, 1, 1.5, 2];
export const TEXT_COLORS = ["#102b55", "#0757ce", "#246340", "#805309", "#a83032", "#7136a2"];
export const HIGHLIGHTS = ["#fff0a6", "#d8eaff", "#d8efde", "#f5d9de", "#e6ddf5"];
export type Typography = { fontFamily: keyof typeof FONT_FAMILIES; fontSize: number; lineHeight: number; paragraphSpacing: number };
export const DEFAULT_TYPOGRAPHY: Typography = { fontFamily: "serif", fontSize: 18, lineHeight: 1.7, paragraphSpacing: 0.9 };
export function typography(value: unknown): Typography {
  const raw = value && typeof value === "object" ? value as Partial<Typography> : {};
  return {
    fontFamily: raw.fontFamily && Object.hasOwn(FONT_FAMILIES, raw.fontFamily) ? raw.fontFamily : "serif",
    fontSize: FONT_SIZES.includes(raw.fontSize!) ? raw.fontSize! : 18,
    lineHeight: LINE_HEIGHTS.includes(raw.lineHeight!) ? raw.lineHeight! : 1.7,
    paragraphSpacing: PARAGRAPH_SPACING.includes(raw.paragraphSpacing!) ? raw.paragraphSpacing! : 0.9,
  };
}
export function typographyStyle(value: unknown): CSSProperties {
  const t = typography(value);
  return { "--document-font": FONT_FAMILIES[t.fontFamily], "--document-size": `${t.fontSize}px`, "--document-mobile-size": `${value && typeof value === "object" ? t.fontSize : 17}px`, "--document-leading": t.lineHeight, "--document-gap": `${t.paragraphSpacing}em` } as CSSProperties;
}
export function color(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = value.match(/^rgb\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\s*\)$/);
  return rgb && rgb.slice(1).every(n => Number(n) <= 255) ? "#" + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, "0")).join("") : null;
}
function font(value: string) {
  return Object.entries(FONT_FAMILIES).find(([, family]) => family === value)?.[0] ||
    (/Georgia|Times New Roman/i.test(value) ? "serif" : /Inter|sans-serif/i.test(value) ? "sans" : /JetBrains|monospace/i.test(value) ? "mono" : null);
}
export const TextStyle = Mark.create({
  name: "textStyle",
  addAttributes: () => ({ fontFamily: { default: null }, fontSize: { default: null }, color: { default: null } }),
  parseHTML: () => [{ tag: "span[style]", getAttrs: element => {
    const el = element as HTMLElement, size = parseFloat(el.style.fontSize);
    const attrs = { fontFamily: font(el.style.fontFamily), fontSize: FONT_SIZES.includes(size) ? size : null, color: color(el.style.color) };
    return Object.values(attrs).some(Boolean) ? attrs : false;
  } }],
  renderHTML({ mark }) {
    const attrs = mark.attrs, styles = [];
    if (Object.hasOwn(FONT_FAMILIES, attrs.fontFamily)) styles.push(`font-family:${FONT_FAMILIES[attrs.fontFamily as keyof typeof FONT_FAMILIES]}`);
    if (FONT_SIZES.includes(attrs.fontSize)) styles.push(`font-size:${attrs.fontSize}px`);
    if (color(attrs.color)) styles.push(`color:${color(attrs.color)}`);
    return ["span", { style: styles.join(";") }, 0];
  },
});
export const Highlight = Mark.create({
  name: "highlight",
  addAttributes: () => ({ color: { default: HIGHLIGHTS[0] } }),
  parseHTML: () => [{ tag: "mark", getAttrs: el => ({ color: color((el as HTMLElement).style.backgroundColor) || HIGHLIGHTS[0] }) },
    { tag: "span[style]", getAttrs: el => { const c = color((el as HTMLElement).style.backgroundColor); return c ? { color: c } : false; } }],
  renderHTML: ({ mark }) => ["mark", { style: `background-color:${color(mark.attrs.color) || HIGHLIGHTS[0]};color:#102b55` }, 0],
});
export const DocumentFormatting = Extension.create({
  name: "documentFormatting",
  addGlobalAttributes: () => [
    { types: ["doc"], attributes: { typography: { default: null, rendered: false } } },
    { types: ["paragraph", "heading"], attributes: {
      lineHeight: { default: null, parseHTML: el => { const n = parseFloat(el.style.lineHeight); return LINE_HEIGHTS.includes(n) ? n : null; }, renderHTML: attrs => LINE_HEIGHTS.includes(attrs.lineHeight) ? { style: `line-height:${attrs.lineHeight}` } : {} },
      paragraphSpacing: { default: null, parseHTML: el => { const n = parseFloat(el.getAttribute("data-paragraph-spacing") || ""); return PARAGRAPH_SPACING.includes(n) ? n : null; }, renderHTML: attrs => PARAGRAPH_SPACING.includes(attrs.paragraphSpacing) ? { "data-paragraph-spacing": attrs.paragraphSpacing, style: `margin-bottom:${attrs.paragraphSpacing}em` } : {} },
      indent: { default: 0, parseHTML: el => Math.max(0, Math.min(6, Number(el.getAttribute("data-indent")) || 0)), renderHTML: attrs => attrs.indent > 0 && attrs.indent <= 6 ? { "data-indent": attrs.indent, style: `margin-inline-start:min(${attrs.indent * 1.5}em,35%)` } : {} },
      styleVariant: { default: null, parseHTML: el => ["title", "subtitle"].includes(el.getAttribute("data-document-style") || "") ? el.getAttribute("data-document-style") : null, renderHTML: attrs => ["title", "subtitle"].includes(attrs.styleVariant) ? { "data-document-style": attrs.styleVariant } : {} },
    } },
  ],
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-9": () => this.editor.commands.toggleTaskList(),
      "Alt-Shift-ArrowRight": () => indent(this.editor, 1),
      "Alt-Shift-ArrowLeft": () => indent(this.editor, -1),
      Tab: () => this.editor.isActive("taskItem") ? this.editor.commands.sinkListItem("taskItem") : this.editor.isActive("listItem") ? this.editor.commands.sinkListItem("listItem") : false,
      "Shift-Tab": () => this.editor.isActive("taskItem") ? this.editor.commands.liftListItem("taskItem") : this.editor.isActive("listItem") ? this.editor.commands.liftListItem("listItem") : false,
    };
  },
});
export function formatChain(editor: Editor) {
  return editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true; });
}
export function setTextStyle(editor: Editor, attrs: Record<string, unknown>) {
  return formatChain(editor).setMark("textStyle", attrs).command(({ tr }) => {
    const { from, to } = tr.selection;
    tr.doc.nodesBetween(from, to, (node, pos) => {
      const mark = node.marks.find(mark => mark.type.name === "textStyle");
      if (node.isText && mark && Object.values(mark.attrs).every(value => value == null))
        tr.removeMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), mark.type);
    });
    if (tr.selection.empty && tr.storedMarks)
      tr.setStoredMarks(tr.storedMarks.filter(mark => mark.type.name !== "textStyle" || Object.values(mark.attrs).some(value => value != null)));
    return true;
  }).run();
}
export function blockStyle(editor: Editor, attrs: Record<string, unknown>) {
  return formatChain(editor).updateAttributes("paragraph", attrs).updateAttributes("heading", attrs).run();
}
export function indent(editor: Editor, direction: 1 | -1) {
  const item = editor.isActive("taskItem") ? "taskItem" : editor.isActive("listItem") ? "listItem" : null;
  if (item) return direction === 1 ? editor.chain().focus().sinkListItem(item).run() : editor.chain().focus().liftListItem(item).run();
  const { from, to } = editor.state.selection;
  const tr = closeHistory(editor.state.tr);
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (["paragraph", "heading"].includes(node.type.name)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.max(0, Math.min(6, (node.attrs.indent || 0) + direction)) });
  });
  editor.view.dispatch(tr); editor.view.focus(); return tr.docChanged;
}
export function clearFormatting(editor: Editor) {
  // Do not unsetAllMarks: session provenance is not visual formatting.
  const chain = formatChain(editor);
  for (const name of ["bold", "italic", "underline", "strike", "link", "textStyle", "highlight"]) chain.unsetMark(name);
  return chain.updateAttributes("paragraph", { textAlign: null, lineHeight: null, paragraphSpacing: null, indent: 0, styleVariant: null })
    .updateAttributes("heading", { textAlign: null, lineHeight: null, paragraphSpacing: null, indent: 0, styleVariant: null }).run();
}
