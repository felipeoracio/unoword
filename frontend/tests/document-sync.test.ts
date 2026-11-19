import { expect, it } from "vitest";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo, redo, undoDepth } from "@tiptap/pm/history";
import { reconcileSavedDocument } from "../src/lib/document-sync";
import { DocumentSubtitle } from "../src/lib/document-subtitle";
import { SessionCredit, sessionCreditWords } from "../src/lib/session-credit";

const schema = getSchema([StarterKit, DocumentSubtitle, SessionCredit]);
const paragraph = (text: string) => schema.node("paragraph", null, schema.text(text));
function fixture() {
  let state = EditorState.create({ schema, doc: schema.node("doc", null, [paragraph("Earlier writing."), paragraph("Final writing.")]), plugins: [history()] });
  const transactions: (typeof state.tr)[] = [];
  const apply = (tr: typeof state.tr) => { transactions.push(tr); state = state.apply(tr); };
  const editor = { get state() { return state; }, view: { dispatch: apply } } as unknown as Editor;
  return { editor, apply, transactions, get state() { return state; } };
}

it("normalizes saved link attributes without moving a cursor, adding undo entries or changing session credit", () => {
  const f = fixture();
  const link = schema.marks.link.create({ href: "https://example.com/", target: "_self" });
  f.apply(f.state.tr.addMark(1, 17, link).setMeta("addToHistory", false));
  f.apply(f.state.tr.setSelection(TextSelection.create(f.state.doc, 4)));
  f.apply(f.state.tr.insertText("new ").addMark(4, 8, schema.marks.sessionCredit.create({ session: "current", kind: "typed" })));
  const saved = structuredClone(f.state.doc.toJSON());
  for (const node of saved.content[0].content) for (const mark of node.marks || []) if (mark.type === "link") mark.attrs.target = "_blank";
  const target = schema.nodeFromJSON(saved), credit = sessionCreditWords(f.state.doc, "current");
  const before = f.state.selection;
  reconcileSavedDocument(f.editor, target);
  expect(f.state.doc.eq(target)).toBe(true);
  expect(f.state.selection.eq(before)).toBe(true);
  expect(undoDepth(f.state)).toBe(1);
  expect(sessionCreditWords(f.state.doc, "current")).toEqual(credit);
  expect(f.transactions.at(-1)?.getMeta("preventUpdate")).toBe(true);
  expect(undo(f.state, f.apply)).toBe(true);
  expect(f.state.doc.textContent).toBe("Earlier writing.Final writing.");
  expect(redo(f.state, f.apply)).toBe(true);
  expect(sessionCreditWords(f.state.doc, "current")).toEqual(credit);
});

it("retains a backward selection when saved marks change text-node boundaries", () => {
  const f = fixture();
  f.apply(f.state.tr.setSelection(TextSelection.create(f.state.doc, 12, 3)));
  const saved = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Earlier", [schema.marks.bold.create()]), schema.text(" writing.")]), paragraph("Final writing.")]);
  reconcileSavedDocument(f.editor, saved);
  expect(f.state.doc.eq(saved)).toBe(true);
  expect(f.state.selection.anchor).toBe(12);
  expect(f.state.selection.head).toBe(3);
  expect(undoDepth(f.state)).toBe(0);
});

it("updates root metadata without replacing prose or its selection", () => {
  const f = fixture();
  f.apply(f.state.tr.setSelection(TextSelection.create(f.state.doc, 5)));
  const saved = schema.node("doc", { subtitle: "Saved subtitle" }, f.state.doc.content);
  reconcileSavedDocument(f.editor, saved);
  expect(f.state.doc.eq(saved)).toBe(true);
  expect(f.state.selection.from).toBe(5);
  expect(f.transactions.at(-1)?.steps.map(step => step.toJSON().stepType)).toEqual(["docAttr"]);
});

it("maps the selection through a genuine remote edit before the cursor", () => {
  const f = fixture();
  const position = f.state.doc.firstChild!.nodeSize + 5;
  f.apply(f.state.tr.setSelection(TextSelection.create(f.state.doc, position)));
  const saved = schema.node("doc", null, [paragraph("New Earlier writing."), paragraph("Final writing.")]);
  reconcileSavedDocument(f.editor, saved);
  expect(f.state.doc.eq(saved)).toBe(true);
  expect(f.state.selection.from).toBe(position + 4);
  expect(undoDepth(f.state)).toBe(0);
});

it("does not dispatch anything for an unchanged autosave response", () => {
  const f = fixture();
  reconcileSavedDocument(f.editor, f.state.doc);
  expect(f.transactions).toHaveLength(0);
});
