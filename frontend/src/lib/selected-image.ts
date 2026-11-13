import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

export function selectedImage(editor: Editor) {
  const selection = editor.state.selection;
  if (selection instanceof NodeSelection && selection.node.type.name === "image") return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === "image") return { pos: $from.before(depth), node: $from.node(depth) };
  return null;
}
