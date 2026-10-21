/** Exercises the built callback page without real credentials or email. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'../../tests/node_modules/playwright');
const dist=path.resolve(__dirname,'../dist');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:320,height:650}});
  const requests=[],errors=[];const used=new Set();page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://callback.test/**',async r=>{
   const route=new URL(r.request().url()).pathname;
   const file=route.startsWith('/assets/')?path.join(dist,route):path.join(dist,'index.html');
   await r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html'});
  });
  await page.route('https://callback.test/api/auth/**',async r=>{
   const body=r.request().postDataJSON();requests.push({url:r.request().url(),body});
   const already=used.has(body.token_hash);used.add(body.token_hash);
   await r.fulfill({status:already?400:200,contentType:'application/json',body:JSON.stringify(already?{detail:'verification_expired'}:{status:'ok',other_sessions_revoked:true})});
  });
  await page.goto('https://callback.test/account/security?token_hash=fixture-recovery&type=recovery');
  await page.getByRole('button',{name:'Update password',exact:true}).waitFor();
  assert.equal(new URL(page.url()).search,'','Token removed before interaction');
  assert.equal(requests.length,0,'Opening a recovery link does not consume it');
  assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'),'no-referrer');
  await page.getByLabel('New password',{exact:true}).fill('fixture-new-password');
  await page.getByLabel('Confirm new password',{exact:true}).fill('mismatched-password');
  await page.getByRole('button',{name:'Update password',exact:true}).click();
  assert.equal(requests.length,0,'Mismatching password never consumes token');
  await page.getByLabel('Confirm new password',{exact:true}).fill('fixture-new-password');
  await page.getByRole('button',{name:'Update password',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Password updated'}).waitFor();
  assert.equal(requests[0].body.token_hash,'fixture-recovery');
  assert.ok(requests.every(r=>!r.url.includes('fixture-recovery')&&!r.url.includes('password')));
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  await page.goto('https://callback.test/account/security?token_hash=fixture-recovery&type=recovery');
  await page.getByLabel('New password',{exact:true}).fill('fixture-new-password');await page.getByLabel('Confirm new password',{exact:true}).fill('fixture-new-password');
  await page.getByRole('button',{name:'Update password',exact:true}).click();
  await page.getByRole('status').filter({hasText:'expired or already used'}).waitFor();
  await page.goto('https://callback.test/account/security?token_hash=fixture-email&type=email_change');
  await page.getByRole('button',{name:'Verify email',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Check both'}).waitFor();
  assert.equal(requests.at(-1).body.type,'email_change');
  await page.goto('https://callback.test/account/security#access_token=never-import-this&refresh_token=never-persist-this&type=recovery');
  await page.getByText('This link uses an unsupported format.',{exact:false}).waitFor();
  assert.equal(new URL(page.url()).hash,'');
  await page.getByRole('button',{name:'Español'}).click();
  await page.getByRole('heading',{name:'Cuenta y seguridad'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS: built recovery/email callbacks; token query removal; no premature consumption; mismatch validation; success; replay error; POST-only secrets; no browser storage; unsupported fragment safely removed; EN/ES; 320px.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
