/** Phase 1: synthetic accounts only; no production auth, AI, database or billing. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || './node_modules/playwright');
const origin = process.env.WRITING_TEST_ORIGIN || 'http://localhost:4175';
const owner = '00000000-0000-4000-8000-000000000001';
const now = () => new Date().toISOString();
const artifact = path.join(__dirname, 'artifacts', 'studio');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async fn => { for (let i=0;i<100;i++) { if (fn()) return; await sleep(100); } throw Error('Fixture persistence timed out'); };
(async () => {
  fs.mkdirSync(artifact, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(12000);
    await context.addInitScript(() => { localStorage.setItem('uno-writing-theme', 'light'); localStorage.setItem('uno-writing-language', 'en'); });
    const doc = { id:'00000000-0000-4000-8000-000000000003', user_id:owner, title:'A quiet place to begin', content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'My own words, safely preserved.'}]}]}, plain_text:'My own words, safely preserved.', folder_id:null, favorite:false, status:'active', completion_status:'draft', ai_allowed:false, revision:1, mutation_id:crypto.randomUUID(), created_at:now(), updated_at:now() };
    let signedIn=false, pro=true, failSave=false, offline=false, aiCalls=0;
    const activity=new Map(), requests=[], errors=[];
    const projects=require('./helpers/project-fixture.cjs').projectsFixture(()=>owner,()=>[doc]);
    await context.route(origin+'/api/**', async route => {
      const req=route.request(), url=new URL(req.url()), key=url.pathname.replace('/api',''), method=req.method();
      const body=req.postData()?JSON.parse(req.postData()):null;
      requests.push({key,method});
      if(offline) return route.abort('internetdisconnected');
      let status=200, value={};
      if(key==='/product') value={name:'UnoWord',billing_available:false,chrome_store_url:null,plans:[],features:[]};
      else if(!signedIn){status=401;value={detail:'Authentication required'};}
      else if(key==='/auth/me') value={id:owner,email:'writer@example.com',ai_access:pro,plan:pro?'pro':'free'};
      else if(key==='/auth/refresh') value={authenticated:true};
      else if(key.startsWith('/workspace/projects')){const r=projects(key,method,body);status=r.status;value=r.value;}
      else if(key==='/workspace/config') value={daily_goal:250,max_document_chars:200000,max_upload_bytes:5242880,ai_batch_size:3};
      else if(key==='/workspace/documents') value=[doc];
      else if(key==='/workspace/documents/'+doc.id){
        if(method==='GET')value=doc;
        else if(failSave){status=503;value={detail:'workspace_storage_unavailable'};}
        else{assert.equal(body.expected_user_id,owner);Object.assign(doc,body,{revision:doc.revision+1,updated_at:now()});doc.plain_text=JSON.stringify(doc.content);value=doc;}
      }
      else if(key==='/workspace/activity'&&method==='GET')value=[...activity.values()];
      else if(key==='/workspace/activity'){assert.equal(body.expected_user_id,owner);activity.set(body.id,body);value=body;}
      else if(key==='/workspace/folders'||key==='/workspace/sources'||key==='/ai/onboarding')value=[];
      else if(key==='/progress/preferences')value={user_id:owner,revision:1,daily_goal:250,timezone:'America/Chicago',language:'en',themes:['ideas']};
      else if(key==='/progress/summary')value={user_id:owner,reportingDate:now().slice(0,10),timezone:'America/Chicago',dailyWordCount:12,dailyActiveWritingSeconds:120,lifetimeActiveWritingSeconds:600,dailyGoal:250,displayedStreak:pro?15:7,sessions:[],updatedAt:now()};
      else if(key==='/progress/streak')value={user_id:owner,displayedStreak:pro?15:7,hasUnlimitedStreakAccess:pro,streakLimitReached:!pro,journeyContinues:!pro,timezone:'America/Chicago',asOf:now()};
      else if(key==='/ai/profile')value={id:'profile',user_id:owner,writing_goal:'Reflective writing',primary_topics:[],favorite_subjects:[],current_projects:[],avoid_topics:[],ai_preferences:{}};
      else if(key==='/ai/usage/summary')value={user_id:owner,legacy_shared:false,timezone:'America/Chicago',daily_reset_at:new Date(Date.now()+86400000).toISOString(),monthly_reset_at:new Date(Date.now()+2592000000).toISOString(),daily_limit:10,used_today:0,remaining:10,suggestions_monthly_limit:200,suggestions_monthly_used:0,suggestions_monthly_remaining:200,guidance_monthly_limit:30,guidance_monthly_used:0,guidance_monthly_remaining:30};
      else if(key==='/onboarding')value={version:1,status:'completed',current_step:'done',completed_actions:{},skipped_steps:[],draft_id:null,words:0};
      else if(key==='/subscription')value={user_id:owner,billing_available:false,managed_by_stripe:false,trial_eligible:true,status:'inactive'};
      else if(key==='/subscription/substack')value={user_id:owner,configured:false,available:false,connected:false,subscriptions:[]};
      else if(key==='/rewards'){status=503;value={detail:'rewards_setup_required'};}
      else if(key==='/workspace/assistant'){aiCalls++;status=503;value={detail:'AI must not run in shell tests'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    });
    const page=await context.newPage();
    page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error:',error.message);});
    await page.goto(origin+'/editor');
    await page.getByRole('heading',{name:'Sign in to write'}).waitFor();
    assert.equal(await page.getByTestId('studio-shell').count(),0);
    signedIn=true;
    await page.reload();
    const canvas=page.getByRole('textbox',{name:'Document content',exact:true});
    await canvas.waitFor();
    const shell=page.getByTestId('studio-shell');
    await shell.waitFor();
    const artwork=await shell.evaluate(async element=>{
      const properties=['--studio-sidebar-art','--studio-header-art','--studio-header-art-mobile'];
      return Promise.all(properties.map(async property=>{
        const value=getComputedStyle(element).getPropertyValue(property);
        const url=value.match(/url\(["']?(.*?)["']?\)/)?.[1];
        if(!url)throw Error('Missing supplied artwork: '+property);
        const image=new Image();image.src=url;await image.decode();
        return {property,width:image.naturalWidth,height:image.naturalHeight};
      }));
    });
    assert.deepEqual(artwork.map(image=>[image.width,image.height]),[[600,1600],[2048,768],[1080,1440]],'All three supplied Phase 1 assets decode');
    for(const width of [320,390,768,1024,1440]){
      await page.setViewportSize({width,height:1000});
      await sleep(100);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal page overflow at '+width);
      assert.equal(await page.locator('.uw-studio-sidebar').isVisible(),width>=900);
      assert.equal(await canvas.isVisible(),true);
      if(width<900){
        const trigger=page.getByRole('button',{name:'Open navigation',exact:true});
        await trigger.click();
        const drawer=page.getByRole('dialog',{name:'Navigation',exact:true});
        await drawer.waitFor();
        if(width===390)await page.screenshot({path:path.join(artifact,'navigation-390-artwork.png')});
        assert.equal(await trigger.getAttribute('aria-expanded'),'true');
        await page.getByRole('button',{name:'Close navigation',exact:true}).focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(()=>document.querySelector('.uw-studio-drawer').contains(document.activeElement)),true,'Native dialog traps focus');
        await page.keyboard.press('Escape');
        await drawer.waitFor({state:'hidden'});
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Escape restores trigger focus');
      }
      if([390,1440].includes(width)) await page.screenshot({path:path.join(artifact,`editor-${width}-light.png`)});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Ideas',exact:true}).click();
    await page.locator('.uw-editor-assistant').waitFor();
    assert.equal(aiCalls,0,'Opening assistance never generates AI');
    await page.getByRole('button',{name:'Enter focus mode',exact:true}).click();
    assert.equal(await page.locator('.uw-studio-sidebar').isVisible(),false);
    await page.getByRole('button',{name:'Exit focus mode',exact:true}).click();
    // New shell navigation must flush writing before unmounting the editor.
    await canvas.fill('A fresh thought saved before changing screens.');
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Library',exact:true}).click();
    await page.waitForURL('**/projects');
    assert.match(JSON.stringify(doc.content),/fresh thought/);
    await page.getByRole('heading',{name:'Library & projects',exact:true}).waitFor();
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:1000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Library no overflow '+width);
      const background=await page.locator('.uw-studio-page-header').evaluate(element=>getComputedStyle(element).backgroundImage);
      assert.ok(background.includes(width<900?'landscape-mobile':'landscape-master'),'Responsive header uses the supplied crop at '+width);
      if([390,1440].includes(width))await page.screenshot({path:path.join(artifact,`library-${width}-light.png`),fullPage:true});
    }
    await page.getByRole('button',{name:'Use dark theme',exact:true}).click();
    assert.equal(await shell.getAttribute('data-studio-theme'),'dark');
    assert.equal((await page.locator('.uw-studio-page-header').evaluate(element=>getComputedStyle(element).backgroundImage)).includes('landscape-'),false,'Dark headers retain a quiet surface');
    await page.screenshot({path:path.join(artifact,'library-1440-dark.png'),fullPage:true});
    await page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('es');
    await page.getByRole('heading',{name:'Biblioteca y proyectos',exact:true}).waitFor();
    assert.equal(await shell.getAttribute('lang'),'es');
    await page.getByRole('combobox',{name:'Idioma de la interfaz',exact:true}).selectOption('en');
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Progress',exact:true}).click();
    await page.locator('#writing-progress').waitFor();
    await page.waitForFunction(()=>document.activeElement?.id==='writing-progress');
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Settings',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.id==='account-settings');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(artifact,'account-1440-dark.png')});
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Write',exact:true}).click();
    await canvas.waitFor();
    assert.match(await canvas.textContent(),/fresh thought/);
    // Reject a cloud save: navigation stays in the editor with the writing intact.
    failSave=true;
    await canvas.fill('Pending private writing must remain here when saving fails.');
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Home',exact:true}).click();
    await page.getByText('Your writing could not be saved safely.',{exact:false}).waitFor();
    assert.equal(new URL(page.url()).pathname,'/editor');
    assert.match(await canvas.textContent(),/Pending private writing/);
    failSave=false;
    await page.getByRole('button',{name:'Refresh / retry sync',exact:true}).click();
    await until(()=>JSON.stringify(doc.content).includes('Pending private writing'));
    // Previously available editor remains editable offline under the shell.
    offline=true;await context.setOffline(true);
    await canvas.fill('An offline thought kept on this device.');
    await page.waitForFunction(()=>document.querySelector('.uw-editor-save').textContent.includes('offline'));
    offline=false;await context.setOffline(false);
    await until(()=>JSON.stringify(doc.content).includes('offline thought'));
    // Free navigation uses supported tracking and Quick Prompt rather than paid creation.
    pro=false;await page.goto(origin+'/account');
    await shell.waitFor();
    assert.equal(await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Write',exact:true}).getAttribute('href'),'/account#install');
    await page.locator('.uw-studio-sidebar').getByRole('link',{name:'Ideas',exact:true}).click();
    await page.getByRole('heading',{name:'Quick Prompt',exact:true}).waitFor();
    await page.goto(origin+'/editor');
    await page.getByRole('heading',{name:'Unlock Your Writing Space',exact:true}).waitFor();
    assert.equal(await page.getByTestId('studio-shell').count(),0);
    await page.goto(origin+'/');
    assert.equal(await page.getByTestId('studio-shell').count(),0,'Public marketing remains outside writer shell');
    assert.equal(aiCalls,0);
    assert.deepEqual(errors,[]);
    assert.equal(requests.some(r=>r.key.includes('checkout')||r.key.includes('/portal')),false);
    console.log('PASS studio shell: public/auth gates; 320–1440px layouts; native drawer keyboard/focus; existing navigation; focus mode; EN/ES; light/dark; save-before-navigation; failed-save protection; offline editing/reconnect; Free tracking/Quick Prompt and Pro editor restrictions; no AI/billing calls.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
