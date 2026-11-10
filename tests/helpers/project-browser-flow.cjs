const assert=require('node:assert/strict'),fs=require('node:fs');
module.exports=async({page,context,origin,documents,requests,fixture,setSignedIn,setFailSave,setOffline,errors})=>{
 setSignedIn(true);await context.addInitScript(()=>localStorage.setItem('uno-tour-launch-hidden:00000000-0000-4000-8000-000000000001','1'));
 await page.goto(origin+'/editor');await page.getByLabel('Active project',{exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Active project"]').disabled);
 await page.getByRole('button',{name:'Start New Document',exact:true}).click();
 await page.getByLabel('Rename document',{exact:true}).fill('General journal');
 const canvas=page.getByRole('textbox',{name:'Document content'});await canvas.fill('A private general journal that belongs to no project.');
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 const general=[...documents.values()].find(d=>d.title==='General journal');assert.ok(general);
 await page.getByRole('button',{name:'Manage projects',exact:true}).click();
 let manager=page.locator('dialog[open] .uw-project-manager');
 await manager.getByRole('button',{name:'New Project',exact:true}).click();
 await manager.getByLabel('Project name',{exact:true}).fill('My Memoir');
 await manager.getByLabel('Description',{exact:true}).fill('A project for reflection and personal stories.');
 await manager.getByLabel('Daily words',{exact:true}).fill('250');
 await manager.getByLabel('Audience',{exact:true}).fill('My family');
 await manager.getByRole('button',{name:'Save project',exact:true}).click();
 await manager.getByRole('button',{name:'Open project',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Active project"]').selectedOptions[0].text==='My Memoir');
 assert.equal(await canvas.count(),0,'Switch does not move/reopen unrelated General document');
 await page.getByRole('button',{name:'Start New Document',exact:true}).click();await page.getByLabel('Rename document',{exact:true}).fill('Memoir chapter');await canvas.fill('A memory of a garden and the people who cared for it.');
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 await page.getByRole('button',{name:'Manage projects',exact:true}).click();manager=page.locator('dialog[open] .uw-project-manager');
 await manager.getByRole('button',{name:'New Project',exact:true}).click();await manager.getByLabel('Project name',{exact:true}).fill('My Novel');await manager.getByRole('button',{name:'Save project',exact:true}).click();
 await manager.locator('.uw-project-cards article').filter({hasText:'My Novel'}).getByRole('button',{name:'Open project',exact:true}).click();
 // Wait for the newly created project to finish switching before another action.
 await page.locator('dialog[open] .uw-project-manager').waitFor({state:'hidden'});
 const state=fixture('/workspace/projects','GET',null).state,novel=state.projects.find(p=>p.name==='My Novel'),memoir=state.projects.find(p=>p.name==='My Memoir');
 await page.waitForFunction(id=>document.querySelector('[aria-label="Active project"]').value===id&&!document.querySelector('[aria-label="Active project"]').disabled,novel.id);
 await page.getByRole('button',{name:'Manage projects',exact:true}).click();manager=page.locator('dialog[open] .uw-project-manager');
 await manager.getByRole('button',{name:'Resources',exact:true}).click();await manager.getByLabel('Assign existing resources',{exact:true}).check();
 const row=manager.locator('.uw-project-resource-row').filter({hasText:'Memoir chapter'});await row.getByLabel('In project',{exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.uw-project-resource-row')].find(row=>row.textContent.includes('Memoir chapter'))?.querySelector('input')?.checked);
 await page.getByRole('button',{name:'Close projects',exact:true}).click();
 const chapter=[...documents.values()].find(d=>d.title==='Memoir chapter');assert.ok(chapter);
 await page.waitForFunction(()=>document.querySelector('.uw-project-sync')?.textContent.includes('Projects synced'));
 assert.equal(documents.size,2,'Sharing a document never creates a second body');
 assert.deepEqual(new Set(state.associations.filter(a=>a.resource_id===chapter.id).map(a=>a.project_id)),new Set([novel.id,memoir.id]));
 // No Library is a server-recognized request scope; client also omits draft text.
 await page.getByLabel('Active project',{exact:true}).selectOption(memoir.id);
 await canvas.waitFor();await page.getByRole('button',{name:'Writing assistant',exact:true}).click();
 await page.getByLabel('AI Context',{exact:true}).selectOption('none');
 await page.getByLabel('Share this draft for this AI request.',{exact:true}).check();
 await page.getByRole('button',{name:'Generate',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.uw-editor-ai-results article').length>0).catch(()=>page.waitForTimeout(100));
 const call=requests.filter(r=>r.key==='/workspace/assistant').at(-1);assert.equal(call.body.context_scope,'none');assert.equal(call.body.current_text,'');assert.equal(call.body.project_id,memoir.id);
 await page.getByLabel('Active project',{exact:true}).selectOption(novel.id);
 await page.waitForFunction(()=>document.querySelector('[aria-label="AI Context"]').value==='current_project');
 // Offline switches and writes remain local until the server confirms them.
 setOffline(true);await context.setOffline(true);
 await page.getByLabel('Active project',{exact:true}).selectOption('');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Rename document"]')?.value==='General journal');assert.equal(await page.getByLabel('Rename document',{exact:true}).inputValue(),'General journal');
 await canvas.fill('A journal update safely stored while offline.');
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('offline'));
 await page.getByLabel('Active project',{exact:true}).selectOption(memoir.id);
 await page.waitForFunction(()=>document.querySelector('[aria-label="Rename document"]')?.value==='Memoir chapter');assert.equal(await page.getByLabel('Rename document',{exact:true}).inputValue(),'Memoir chapter');
 setOffline(false);await context.setOffline(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 await page.waitForFunction(()=>document.querySelector('.uw-project-sync')?.textContent.includes('Projects synced'));
 assert.equal(documents.get(general.id).plain_text.trim(),'A journal update safely stored while offline.');
 // A server save failure must leave the writer in the same project/document.
 setFailSave(true);await canvas.fill('Pending memoir words that must not be lost.');await page.getByLabel('Active project',{exact:true}).selectOption(novel.id);
 await page.getByRole('alert').filter({hasText:'Project was not switched'}).waitFor();
 assert.equal(await page.getByLabel('Active project',{exact:true}).inputValue(),memoir.id);assert.ok((await canvas.textContent()).includes('must not be lost'));
 setFailSave(false);await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.uw-editor-save')?.textContent.includes('All changes saved'));
 // Guided questions keep legacy free-text profile alongside optional custom answers.
 await page.locator('.uw-editor-library').getByRole('button',{name:'My Writing Profile',exact:true}).click();
 const profile=page.locator('dialog[open]');await profile.getByText('What do you enjoy writing?',{exact:true}).waitFor();await profile.getByLabel('Memoir',{exact:true}).check();await profile.getByLabel('Other / Write my own answer',{exact:true}).fill('Travel reflections');await profile.getByLabel('Additional notes (optional)',{exact:true}).fill('Keep my voice.');await profile.getByRole('button',{name:'Save & continue',exact:true}).click();await profile.getByRole('heading',{name:'Your Writing Profile is ready',exact:true}).waitFor();await profile.getByRole('button',{name:'Cancel',exact:true}).click();
 // Responsive real editor and projects dashboard, private/noindex.
 fs.mkdirSync('tests/artifacts',{recursive:true});
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(70);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal document scrolling at '+width);await page.screenshot({path:`tests/artifacts/projects-editor-${width}.png`,fullPage:true})}
 await page.goto(origin+'/projects');await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'noindex, nofollow');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'tests/artifacts/projects-dashboard-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'tests/artifacts/projects-dashboard-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS projects browser: independent project/context selectors; safe switch; shared membership without copying; scoped AI payload; reset override; offline switching and reconnect; save-failure preservation; guided custom answers; private Projects route; 320/390/768/1440px screenshots.');
};
