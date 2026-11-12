/** Actual public production UI and synthetic catalog; no live provider/account writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || './node_modules/playwright');
const out = path.resolve('tests/artifacts/marketing-motion');
const catalog = { name: 'UnoWord', billing_available: true, chrome_store_url: null,
  plans: [{id:'free', name:'Free', price:null, features:{quick_prompt:true,writing_goals:true}},
    {id:'pro', name:'Pro', price:{amount:2000,currency:'usd',interval:'month',trial_days:0},features:{writing_editor:true,editor_ai:true}}], features:[] };
exports.catalog = catalog;
exports.instrument = () => {
  window.__entrances = [];
  window.__observers = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const animation = animate.call(this, frames, options);
    if (this.closest('.lp-site')) window.__entrances.push({element:this,animation,frames,options});
    return animation;
  };
  const Original = window.IntersectionObserver;
  if (Original) window.IntersectionObserver = class extends Original {
    constructor(...args) { super(...args); window.__observers.push(this); this.disconnected=false; }
    disconnect() { this.disconnected=true; return super.disconnect(); }
  };
};
exports.routes = async (context, origin, calls) => context.route(origin+'/api/**', route => {
  const request=route.request(), endpoint=new URL(request.url()).pathname;
  calls.push({method:request.method(),endpoint});
  if (endpoint==='/api/product') return route.fulfill({json:catalog});
  if (endpoint==='/api/auth/google') return route.fulfill({json:{enabled:false}});
  if (endpoint==='/api/onboarding') return route.fulfill({json:{version:1,status:'completed',current_step:'summary',completed_actions:{},skipped_steps:[]}});
  assert.ok(['/api/auth/me','/api/auth/refresh'].includes(endpoint),'Unexpected private/paid request '+endpoint);
  return route.fulfill({status:401,json:{detail:'Authentication required'}});
});
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const server=await require('./helpers/production-fixture-server.cjs').start();
  const browser=await chromium.launch({headless:process.env.MARKETING_HEADED!=='1',executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const results=[], pass=name=>{results.push({name,result:'passed'});console.log('PASS '+name);};
  try {
    const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'no-preference',
      recordVideo:process.env.MARKETING_RECORD_VIDEO==='1'?{dir:path.join(out,'video'),size:{width:1440,height:1000}}:undefined});
    await context.addInitScript(exports.instrument);
    const calls=[],errors=[];await exports.routes(context,server.origin,calls);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(server.origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__entrances?.filter(row=>row.element.hasAttribute('data-motion-hero')).length===5);
    const hero=await page.evaluate(()=>window.__entrances.filter(row=>row.element.hasAttribute('data-motion-hero')).map(row=>({tag:row.element.tagName,delay:row.options.delay,duration:row.options.duration,from:row.frames[0].opacity,offset:row.frames[0].translate})));
    assert.deepEqual(hero.map(row=>row.delay),[0,40,40,80,120]);assert.ok(hero.every(row=>row.duration===420));assert.equal(hero[0].from,1);
    assert.ok(await page.locator('.lp-hero-preview').evaluate(el=>Math.abs(new DOMMatrix(getComputedStyle(el).transform).b)>0.03),'Entrance preserves existing screenshot rotation');
    assert.ok(await page.locator('h1').evaluate(el=>Number(getComputedStyle(el).opacity)>=0.96));
    await page.locator('.lp-hero-buttons a').first().focus();
    assert.ok(await page.locator('.lp-hero-buttons').evaluate(el=>el.getAnimations().every(a=>a.playState!=='running')));
    pass('Hero sequence uses shared timing; headline stays opaque and focused CTA settles immediately');

    const story=page.locator('.lp-feature-story').first();await story.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>window.__entrances.some(row=>row.element.id==='feature-0'));
    const once=await page.evaluate(()=>window.__entrances.filter(row=>row.element.id==='feature-0').length);
    await page.locator('.lp-final-cta').scrollIntoViewIfNeeded();await story.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>window.__entrances.filter(row=>row.element.id==='feature-0').length),once);
    const anchor=page.locator('.lp-feature-index a').first();await anchor.scrollIntoViewIfNeeded();await anchor.focus();
    const beforeCalls=calls.length;await page.keyboard.press('Enter');assert.equal(new URL(page.url()).hash,'#feature-0');
    assert.equal(calls.length,beforeCalls);
    pass('Scroll compositions reveal once; repeated scrolling and feature anchors neither replay nor request private data');

    const tabs=page.getByRole('tablist',{name:'Explore the writing studio'});await tabs.getByRole('tab',{name:'Home',exact:true}).focus();
    await page.keyboard.press('End');assert.equal(await tabs.getByRole('tab',{name:'Library',exact:true}).getAttribute('aria-selected'),'true');
    await page.keyboard.press('ArrowRight');assert.equal(await tabs.getByRole('tab',{name:'Home',exact:true}).getAttribute('tabindex'),'0');
    assert.equal(calls.length,beforeCalls);
    const faq=page.locator('.lp-faq details').first(), summary=faq.locator('summary');await summary.focus();
    await page.keyboard.press('Enter');assert.equal(await faq.evaluate(el=>el.open),true);await faq.locator('div').waitFor({state:'visible'});
    assert.equal(await faq.locator('div').evaluate(el=>getComputedStyle(el).animationDuration),'0.22s');
    await page.keyboard.press('Space');assert.equal(await faq.evaluate(el=>el.open),false);
    await page.keyboard.press('Enter');assert.equal(await faq.evaluate(el=>el.open),true);
    pass('Screenshot tabs retain keyboard selection; native FAQ opens/closes immediately during motion');

    async function audit(label) {
      if(!process.env.AXE_SCRIPT)throw Error('AXE_SCRIPT required for motion review');
      if(!await page.evaluate(()=>!!window.axe))await page.addScriptTag({path:process.env.AXE_SCRIPT});
      const violations=await page.evaluate(async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(row=>({id:row.id,nodes:row.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})));
      assert.deepEqual(violations,[],label);
    }
    for(const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:1000});await page.evaluate(()=>scrollTo(0,0));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow '+width);
      const cta=await page.locator('.lp-hero-buttons a').first().boundingBox();assert.ok(cta&&cta.y+cta.height<1000);
      await audit('Landing '+width);
      if(width===1440||width===390)await page.screenshot({path:path.join(out,'hero-'+width+'.png')});
      if(width<900) {
        const trigger=page.getByRole('button',{name:'Open navigation',exact:true});await trigger.tap();
        const nav=page.getByRole('navigation',{name:'Mobile navigation'});await nav.waitFor({state:'visible'});
        assert.equal(await nav.evaluate(el=>getComputedStyle(el).animationDuration),'0.18s');
        await nav.getByRole('link',{name:'Features',exact:true}).focus();await page.keyboard.press('Escape');await nav.waitFor({state:'hidden'});
        assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      }
    }
    await page.getByRole('button',{name:'Open navigation',exact:true}).tap();
    await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Pricing',exact:true}).tap();
    await page.waitForFunction(()=>document.querySelector('.lp-mobile-nav a[href="#pricing"]')?.getAttribute('aria-current')==='location');
    assert.equal(await page.locator('.lp-mobile-nav').isVisible(),false);
    await page.locator('.lp-pricing-grid').screenshot({path:path.join(out,'pricing-mobile.png')});
    pass('Five widths retain first-viewport CTA, no overflow, axe checks, touch menu, Escape/focus and actual anchor indication');

    await page.evaluate(()=>localStorage.setItem('uno-writing-theme','dark'));await page.reload();
    await page.waitForFunction(()=>document.querySelector('.lp-site')?.dataset.studioTheme==='dark');await audit('Dark');
    await summary.focus();await page.keyboard.press('Enter');await page.screenshot({path:path.join(out,'faq-mobile-dark.png')});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__entrances?.some(row=>row.animation.playState==='running'));
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.lp-site').evaluate(el=>el.getAnimations({subtree:true}).length),0);
    assert.ok(await page.evaluate(()=>window.__observers.every(observer=>observer.disconnected)));
    await page.reload();await page.getByRole('heading',{level:1}).waitFor();assert.equal(await page.evaluate(()=>window.__entrances.length),0);
    await page.getByRole('button',{name:'Open navigation',exact:true}).click();assert.equal(await page.locator('.lp-mobile-nav').evaluate(el=>el.getAnimations().length),0);
    pass('Dark surfaces remain accessible; reduced motion cancels running effects, disconnects observer and avoids new entrances');

    await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:1000});await page.goto(server.origin,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__entrances?.some(row=>row.element.classList.contains('lp-hero-buttons')&&row.animation.playState==='running'));
    // Trusted pointer events without Playwright waiting for decorative motion to finish.
    await page.locator('.lp-hero-buttons a').first().click({force:true});
    await page.getByRole('heading',{name:'Your next chapter starts here.'}).waitFor();assert.equal(new URL(page.url()).search,'?mode=signup');
    assert.ok(await page.evaluate(()=>window.__observers.every(observer=>observer.disconnected)));
    assert.ok(await page.evaluate(()=>window.__entrances.every(row=>row.animation.playState!=='running')));
    await page.goto(server.origin+'/#pricing');await page.locator('.lp-price-pro').getByRole('link',{name:'Explore Pro',exact:true}).click();
    await page.getByRole('heading',{name:'Welcome back to your words.'}).waitFor();assert.equal(new URL(page.url()).search,'?plan=pro');
    assert.equal(calls.some(call=>call.method!=='GET'&&!call.endpoint.startsWith('/api/auth/')),false);assert.deepEqual(errors,[]);
    pass('Signup/Pro destinations work during entrances; leaving cleans up animation/observer without AI, content or billing writes');

    const fallback=await browser.newContext({viewport:{width:390,height:1000}});await exports.routes(fallback,server.origin,[]);
    await fallback.addInitScript(()=>{window.IntersectionObserver=undefined;});const fallbackPage=await fallback.newPage();await fallbackPage.goto(server.origin);
    await fallbackPage.getByRole('heading',{level:1}).waitFor();assert.equal(await fallbackPage.locator('h1').evaluate(el=>getComputedStyle(el).opacity),'1');
    const hoverCard=fallbackPage.locator('.lp-feature-index a').first();await hoverCard.hover();
    await fallbackPage.waitForFunction(()=>getComputedStyle(document.querySelector('.lp-feature-index a')).translate==='0px -2px');
    await fallbackPage.emulateMedia({reducedMotion:'reduce'});assert.equal(await hoverCard.evaluate(el=>getComputedStyle(el).translate),'none');await fallback.close();
    const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:1000}});const plain=await noJS.newPage();await plain.goto(server.origin);
    await plain.getByRole('heading',{level:1}).waitFor();assert.equal(await plain.locator('.lp-hero-buttons a').first().getAttribute('href'),'/account?mode=signup');
    await plain.locator('.lp-faq summary').first().click();assert.equal(await plain.locator('.lp-faq details').first().evaluate(el=>el.open),true);await noJS.close();
    pass('Without IntersectionObserver or JavaScript, prerendered copy/CTA and native FAQ stay visible and functional');
    fs.writeFileSync(path.join(out,'functional.json'),JSON.stringify({scope:'Actual production public React UI with isolated synthetic catalog/auth responses. Not live providers, account creation or physical devices.',results,hero},null,2)+'\n');
    if(process.env.MARKETING_PAUSE==='1'){await page.goto(server.origin);await page.pause();}
    await context.close();
  } finally {await browser.close();await server.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
