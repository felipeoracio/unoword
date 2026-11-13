const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {waitProject}=require('./project-picker.cjs');
module.exports=async({page,context,origin,documents,activity,requests,errors,setSignedIn})=>{
 const baseline=process.env.CANVAS_BASELINE==='1';
 const out=path.resolve('tests/artifacts/editor-canvas',baseline?'before':'after');fs.mkdirSync(out,{recursive:true});
 setSignedIn(true);
 await context.addInitScript(()=>localStorage.setItem('uno-tour-launch-hidden:00000000-0000-4000-8000-000000000001','1'));
 await page.goto(origin+'/editor');await waitProject(page,'');
 await page.getByRole('button',{name:'Start New Document',exact:true}).click();
 const canvas=page.getByRole('textbox',{name:'Document content',exact:true});
 await canvas.waitFor();await page.getByLabel('Rename document',{exact:true}).fill('The art of paying attention');
 await canvas.evaluate(el=>{
  const picture=document.createElement('canvas');picture.width=1600;picture.height=900;
  const c=picture.getContext('2d'),sky=c.createLinearGradient(0,0,0,900);sky.addColorStop(0,'#a7c6d5');sky.addColorStop(1,'#e8ddc4');c.fillStyle=sky;c.fillRect(0,0,1600,900);
  c.fillStyle='#f6edcf';c.beginPath();c.arc(1140,260,85,0,2*Math.PI);c.fill();
  for(const [color,y,peak] of [['#8fa6ac',600,280],['#627e86',780,450],['#344e5c',920,650]]){c.fillStyle=color;c.beginPath();c.moveTo(0,y);c.lineTo(360,peak);c.lineTo(650,y-80);c.lineTo(1030,peak+100);c.lineTo(1600,y-50);c.lineTo(1600,900);c.lineTo(0,900);c.fill();}
  const text='Some mornings, the world asks very little of us. A quiet room. A warm cup. A few honest words on a page. When we slow down enough to notice, even an ordinary moment begins to reveal its own small story.';
  el.editor.commands.setContent({type:'doc',content:[
   {type:'heading',attrs:{level:2},content:[{type:'text',text:'The things we almost miss'}]},
   {type:'paragraph',content:[{type:'text',text}]},
   {type:'image',attrs:{src:picture.toDataURL('image/png'),width:1600,height:900,alt:'Synthetic mountain landscape for layout testing',title:null}},
   {type:'paragraph',content:[{type:'text',text:'There is a kind of clarity that arrives only when we make room for it. Not every thought needs to be hurried into an answer. Sometimes the work begins with a question, a memory, or a detail we cannot quite forget.'}]},
   {type:'blockquote',content:[{type:'paragraph',content:[{type:'text',text:'Pay attention. The beginning of a story is already here.'}]}]},
   {type:'paragraph',attrs:{textAlign:'right'},content:[{type:'text',text:'An existing formatted note.',marks:[{type:'bold'},{type:'italic'},{type:'underline'},{type:'link',attrs:{href:'https://unoword.app',target:'_blank',rel:'noopener noreferrer'}}]}]},
   {type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'A remembered detail'}]},{type:'orderedList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'A question to explore'}]}]}]}]}]},
   ...Array.from({length:12},()=>({type:'paragraph',content:[{type:'text',text}]})),
  ]});
  window.__canvasView=el.editor.view;
 });
 const saved=()=>page.locator('.uw-editor-save .uw-studio-status[data-tone="success"]').waitFor();
 const settle=()=>page.evaluate(async()=>{await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))});
 await saved();await settle();await page.evaluate(()=>document.activeElement?.blur());
 const content=()=>canvas.evaluate(el=>el.editor.getJSON());
 const original=await content();
 const credits=()=>[...activity.values()].map(a=>({id:a.id,typed:a.typed_words,pasted:a.pasted_words}));
 const originalCredits=credits();
 const device=await page.evaluate(()=>localStorage.getItem('uno-writing-device:00000000-0000-4000-8000-000000000001'));
 assert.ok([...activity.values()].every(row=>row.device_id===device),'session credit uses the signed-in device identity, including the first edit');
 const metrics=()=>page.evaluate(()=>{
  const paper=document.querySelector('.uw-editor-paper'),canvas=document.querySelector('.uw-writing-canvas'),scroll=document.querySelector('.uw-editor-paper-scroll'),img=canvas.querySelector('img');
  const box=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};
  return {viewport:innerWidth,paper:box(paper),text:box(canvas),image:box(img),workspace:box(scroll),fontSize:getComputedStyle(canvas).fontSize,lineHeight:getComputedStyle(canvas).lineHeight,padding:getComputedStyle(paper).paddingLeft,pageOverflow:document.documentElement.scrollWidth>innerWidth,paperOverflow:paper.scrollWidth>paper.clientWidth+1,viewRetained:canvas.editor.view===window.__canvasView};
 });
 const measurements=[];
 async function measure(label){await settle();await canvas.locator('img').evaluate(img=>img.decode());const m=await metrics();measurements.push({label,...m});return m;}
 if(baseline){
  for(const width of [1920,1440,1024,768,390,320]){await page.setViewportSize({width,height:1080});await measure('baseline');if([1920,768,390].includes(width))await page.screenshot({path:path.join(out,`${width}.png`)});}
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(measurements,null,2));return;
 }
 assert.equal(await page.locator('.uw-editor').getAttribute('data-page-width'),'comfortable');
 const choose=async(width)=>{
  if(!await page.locator('.uw-editor-view').evaluate(el=>el.open))await page.getByLabel('View',{exact:true}).click();
  await page.getByLabel('Page Width',{exact:true}).selectOption(width);
  await page.keyboard.press('Escape');
 };
 for(const width of [2560,1920,1440,1024,768,390,320]){
  await page.setViewportSize({width,height:1080});
  for(const mode of ['comfortable','standard','wide','full']){
   await choose(mode);const m=await measure(mode);
   assert.equal(m.pageOverflow,false,`${width}/${mode}: page overflow`);
   assert.equal(m.paperOverflow,false,`${width}/${mode}: paper overflow`);
   assert.ok(m.image.width<=Math.min(560,m.text.width)+1,'image display cap');
   assert.ok(Math.abs(m.image.width/m.image.height-1600/900)<0.01,'aspect ratio');
   assert.ok(Math.abs((m.image.left+m.image.right)/2-(m.text.left+m.text.right)/2)<1,'centered image');
   assert.ok(Math.abs((m.paper.left+m.paper.right)/2-(m.workspace.left+m.workspace.right)/2)<1,'centered paper');
   if(mode==='comfortable')assert.ok(m.text.width<=720,'comfortable text measure');
   if(mode==='wide')assert.ok(m.text.width<=1040,'wide text measure');
   assert.ok(m.viewRetained,'same editor view');
   assert.deepEqual(await content(),original,'layout changes must not rewrite content');
   if((mode==='comfortable'&&[1920,1440,768,390].includes(width))||(mode==='standard'&&width===1920)){
    await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:path.join(out,`${mode}-${width}.png`)});
    if(process.env.AXE_SCRIPT && mode==='comfortable') {
     if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:process.env.AXE_SCRIPT});
     await page.getByLabel('View',{exact:true}).click();
     const violations=await page.evaluate(async()=> (await axe.run(document.querySelector('.uw-studio'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));
     assert.deepEqual(violations,[],`accessibility at ${width}px`);
     if(width===1920)await page.screenshot({path:path.join(out,'view-menu-1920.png')});
     await page.keyboard.press('Escape');
    }
   }
  }
 }
 assert.deepEqual(credits(),originalCredits,'layout changes leave writing credit alone');
 await page.setViewportSize({width:1920,height:1080});await choose('wide');await saved();
 const beforeViewChanges=requests.filter(r=>r.method==='PUT'&&r.key.startsWith('/workspace/documents/')).length;
 await canvas.evaluate(el=>{el.editor.commands.setTextSelection({from:6,to:20});el.closest('.uw-editor-paper-scroll').scrollTop=240;});
 const selection=await canvas.evaluate(el=>({from:el.editor.state.selection.from,to:el.editor.state.selection.to}));
 await choose('comfortable');
 assert.deepEqual(await canvas.evaluate(el=>({from:el.editor.state.selection.from,to:el.editor.state.selection.to})),selection);
 assert.equal(requests.filter(r=>r.method==='PUT'&&r.key.startsWith('/workspace/documents/')).length,beforeViewChanges,'layout is not an autosave mutation');
 const beforeFocus=await metrics(),scroll=await canvas.evaluate(el=>el.closest('.uw-editor-paper-scroll').scrollTop);
 await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();await settle();
 const focused=await metrics();assert.ok(Math.abs(focused.text.width-beforeFocus.text.width)<1,'focus text measure stable');
 assert.equal(await canvas.evaluate(el=>el.closest('.uw-editor-paper-scroll').scrollTop),scroll,'focus scroll preserved');
 assert.deepEqual(await content(),original);assert.equal(focused.viewRetained,true);
 await page.screenshot({path:path.join(out,'focus-1920.png')});
 await page.getByRole('button',{name:'Exit focus mode',exact:true}).click();await settle();
 await canvas.evaluate(el=>{el.editor.commands.setTextSelection(el.editor.state.doc.content.size-1);el.focus()});
 await page.keyboard.type(' A new thought.');await saved();const written=await content();
 await choose('standard');await page.getByRole('button',{name:'Undo (Ctrl/⌘ Z)',exact:true}).click();await saved();assert.deepEqual(await content(),original,'width change does not consume undo');
 await page.getByRole('button',{name:'Redo (Ctrl/⌘ Shift Z)',exact:true}).click();await saved();assert.deepEqual(await content(),written,'redo still restores writing');
 await choose('wide');const persistedCredits=credits();await page.reload();await waitProject(page,'');await canvas.waitFor();await saved();await settle();
 assert.equal(await page.locator('.uw-editor').getAttribute('data-page-width'),'wide','preference restored');
 await page.locator('.uw-editor-session-controls[data-session-state="active"]').waitFor();
 assert.deepEqual(await content(),written,'document formatting and image attributes restored');assert.deepEqual(credits(),persistedCredits,'session credit restored');
 const endedSaved=page.waitForResponse(response=>response.url().endsWith('/api/workspace/activity') && response.request().method()==='PUT' && response.request().postDataJSON()?.timer?.status==='ended' && response.ok());
 await page.getByRole('button',{name:'End Session',exact:true}).click();await endedSaved;await saved();
 const completedSessions=structuredClone([...activity.values()]);
 assert.ok(completedSessions.every(row=>row.timer.status==='ended'));
 // English/Spanish labels, dark presentation, keyboard menu dismissal.
 await page.setViewportSize({width:1920,height:1280});await choose('comfortable');await page.locator('.uw-editor-paper-scroll').evaluate(el=>el.scrollTop=0);await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:path.join(out,'desktop-preview.png')});
 await page.getByRole('button',{name:'Dark theme',exact:true}).click();await choose('comfortable');await page.screenshot({path:path.join(out,'dark-1920.png')});
 await page.getByLabel('Language',{exact:true}).selectOption('es');await page.getByLabel('Vista',{exact:true}).click();await page.getByLabel('Ancho de página',{exact:true}).selectOption('standard');await page.keyboard.press('Escape');
 assert.equal(await page.locator('.uw-editor-view').getAttribute('open'),null);
 // Portrait and intrinsically small images use their natural ratio without upscaling.
 for(const [width,height] of [[600,1200],[96,96]]){
  await canvas.evaluate((el,{width,height})=>{
   const picture=document.createElement('canvas');picture.width=width;picture.height=height;
   const c=picture.getContext('2d');c.fillStyle='#5d8799';c.fillRect(0,0,width,height);
   let position;el.editor.state.doc.descendants((node,pos)=>{if(node.type.name==='image')position=pos});
   el.editor.view.dispatch(el.editor.state.tr.setNodeMarkup(position,undefined,{src:picture.toDataURL('image/png'),width,height,alt:'Synthetic aspect-ratio test',title:null}));
  },{width,height});
  await canvas.locator('img').evaluate(img=>img.decode());
  const m=await metrics();assert.ok(Math.abs(m.image.width/m.image.height-width/height)<0.01);
  if(width===96)assert.equal(m.image.width,96,'small image never upscaled');
 }
 await saved();
 // Storage failures do not disable the layout controls or alter writing.
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('uno-editor-page-width:'))throw new DOMException('Storage disabled','QuotaExceededError');return original.call(this,key,value)};});
 await page.getByLabel('Vista',{exact:true}).click();await page.getByLabel('Ancho de página',{exact:true}).selectOption('wide');await page.keyboard.press('Escape');
 assert.equal(await page.locator('.uw-editor').getAttribute('data-page-width'),'wide');
 assert.deepEqual([...activity.values()],completedSessions,'completed session records remain unchanged');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({scope:'Actual production Tiptap UI and IndexedDB with isolated API fixtures. No live Supabase or private writing.',measurements,checks:['28 responsive layout combinations','Image bounds/aspect/centering','Stable JSON/view/selection','No view-only autosave or session word mutations','Focus text width and scroll','Undo/redo after view changes','Reload preserves layout, JSON and credit','Dark mode, Spanish labels, Escape dismissal','Portrait/small images retain ratio and size','Layout usable with browser storage unavailable','Completed session records unchanged',...(process.env.AXE_SCRIPT?['axe WCAG 2/2.1 AA audit with open View menu at 4 widths']:[])]},null,2));
 console.log('PASS editor canvas: 28 viewport/layout combinations, focus, history, autosave/reopen and presentation persistence.');
};
