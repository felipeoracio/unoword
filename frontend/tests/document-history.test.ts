import { it, expect } from 'vitest';
import { getSchema, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { history, undo, undoDepth } from '@tiptap/pm/history';
import { resetDocumentHistory } from '../src/lib/document-history';
it('a document boundary clears previous undo steps while preserving the current document/view and future undo',()=>{
 const schema=getSchema([StarterKit]);let state=EditorState.create({schema,doc:schema.node('doc',null,[schema.node('paragraph',null,schema.text('Previous writing'))]),plugins:[history()]});
 const apply=(tr:typeof state.tr)=>{state=state.apply(tr)};
 const view={dispatch:apply,updateState(next:typeof state){state=next}};
 const editor={get state(){return state},view} as unknown as Editor;
 apply(state.tr.replaceWith(0,state.doc.content.size,schema.node('paragraph',null,schema.text('Imported writing',[schema.marks.bold.create()]))));
 expect(undoDepth(state)).toBe(1);const imported=state.doc,selection=state.selection;
 resetDocumentHistory(editor);expect(undoDepth(state)).toBe(0);expect(undo(state,apply)).toBe(false);expect(state.doc.eq(imported)).toBe(true);expect(state.selection.eq(selection)).toBe(true);expect(editor.view).toBe(view);
 apply(state.tr.insertText(' New words',state.doc.content.size-1));expect(undo(state,apply)).toBe(true);expect(state.doc.eq(imported)).toBe(true);
});
