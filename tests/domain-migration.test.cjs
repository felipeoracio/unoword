const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {redirectFor,config}=require('./helpers/domain-hosting.cjs');
for(const host of ['unoword.vercel.app','www.unoword.app']){
 test(host+' uses one exact 301 for browser paths, queries and encoded parameters',()=>{
  for(const path of ['/','/editor','/editor/','/account?mode=signup&next=%2Feditor','/account/security?type=recovery&token_hash=fixture','/privacy','/terms','/support','/rewards','/admin/login','/admin','/unknown-page','/editor?project=123&tag=one&tag=two&q=%E2%9C%93']){
   const result=redirectFor('https://'+host+path);
   assert.deepEqual(result,{status:301,location:'https://unoword.app'+path});
   assert.equal(redirectFor(result.location),null,'canonical response never loops');
  }
 });
 test(host+' preserves signed POST APIs, old clients, cached assets and recovery',()=>{
  for(const path of ['/api','/api/','/api/subscription/webhook','/api/webhooks/substack-stripe','/api/auth/google/callback?flow=fixture&code=fixture','/api/auth/login','/api/workspace/documents','/assets/editor.js','/writing-sw.js','/editor?domain_recovery=1','/account?next=%2Feditor&domain_recovery=1','/?code=one-use-fixture'])assert.equal(redirectFor('https://'+host+path),null,path);
  assert.equal(redirectFor('https://'+host+'/editor?domain_recovery=0').status,301);
  assert.equal(redirectFor('https://'+host+'/support?domain_recovery=1').status,301,'recovery flag does not bypass unrelated page redirects');
 });
}
test('primary and unrelated preview hosts do not match legacy redirects',()=>{
 for(const host of ['unoword.app','unoword-git-domain-example.vercel.app','unoword.vercel.app.evil.example'])assert.equal(redirectFor('https://'+host+'/editor'),null);
 assert.equal(config.services.backend.entrypoint,'server.py');
});
test('retired lifetime URLs redirect to pricing, with one hop from legacy hosts',()=>{
 for(const host of ['unoword.vercel.app','www.unoword.app','unoword.app','preview-example.vercel.app']){
  for(const path of ['/lifetime','/lifetime/','/lifetime/index.html']){
   const target=['unoword.vercel.app','www.unoword.app'].includes(host)?'https://unoword.app/':'/';
   assert.deepEqual(redirectFor('https://'+host+path+'?source=newsletter'),{status:301,location:target+'?source=newsletter#pricing'});
  }
 }
 assert.equal(redirectFor('https://unoword.app/lifetime-other'),null);
});
test('built SEO and downloadable extension refer to the canonical app',()=>{
 const html=fs.readFileSync('frontend/dist/index.html','utf8');
 assert.ok(html.includes('<link rel="canonical" href="https://unoword.app/"'));
 assert.ok(html.includes('content="https://unoword.app/brand/social-card.png"'));
 const sitemap=fs.readFileSync('frontend/dist/sitemap.xml','utf8');
 assert.equal((sitemap.match(/<loc>/g)||[]).length,3);assert.ok(!sitemap.includes('vercel.app')&&!sitemap.includes('/editor')&&!sitemap.includes('/lifetime'));
 assert.ok(!fs.existsSync('frontend/dist/lifetime/index.html'));
 for(const page of ['privacy','support'])assert.ok(fs.readFileSync('frontend/dist/'+page+'/index.html','utf8').includes('href="https://unoword.app/'+page+'"'));
 assert.ok(fs.readFileSync('frontend/dist/robots.txt','utf8').includes('Sitemap: https://unoword.app/sitemap.xml'));
 const manifest=JSON.parse(fs.readFileSync('extension/manifest.json'));
 assert.match(manifest.version,/^\d+\.\d+\.\d+$/);assert.ok(manifest.host_permissions.includes('https://unoword.app/*'));
 assert.ok(manifest.host_permissions.includes('https://unoword.vercel.app/*'));
 const release=JSON.parse(fs.readFileSync('frontend/public/downloads/release.json'));
 assert.equal(release.version,manifest.version);
 assert.equal(release.sha256,crypto.createHash('sha256').update(fs.readFileSync('frontend/public/downloads/unoword-extension.zip')).digest('hex'));
});
