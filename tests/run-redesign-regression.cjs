/** Phase 8 regression matrix. Uses local fixtures; never enables live QA accounts. */
const fs = require('node:fs');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, 'artifacts', 'phase8');
const selected = process.argv[2] || 'all';
const only = process.argv[3]?.split(',');
const reportName=selected+(only?'-'+only.join('-'):'');
const groups = ['foundation', 'web', 'editor', 'extension', 'mobile'];
if (selected !== 'all' && !groups.includes(selected)) throw Error('Choose all or '+groups.join(', '));
const origin = process.env.WRITING_TEST_ORIGIN || 'http://localhost:4175';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw Error('This matrix requires a local fixture server');
fs.mkdirSync(output, {recursive:true});
const env = {
  ...process.env, WRITING_TEST_ORIGIN:origin, LANDING_TEST_ORIGIN:origin,
  GOOGLE_TEST_ORIGIN:origin, SIGNUP_TEST_ORIGIN:origin, LIFETIME_TEST_ORIGIN:origin,
  AXE_PATH:process.env.AXE_SCRIPT || process.env.AXE_PATH || '',
  UNOWORD_RUN_LIVE_TESTS:'0', UNOWORD_RUN_KEY_SWAP_TEST:'0',
};
const jobs=[];
function job(group,name,command,args,cwd=root,extra={}) { jobs.push({group,name,command,args,cwd,env:{...env,...extra}}); }
function node(group,name,file,extra={}) { job(group,name,process.execPath,[file],root,extra); }
job('foundation','frontend-build','npm',['run','build'],path.join(root,'frontend'));
job('foundation','frontend-lint','npm',['run','lint'],path.join(root,'frontend'));
job('foundation','backend',process.env.PYTHON_EXECUTABLE||'python',['-m','pytest','tests','-q'],path.join(root,'backend'));
job('foundation','extension-unit',process.execPath,['--test',...fs.readdirSync(path.join(root,'extension/tests')).filter(f=>f.endsWith('.test.js')).sort().map(f=>'extension/tests/'+f)]);
node('foundation','extension-cloud-sync','extension/tests/cloud-sync.integration.cjs');
node('foundation','domain-contract','tests/domain-migration.test.cjs');
job('foundation','extension-release',process.env.PYTHON_EXECUTABLE||'python',['tests/check-extension-release.py']);
for(const file of fs.readdirSync(__dirname).filter(f=>f.endsWith('.sql.test.cjs')).sort())node('foundation',file.replace('.test.cjs',''),'tests/'+file);
for(const file of ['studio-shell','studio-home','studio-ideas','studio-progress','studio-library-settings','onboarding','email-signup','google-oauth','login-redirect','lifetime','substack','rewards','account-writing-sync','ai-management','analytics','domain-migration','landing'])node('web',file,'tests/'+file+'.browser.cjs',{AXE_MODULE:env.AXE_SCRIPT||'',LANDING_SCREENSHOTS:path.join(output,'landing')});
node('web','account-security','frontend/tests/account-security.browser.cjs');
node('web','account-billing','frontend/tests/marketing.browser.cjs',{ACCOUNT_SETTINGS_ONLY:'1',AXE_MODULE:env.AXE_SCRIPT||''});
for(const [name,flag] of [
  ['workspace',null],['projects','PROJECTS_ONLY'],['coach','WRITING_COACH_ONLY'],
  ['studio-editor','WRITING_STUDIO_ONLY'],['images','WRITING_IMAGES_ONLY'],
  ['subtitle-copy','WRITING_SUBTITLE_COPY_ONLY'],['session-completion','WRITING_SESSION_COMPLETION_ONLY'],
  ['performance','WRITING_PERFORMANCE_ONLY'],
])node('editor',name,'tests/writing-workspace.browser.cjs',{
  ...(flag?{[flag]:'1'}:{}),WRITING_SCREENSHOTS:path.join(output,'editor-'+name),
});
for(const file of ['dashboard','progress','profile-security','suggestion-modes','rewards'])node('extension','extension-'+file,'extension/tests/'+file+'.browser.cjs');
node('extension','extension-studio','extension/tests/progress.browser.cjs',{STUDIO_EXTENSION_ONLY:'1',STUDIO_EXTENSION_SCREENSHOTS:path.join(output,'extension')});
job('mobile','mobile-unit','npm',['test'],path.join(root,'apps/mobile'));
job('mobile','mobile-types','npm',['run','typecheck'],path.join(root,'apps/mobile'));
job('mobile','mobile-ios-export','npm',['run','export:ios','--','--max-workers','2'],path.join(root,'apps/mobile'),{CI:'1',EXPO_NO_TELEMETRY:'1',EXPO_OFFLINE:'1'});
job('mobile','mobile-screen-fixtures',process.execPath,['tests/native-ui.browser.cjs'],path.join(root,'apps/mobile'),{MOBILE_SCREENSHOTS:path.join(output,'mobile')});
if(only?.some(name=>!jobs.some(j=>j.name===name&&(selected==='all'||j.group===selected))))throw Error('Unknown job for the selected group');

const results=[];
const startedAt=new Date().toISOString();
const report=()=>fs.writeFileSync(path.join(output,'report-'+reportName+'.json'),JSON.stringify({
  commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),
  startedAt,updatedAt:new Date().toISOString(),
  browser:process.env.CHROMIUM_EXECUTABLE||'Playwright default',axe:!!env.AXE_SCRIPT,
  scope:'Isolated fixtures only. Native Chrome and physical iPad unverified.',results,
},null,2)+'\n');
async function run(task) {
  const log=path.join(output,task.name+'.log'),stream=fs.createWriteStream(log);
  const start=Date.now();console.log('START '+task.name);
  const result=await new Promise(resolve=>{
    const child=spawn(task.command,task.args,{cwd:task.cwd,env:task.env,stdio:['ignore','pipe','pipe']});
    let failure=null,timedOut=false;
    child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},600000);
    child.on('error',error=>{failure=error.message;});
    child.on('close',(code,signal)=>{clearTimeout(timer);stream.end(()=>resolve({name:task.name,group:task.group,status:code===0&&!failure&&!timedOut?'passed':'failed',code,signal,timedOut,error:failure,seconds:Math.round((Date.now()-start)/10)/100,log:path.relative(root,log)}));});
  });
  results.push(result);report();console.log(result.status.toUpperCase()+' '+task.name+' ('+result.seconds+'s)');
  if(result.status==='failed')console.error(fs.readFileSync(log,'utf8').slice(-3000));
}
(async()=>{
 let server;
 try {
  // Foundation build completes before browser groups consume its production bundle.
  for(const group of selected==='all'?groups:[selected]) {
    if(['web','editor'].includes(group)&&!process.env.WRITING_TEST_ORIGIN&&!server){
      server=await require('./helpers/production-fixture-server.cjs').start();
      for(const task of jobs)for(const name of ['WRITING_TEST_ORIGIN','LANDING_TEST_ORIGIN','GOOGLE_TEST_ORIGIN','SIGNUP_TEST_ORIGIN','LIFETIME_TEST_ORIGIN'])task.env[name]=server.origin;
      console.log('Serving production fixtures at '+server.origin);
    }
    const pending=jobs.filter(j=>j.group===group&&(!only||only.includes(j.name)));
    const worker=async()=>{for(let task;(task=pending.shift());)await run(task);};
    await Promise.all([worker(),worker()]);
  }
  const failed=results.filter(r=>r.status==='failed');
  console.log(`${results.length-failed.length}/${results.length} jobs passed. Report: ${path.relative(root,path.join(output,'report-'+reportName+'.json'))}`);
  process.exitCode=failed.length?1:0;
 } finally { if(server)await server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
