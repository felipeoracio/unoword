const assert=require('node:assert/strict');
module.exports=async({page,canvas,errors})=>{
 const saved=()=>page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 const text=()=>canvas.evaluate(el=>el.editor.state.doc.textContent);
 const position=()=>canvas.evaluate(el=>({from:el.editor.state.selection.from,to:el.editor.state.selection.to}));
 await canvas.fill('An earlier sentence needs care.\nA later sentence should stay here.\nThe final sentence stays at the end.');
 await saved();
 const original=await text();
 await canvas.evaluate(el=>{
  el.editor.commands.setTextSelection(4);el.editor.view.focus();
 });
 await page.keyboard.type('quiet ',{delay:120});
 assert.equal(await text(),original.slice(0,3)+'quiet '+original.slice(3));
 assert.deepEqual(await position(),{from:10,to:10},'typing into an earlier sentence retains the caret');
 await saved();
 assert.deepEqual(await position(),{from:10,to:10},'autosave retains the caret');
 await page.keyboard.type('lovely ',{delay:40});
 assert.deepEqual(await position(),{from:17,to:17});
 await page.keyboard.press('Backspace');
 assert.deepEqual(await position(),{from:16,to:16},'deletion in earlier prose retains the caret');
 await saved();
 assert.deepEqual(await position(),{from:16,to:16});
 // Pasted links may carry a target that the real backend canonicalizes on save.
 // The body is equivalent prose, but the saved document is not Node.eq() equal.
 const beforeNormalizedEdit=await text();
 await canvas.evaluate(el=>{
  el.editor.commands.setTextSelection({from:1,to:el.editor.state.doc.firstChild.nodeSize-1});
  el.editor.commands.setLink({href:'https://example.com/story',target:'_self'});
  el.editor.commands.setTextSelection(4);el.editor.view.focus();
 });
 await page.keyboard.type('new ',{delay:100});
 assert.deepEqual(await position(),{from:8,to:8});
 await saved();
 assert.deepEqual(await position(),{from:8,to:8},'server-normalized formatting must not move an earlier-sentence caret');
 assert.equal(await canvas.locator('a').first().getAttribute('target'),'_blank','the actual server sanitizer was applied');
 const afterNormalizedEdit=await text();
 await page.keyboard.press('Control+z');
 const undone=await text();
 assert.notEqual(undone,afterNormalizedEdit,'undo removes authored text rather than undoing autosave normalization');
 assert.ok(undone.endsWith(beforeNormalizedEdit.slice(3)),'undo keeps the original sentences intact');
 await page.keyboard.press('Control+Shift+z');
 assert.equal(await text(),beforeNormalizedEdit.slice(0,3)+'new '+beforeNormalizedEdit.slice(3),'redo restores the authored edit');
 await saved();
 assert.deepEqual(await position(),{from:8,to:8},'redo and its autosave keep the earlier caret');
 assert.equal(errors.length,0);
 console.log('PASS earlier-sentence typing, deletion, server normalization, undo/redo and autosave preserve the cursor');
};
