const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {waitProject}=require('./project-picker.cjs');
module.exports=async({page,context,origin,documents,activity,requests,errors,setSignedIn,setOffline})=>{
 const out=path.resolve('tests/artifacts/editor-formatting');fs.mkdirSync(out,{recursive:true});setSignedIn(true);
 await context.addInitScript(()=>localStorage.setItem('uno-tour-launch-hidden:00000000-0000-4000-8000-000000000001','1'));
 const results=[],pass=name=>{results.push(name);console.log('PASS '+name)};
 const canvas=page.getByRole('textbox',{name:'Document content',exact:true});
 const until=async(fn,label)=>{for(let n=0;n<200;n++){if(fn())return;await page.waitForTimeout(50)}throw Error('Did not settle: '+label)};
 const saved=()=>page.locator('.uw-editor-save .uw-studio-status[data-tone="success"]').waitFor();
 const body=()=>canvas.evaluate(el=>el.editor.getJSON());
 const doc=()=>[...documents.values()][0];
 const credits=()=>[...activity.values()].map(row=>({id:row.id,typed:row.typed_words,pasted:row.pasted_words}));
 const select=()=>canvas.evaluate(el=>{el.editor.commands.setTextSelection({from:1,to:1+el.editor.state.doc.firstChild.content.size});el.editor.view.focus()});
 const settle=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
 const panels={Text:'Selected text',Paragraph:'Paragraph settings','Document style':'Document typography'};
 async function open(name){const panel=page.locator('.uw-format-panel').filter({has:page.getByRole('heading',{name:panels[name],exact:true})});if(!await panel.isVisible())await page.getByRole('button',{name,exact:true}).click();return panel;}
 async function set(panel,label,value){const p=await open(panel);await p.getByLabel(label,{exact:true}).selectOption(String(value));}
 const dismiss=()=>page.keyboard.press('Escape');
 const serverMatches=async()=>{
  await saved();await until(()=>!!doc(),'document');
  await until(()=>JSON.stringify(doc()?.content).includes('typography'),'stored typography');
  assert.equal(await canvas.evaluate((el,json)=>el.editor.schema.nodeFromJSON(json).eq(el.editor.state.doc),doc().content),true,'real server validator keeps formatting');
 };
 await page.goto(origin+'/editor');await waitProject(page,'');await page.getByRole('button',{name:'Start New Document',exact:true}).click();
 await page.getByLabel('Rename document',{exact:true}).fill('The shape of a story');await canvas.focus();
 await page.keyboard.type('A quiet observation can become a meaningful story.');await page.keyboard.press('Enter');await page.keyboard.type('Notice the detail.');await page.keyboard.press('Enter');await page.keyboard.type('Ask an honest question.');await saved();
 await canvas.evaluate(el=>window.__formatView=el.editor.view);const initialText=await canvas.innerText(),initialCredit=credits();
 await select();await set('Text','Font family','sans');await set('Text','Font size',24);await set('Text','Text color','#7136a2');await set('Text','Highlight color','#d8efde');await dismiss();await saved();
 let json=await body(),marks=json.content[0].content[0].marks;
 assert.ok(marks.some(m=>m.type==='textStyle'&&m.attrs.fontFamily==='sans'&&m.attrs.fontSize===24&&m.attrs.color==='#7136a2'));
 assert.ok(marks.some(m=>m.type==='highlight'&&m.attrs.color==='#d8efde'));
 await select();await set('Paragraph','Alignment','justify');await set('Paragraph','Line spacing',2);await set('Paragraph','Paragraph spacing',1.5);await (await open('Paragraph')).getByRole('button',{name:'Increase indent',exact:true}).click();await dismiss();await saved();
 json=await body();assert.equal(json.content[0].attrs.indent,1);assert.equal(json.content[0].attrs.lineHeight,2);assert.equal(json.content[0].attrs.paragraphSpacing,1.5);assert.equal(json.content[0].attrs.textAlign,'justify');
 await set('Document style','Default font','mono');await set('Document style','Default font size',20);await set('Document style','Default line spacing',1.6);await set('Document style','Default paragraph spacing',1);await dismiss();await saved();await serverMatches();
 assert.deepEqual((await body()).attrs.typography,{fontFamily:'mono',fontSize:20,lineHeight:1.6,paragraphSpacing:1});
 assert.equal(await canvas.locator('p').first().locator('span[style]').first().evaluate(el=>getComputedStyle(el).fontSize),'24px');
 assert.equal(await canvas.locator('p').nth(1).evaluate(el=>getComputedStyle(el).fontSize),'20px');
 assert.deepEqual(credits(),initialCredit,'formatting never changes typed/pasted credit');assert.equal(await canvas.innerText(),initialText);
 await page.getByRole('button',{name:'Undo (Ctrl/⌘ Z)',exact:true}).click();await saved();assert.equal((await body()).attrs.typography.paragraphSpacing,.9);
 await page.getByRole('button',{name:'Redo (Ctrl/⌘ Shift Z)',exact:true}).click();await saved();assert.equal((await body()).attrs.typography.paragraphSpacing,1);
 pass('Selected font/size/color/highlight and document/paragraph styles survive real Python validation without changing session credit');
 await select();for(const [value,type,variant,level] of [['title','heading','title',1],['subtitle','paragraph','subtitle'],['1','heading',null,1],['2','heading',null,2],['3','heading',null,3],['paragraph','paragraph',null]]){
  await page.getByLabel('Heading level',{exact:true}).selectOption(value);const block=(await body()).content[0];assert.equal(block.type,type);assert.equal(block.attrs.styleVariant,variant);if(level)assert.equal(block.attrs.level,level);
 }
 pass('Title, Subtitle, H1–H3 and normal styles retain semantic structure');
 await select();const beforeClear=await body();await (await open('Text')).getByRole('button',{name:'Clear formatting',exact:true}).click();await dismiss();await saved();
 assert.ok((await body()).content[0].content.every(n=>!n.marks?.some(m=>['textStyle','highlight','bold','italic','underline','strike','link'].includes(m.type))));
 assert.ok((await body()).content[0].content.some(n=>n.marks?.some(m=>m.type==='sessionCredit')));
 await page.getByRole('button',{name:'Undo (Ctrl/⌘ Z)',exact:true}).click();await saved();assert.deepEqual(await body(),beforeClear);
 await page.getByRole('button',{name:'Redo (Ctrl/⌘ Shift Z)',exact:true}).click();await saved();assert.deepEqual(credits(),initialCredit);
 await select();await set('Text','Font family','sans');await set('Text','Font family','');await dismiss();await saved();
 assert.ok((await body()).content[0].content.every(n=>!n.marks?.some(m=>m.type==='textStyle')),'empty style marks are removed before the server normalizes them');
 await page.getByRole('button',{name:'Undo (Ctrl/⌘ Z)',exact:true}).click();await saved();
 assert.ok((await body()).content[0].content.some(n=>n.marks?.some(m=>m.type==='textStyle'&&m.attrs.fontFamily==='sans')),'resetting the final inline override preserves undo after save');
 await page.getByRole('button',{name:'Redo (Ctrl/⌘ Shift Z)',exact:true}).click();await saved();
 pass('Clear formatting preserves provenance; one undo restores formats and redo does not count words again');
 await canvas.evaluate(el=>{const doc=el.editor.state.doc;let pos=1;doc.forEach((node,offset,index)=>{if(index===1)pos=offset+1});el.editor.commands.setTextSelection(pos);el.editor.view.focus()});
 const beforeChecklist=credits();
 await page.getByRole('button',{name:'Checklist',exact:true}).click();await saved();
 assert.equal(await canvas.locator('li[data-type="taskItem"]').first().evaluate(el=>getComputedStyle(el).display),'flex','checkbox and writing share a row');
 const checkbox=canvas.getByRole('checkbox').first();await checkbox.check();await saved();assert.deepEqual(credits(),beforeChecklist,'list structure and checkbox changes do not grant typed words');
 assert.ok((await body()).content.some(n=>n.type==='taskList'&&n.content[0].attrs.checked===true));
 await canvas.evaluate(el=>{let pos;el.editor.state.doc.descendants((node,p)=>{if(node.type.name==='taskItem'&&pos===undefined)pos=p+2});el.editor.commands.setTextSelection(pos);el.editor.view.focus()});
 await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('Explore the memory');await page.keyboard.press('Tab');await saved();
 assert.equal(await canvas.locator('ul[data-type="taskList"] ul[data-type="taskList"]').count(),1);
 await page.keyboard.press('Shift+Tab');await saved();assert.equal(await canvas.locator('ul[data-type="taskList"] ul[data-type="taskList"]').count(),0);
 pass('Checklist toggles, checkbox state, Enter, Tab and Shift+Tab work through the official nested-list commands');
 await select();await page.getByRole('toolbar',{name:'Selection formatting',exact:true}).waitFor();
 const floating=page.getByRole('toolbar',{name:'Selection formatting',exact:true});
 await floating.getByRole('button',{name:'Selection: Bold',exact:true}).click();assert.equal(await floating.getByRole('button',{name:'Selection: Bold',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByLabel('Heading level',{exact:true}).selectOption('title');
 await floating.getByRole('button',{name:'Selection: Heading 2',exact:true}).click();
 assert.equal((await body()).content[0].attrs.level,2);assert.equal((await body()).content[0].attrs.styleVariant,null);
 await page.getByLabel('Heading level',{exact:true}).selectOption('paragraph');await select();await floating.waitFor();
 const geometry=await canvas.evaluate(el=>{
  const range=window.getSelection().getRangeAt(0).getBoundingClientRect(),menu=document.querySelector('.uw-selection-toolbar').getBoundingClientRect();
  return {overlap:menu.bottom>range.top&&menu.top<range.bottom,left:menu.left,right:menu.right,viewport:innerWidth,view:el.editor.view===window.__formatView};
 });
 assert.equal(geometry.overlap,false,'floating toolbar does not cover selection');assert.ok(geometry.left>=0&&geometry.right<=geometry.viewport);assert.equal(geometry.view,true);
 await page.screenshot({path:path.join(out,'selection-desktop.png')});
 await (await open('Document style')).getByLabel('Show selection toolbar',{exact:true}).uncheck();await dismiss();assert.equal(await floating.count(),0);
 await (await open('Document style')).getByLabel('Show selection toolbar',{exact:true}).check();await dismiss();
 pass('Optional selection toolbar formats existing selection, avoids overlap and can be disabled without remounting the editor');
 await canvas.evaluate(el=>{el.editor.commands.setTextSelection(el.editor.state.doc.content.size-1);el.editor.view.focus()});await saved();
 await page.setViewportSize({width:1440,height:1100});await open('Text');await page.screenshot({path:path.join(out,'text-desktop.png')});await dismiss();
 await open('Document style');await page.screenshot({path:path.join(out,'document-desktop.png')});await dismiss();
 if(process.env.AXE_SCRIPT)await page.addScriptTag({path:process.env.AXE_SCRIPT});
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:1100});
  for(const name of ['Text','Paragraph','Document style']){
   const panel=await open(name);const rect=await panel.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
   if(process.env.AXE_SCRIPT){const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('.uw-studio'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[]);}
   if(width===390&&name==='Paragraph')await page.screenshot({path:path.join(out,'paragraph-mobile.png')});await dismiss();
  }
 }
 pass('All three formatting panels fit five viewport widths and pass axe WCAG 2/2.1 AA checks');
 await page.setViewportSize({width:1440,height:1100});await set('Document style','Default font','sans');await dismiss();await saved();const persisted=await body(),persistedCredit=credits();
 await page.reload();await waitProject(page,'');await canvas.waitFor();await saved();assert.deepEqual(await body(),persisted);assert.deepEqual(credits(),persistedCredit);
 assert.equal(await canvas.evaluate(el=>getComputedStyle(el).fontFamily.includes('Inter')),true);
 pass('Reopen preserves root typography, text marks, paragraph attributes, checklist state and session history');
 setOffline(true);await context.setOffline(true);await select();await set('Text','Font size',28);await dismiss();
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.toLowerCase().includes('offline'));
 const offline=await body();setOffline(false);await context.setOffline(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await saved();assert.equal(await canvas.evaluate((el,json)=>el.editor.schema.nodeFromJSON(json).eq(el.editor.state.doc),doc().content),true);assert.deepEqual(await body(),offline);
 pass('Offline formatting stays local and synchronizes intact after reconnect');
 await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();await settle();await select();await page.getByRole('toolbar',{name:'Selection formatting',exact:true}).waitFor();await page.screenshot({path:path.join(out,'focus-selection.png')});await page.getByRole('button',{name:'Exit focus mode',exact:true}).click();await settle();
 await page.getByRole('button',{name:'Dark theme',exact:true}).click();await open('Document style');await page.screenshot({path:path.join(out,'dark-document.png')});await dismiss();
 await page.getByLabel('Language',{exact:true}).selectOption('es');await page.getByRole('button',{name:'Párrafo',exact:true}).click();await page.getByLabel('Interlineado',{exact:true}).waitFor();await dismiss();
 await dismiss();await page.getByLabel('Idioma',{exact:true}).selectOption('en');await page.setViewportSize({width:320,height:1100});await select();
 await set('Text','Font size',64);await dismiss();
 const indentPanel=await open('Paragraph');for(let i=0;i<6;i++)await indentPanel.getByRole('button',{name:'Increase indent',exact:true}).click();await dismiss();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('.uw-editor-paper').scrollWidth<=document.querySelector('.uw-editor-paper').clientWidth+1),'large text and deep paragraph indentation stay contained on mobile');
 pass('Large text and maximum paragraph indentation remain contained at 320px');
 await page.setViewportSize({width:1440,height:1100});await page.getByRole('button',{name:'New document',exact:true}).click();await page.locator('.uw-editor-session-controls[data-session-state="ready"]').waitFor();
 const sessionCount=activity.size;
 await canvas.evaluate(el=>{el.editor.commands.setContent({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'An older draft without a current writing session.'}]}]},{emitUpdate:false});el.editor.commands.selectAll();el.editor.view.focus()});
 await page.getByRole('button',{name:'Checklist',exact:true}).click();await saved();
 assert.equal(activity.size,sessionCount,'formatting existing prose must not create a zero-word writing session');
 assert.equal(await page.locator('.uw-editor-session-controls').getAttribute('data-session-state'),'ready');
 pass('Formatting an existing draft without typing does not start a session or award words');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({scope:'Actual production editor + isolated HTTP fixtures + real Python clean_document for writes; real IndexedDB. No live/private Supabase or physical-device validation.',results,requestsValidated:requests.filter(r=>r.method==='PUT'&&r.key.startsWith('/workspace/documents/')).length},null,2)+'\n');
 console.log('PASS Phase 2 formatting suite: '+results.length+' grouped scenarios');
};
