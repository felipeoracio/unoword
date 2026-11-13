import type { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
/** New document identity starts fresh transient plugin/history state. Keep the
 * same editor/view/DOM; never call for autosave responses or Focus Mode. */
export function resetDocumentHistory(editor: Editor) {
 const state=editor.state;
 editor.view.updateState(EditorState.create({schema:state.schema,doc:state.doc,selection:state.selection,plugins:state.plugins}));
 editor.view.dispatch(editor.state.tr.setMeta('preventUpdate',true).setMeta('addToHistory',false));
}
