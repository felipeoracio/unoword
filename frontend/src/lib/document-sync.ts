import type { Editor } from "@tiptap/core";
import { Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";

/** Mark boundaries can change on save without changing any prose or positions. */
function sameStructure(before: ProseMirrorNode, after: ProseMirrorNode) {
  if (before.textContent !== after.textContent || before.content.size !== after.content.size) return false;
  const blocks: string[] = [];
  before.descendants((node, pos) => { if (!node.isText) blocks.push(`${pos}:${node.type.name}:${node.nodeSize}`); });
  let index = 0, matches = true;
  after.descendants((node, pos) => {
    if (!node.isText && blocks[index++] !== `${pos}:${node.type.name}:${node.nodeSize}`) matches = false;
  });
  return matches && index === blocks.length;
}

/** Reconcile the same open document without turning an autosave into a full
 * replacement. Attribute/mark-only normalization has identity position maps,
 * keeping selections, bookmarks and undo steps attached to prose. */
export function reconcileSavedDocument(editor: Editor, stored: ProseMirrorNode) {
  const before = editor.state.doc;
  if (before.eq(stored)) return;
  const tr = editor.state.tr.setMeta("preventUpdate", true).setMeta("addToHistory", false);
  if (sameStructure(before, stored)) {
    stored.descendants((node, pos) => {
      if (node.isText) {
        let equal = true;
        tr.doc.nodesBetween(pos, pos + node.nodeSize, current => {
          if (current.isText && !Mark.sameSet(current.marks, node.marks)) equal = false;
        });
        if (!equal) {
          tr.removeMark(pos, pos + node.nodeSize);
          for (const mark of node.marks) tr.addMark(pos, pos + node.nodeSize, mark);
        }
      } else {
        const current = tr.doc.nodeAt(pos)!;
        for (const [key, value] of Object.entries(node.attrs)) {
          if (JSON.stringify(current.attrs[key]) !== JSON.stringify(value)) tr.setNodeAttribute(pos, key, value);
        }
        if (!Mark.sameSet(current.marks, node.marks)) {
          for (const mark of current.marks) tr.removeNodeMark(pos, mark);
          for (const mark of node.marks) tr.addNodeMark(pos, mark);
        }
      }
    });
  } else {
    // Genuine remote/body changes still load, but only replace the differing
    // range so ordinary ProseMirror selection/history mapping can do its job.
    const start = before.content.findDiffStart(stored.content);
    const end = before.content.findDiffEnd(stored.content);
    if (start !== null && end) {
      const overlap = Math.max(0, start - Math.min(end.a, end.b));
      tr.replace(start, end.a + overlap, stored.slice(start, end.b + overlap));
    }
  }
  for (const [key, value] of Object.entries(stored.attrs)) {
    if (JSON.stringify(tr.doc.attrs[key]) !== JSON.stringify(value)) tr.setDocAttribute(key, value);
  }
  editor.view.dispatch(tr);
}
