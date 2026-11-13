import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { history, undo, redo, closeHistory } from "@tiptap/pm/history";
import { SessionCredit, sessionCreditWords, type Credit } from "../src/lib/session-credit";

function harness(text = "old draft") {
  const schema = getSchema([StarterKit, SessionCredit]);
  let credit: Credit | null = { session: "current", kind: "typed" };
  const plugins = SessionCredit.config.addProseMirrorPlugins!.call({
    type: schema.marks.sessionCredit, options: { credit: () => credit },
  } as never);
  let state = EditorState.create({ schema,
    doc: schema.node("doc", null, [schema.node("paragraph", null, text ? schema.text(text) : undefined)]),
    plugins: [history(), ...plugins],
  });
  const apply = (tr: typeof state.tr) => { state = state.applyTransaction(tr).state; };
  return {
    get state() { return state; },
    counts: (id = "current") => sessionCreditWords(state.doc, id),
    insert: (text: string, pos = state.doc.content.size - 1) => apply(closeHistory(state.tr).insertText(text, pos)),
    delete: (from: number, to: number) => apply(closeHistory(state.tr).delete(from, to)),
    undo: () => undo(state, apply), redo: () => redo(state, apply),
    credit: (value: Credit | null) => { credit = value; },
  };
}
it("keeps 100 session words after deleting 50 older words from a 2,000-word draft", () => {
  const h = harness(Array(2000).fill("old").join(" "));
  h.insert(" " + Array(100).fill("new").join(" "));
  h.delete(1, 201);
  expect(h.counts()).toEqual({ typedWords: 100, pastedWords: 0 });
  expect(h.state.doc.textContent.split(/\s+/)).toHaveLength(2050);
  h.undo(); h.redo(); expect(h.counts().typedWords).toBe(100);
});
it("restores deleted session words through repeated undo/redo without double credit", () => {
  const h = harness(); h.insert(" new words");
  expect(h.counts().typedWords).toBe(2);
  h.delete(10, 20); expect(h.counts().typedWords).toBe(0);
  for (let i = 0; i < 3; i++) {
    h.undo(); expect(h.counts().typedWords).toBe(2);
    h.redo(); expect(h.counts().typedWords).toBe(0);
  }
});
it("preserves paste credit through undo/redo and keeps replacement typing separate", () => {
  const h = harness(); h.credit({ session: "current", kind: "pasted" });
  h.insert(" pasted words");
  h.undo(); expect(h.counts().pastedWords).toBe(0);
  h.redo(); expect(h.counts()).toEqual({ typedWords: 0, pastedWords: 2 });
  h.credit({ session: "current", kind: "typed" });
  h.delete(11, 17); h.insert("typed", 11);
  expect(h.counts()).toEqual({ typedWords: 1, pastedWords: 1 });
});
it("does not credit partial edits of old words and separates session identities", () => {
  const h = harness(); h.insert("er", 4);
  expect(h.counts().typedWords).toBe(0);
  h.insert(" new"); h.credit({ session: "next", kind: "typed" }); h.insert(" next");
  expect(h.counts("next").typedWords).toBe(1);
  expect(h.counts().typedWords).toBe(1);
});
it("preserves provenance in stored JSON", () => {
  const h = harness(""); h.insert("one two");
  const restored = h.state.schema.nodeFromJSON(JSON.parse(JSON.stringify(h.state.doc.toJSON())));
  expect(sessionCreditWords(restored, "current").typedWords).toBe(2);
});
it("counts words across formatting spans and separates hard line breaks", () => {
  const h = harness(""); const schema = h.state.schema;
  const credit = schema.marks.sessionCredit.create({ session: "current", kind: "typed" });
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [
    schema.text("hel", [credit]), schema.text("lo", [credit, schema.marks.bold.create()]),
    schema.node("hardBreak"), schema.text("world", [credit]),
  ])]);
  expect(sessionCreditWords(doc, "current").typedWords).toBe(2);
});
it("does not reclassify pasted text when part of its word is edited", () => {
  const h = harness(""); h.credit({session:"current",kind:"pasted"}); h.insert("pasted");
  h.credit({session:"current",kind:"typed"}); h.insert("x", 3);
  expect(h.counts()).toEqual({typedWords:0,pastedWords:1});
});
