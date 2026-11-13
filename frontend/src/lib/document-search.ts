import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode, Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";

export type Match = { from: number; to: number };
export type SearchState = { query: string; matchCase: boolean; matches: Match[]; active: number; limited: boolean };
export const searchKey = new PluginKey<SearchState>("documentSearch");
const decorationCache = new WeakMap<SearchState, DecorationSet>();
const empty: SearchState = { query: "", matchCase: false, matches: [], active: 0, limited: false };
export function findMatches(doc: ProseMirrorNode, query: string, matchCase: boolean) {
  const matches: Match[] = [];
  let limited = false;
  if (!query || query.length > 200) return { matches, limited };
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  doc.descendants((node, pos) => {
    if (!node.isTextblock || limited) return;
    let text = "", start = pos + 1;
    const flush = () => {
      expression.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = expression.exec(text))) {
        if (matches.length === 10000) { limited = true; break; }
        matches.push({ from: start + match.index, to: start + match.index + match[0].length });
      }
      text = "";
    };
    node.forEach((child, offset) => {
      if (child.isText) { if (!text) start = pos + 1 + offset; text += child.text; }
      else flush();
    });
    flush();
    return false;
  });
  return { matches, limited };
}
export const DocumentSearch = Extension.create({
  name: "documentSearch",
  addProseMirrorPlugins: () => [new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => ({ ...empty }),
      apply(tr, previous) {
        const change = tr.getMeta(searchKey) as Partial<SearchState> | undefined;
        if (!tr.docChanged && !change) return previous;
        const next = { ...previous, ...change };
        if (tr.docChanged || change?.query !== undefined || change?.matchCase !== undefined) Object.assign(next, findMatches(tr.doc, next.query, next.matchCase));
        next.active = Math.max(0, Math.min(next.active, next.matches.length - 1));
        return next;
      },
    },
    props: { decorations(state) {
      const search = searchKey.getState(state)!;
      const cached = decorationCache.get(search);
      if (cached) return cached;
      const decorations = DecorationSet.create(state.doc, search.matches.flatMap((match, index) => index < 2000 || index === search.active ? [Decoration.inline(match.from, match.to, { class: index === search.active ? "uw-search-match uw-search-active" : "uw-search-match" })] : []));
      decorationCache.set(search, decorations);
      return decorations;
    } },
  })],
});
export function setSearch(editor: Editor, query: string, matchCase: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { query, matchCase, active: 0 }).setMeta("addToHistory", false));
}
export function navigateMatch(editor: Editor, direction: number) {
  const state = searchKey.getState(editor.state)!;
  if (!state.matches.length) return;
  const active = (state.active + direction + state.matches.length) % state.matches.length;
  const match = state.matches[active];
  editor.view.dispatch(editor.state.tr.setMeta(searchKey, { active }).setMeta("addToHistory", false).setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView());
}
// A replace command is an edit of existing writing, not newly typed prose. Keep
// a common source credit only when the entire match has the same provenance.
function replacementMarks(doc: ProseMirrorNode, match: Match): readonly Mark[] {
  let marks: readonly Mark[] | undefined;
  doc.nodesBetween(match.from, match.to, node => {
    if (!node.isText) return;
    marks = marks === undefined ? node.marks : marks.filter(mark => node.marks.some(other => mark.eq(other)));
  });
  return marks || [];
}
export function replaceMatches(editor: Editor, replacement: string, all = false) {
  const search = searchKey.getState(editor.state)!;
  if (!editor.isEditable || !search.matches.length || replacement.length > 2000 || (/[\r\n]/.test(replacement) || replacement.includes("\0")) || (all && search.limited)) return false;
  const matches = all ? search.matches : [search.matches[search.active]];
  const projectedLength = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n").length + matches.reduce((delta, match) => delta + replacement.length - (match.to - match.from), 0);
  if (projectedLength > 200000) return false;
  const tr = closeHistory(editor.state.tr).setMeta("unoPreserveCredit", true);
  for (const match of [...matches].reverse()) {
    tr.replaceWith(match.from, match.to, replacement ? editor.schema.text(replacement, replacementMarks(editor.state.doc, match)) : []);
  }
  let nodes = 1, invalidCaption = false;
  tr.doc.descendants(node => { nodes++; if (node.type.name === "image" && node.textContent.length > 2000) invalidCaption = true; });
  if (invalidCaption || nodes > 15000 || new TextEncoder().encode(JSON.stringify(tr.doc.toJSON())).byteLength > 1048576) return false;
  editor.view.dispatch(tr); return true;
}
