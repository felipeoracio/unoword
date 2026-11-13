import { Mark } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type Credit = { session: string; kind: "typed" | "pasted" };

// Invisible provenance travels with text through normal ProseMirror history.
// HTML export deliberately omits it, so external paste cannot import credit.
export const SessionCredit = Mark.create<{ credit: () => Credit | null }>({
  name: "sessionCredit",
  inclusive: false,
  addOptions: () => ({ credit: () => null }),
  addAttributes: () => ({
    session: { default: null, rendered: false },
    kind: { default: null, rendered: false },
  }),
  parseHTML: () => [],
  renderHTML: () => ["span", {}, 0],
  addProseMirrorPlugins() {
    const type = this.type;
    const getCredit = this.options.credit;
    return [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(tr => tr.docChanged) ||
            transactions.some(tr => isHistoryTransaction(tr) || tr.getMeta("preventUpdate") || tr.getMeta("sessionCredit"))) return null;
        const ranges: { from: number; to: number }[] = [];
        transactions.forEach((transaction, transactionIndex) => {
          transaction.steps.forEach((_step, stepIndex) => {
            transaction.mapping.maps[stepIndex].forEach((_a, _b, from, to) => {
              if (from === to) return;
              const remaining = transaction.mapping.slice(stepIndex + 1);
              from = remaining.map(from, 1);
              to = remaining.map(to, -1);
              for (const later of transactions.slice(transactionIndex + 1)) {
                from = later.mapping.map(from, 1);
                to = later.mapping.map(to, -1);
              }
              if (from < to) ranges.push({ from, to });
            });
          });
        });
        // List/heading transforms insert structural boundaries, not new prose.
        // Do not start a writing session or relabel existing text for those edits.
        const textRanges = ranges.filter(({ from, to }) => {
          let hasText = false;
          state.doc.nodesBetween(from, to, node => { if (node.isText) hasText = true; });
          return hasText;
        });
        if (!textRanges.length) return null;
        const credit = getCredit();
        const tr = state.tr.setMeta("sessionCredit", true);
        for (const { from, to } of textRanges) {
          tr.removeMark(from, to, type);
          if (credit) tr.addMark(from, to, type.create(credit));
        }
        return tr.steps.length ? tr : null;
      },
    })];
  },
});

// Count complete tokens, across formatting boundaries. Existing text takes
// precedence in mixed words; pasted text cannot become typed credit by editing it.
export function sessionCreditWords(doc: ProseMirrorNode, session: string) {
  let typedWords = 0, pastedWords = 0;
  let hasWord = false, existing = false, pasted = false;
  const flush = () => {
    if (hasWord && !existing) {
      if (pasted) pastedWords++;
      else typedWords++;
    }
    hasWord = existing = pasted = false;
  };
  doc.descendants(node => {
    if (node.isBlock || node.type.name === "hardBreak") flush();
    if (!node.isText) return;
    const credit = node.marks.find(mark => mark.type.name === "sessionCredit");
    for (const char of node.text || "") {
      if (/\s/u.test(char)) { flush(); continue; }
      if (/[\p{L}\p{N}]/u.test(char)) {
        hasWord = true;
        if (credit?.attrs.session !== session) existing = true;
        else if (credit.attrs.kind === "pasted") pasted = true;
      }
    }
  });
  flush();
  return { typedWords, pastedWords };
}
