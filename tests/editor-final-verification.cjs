/** Editor 2.0 Phase 7: serial production-bundle verification, synthetic data only. */
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.EDITOR_FINAL_OUTPUT||path.join(root,'tests/artifacts/editor-final'));fs.mkdirSync(out,{recursive:true});
const jobs=[
 ['canvas','tests/editor-canvas.browser.cjs'],['formatting','tests/editor-formatting.browser.cjs'],
 ['media','tests/editor-media.browser.cjs'],['writing-tools','tests/editor-writing-tools.browser.cjs'],
 ['portability','tests/editor-portability.browser.cjs'],['interactions','tests/editor-interactions.browser.cjs'],
 ['focus','tests/focus-mode.browser.cjs'],['projects','tests/project-switching.browser.cjs'],
 ['feedback','tests/editor-polish.browser.cjs'],['workspace','tests/writing-workspace.browser.cjs'],
 ['session-completion','tests/writing-workspace.browser.cjs',{WRITING_SESSION_COMPLETION_ONLY:'1'}],
 ['typing-1x','tests/editor-polish.browser.cjs',{POLISH_LAB_ONLY:'1',POLISH_CPU_RATE:'1'}],
 ['typing-4x','tests/editor-polish.browser.cjs',{POLISH_LAB_ONLY:'1',POLISH_CPU_RATE:'4'}],
 ['typing-network-4x','tests/writing-workspace.browser.cjs',{WRITING_PERFORMANCE_ONLY:'1'}],
];
const requested=process.argv.slice(2);if(requested.some(name=>!jobs.some(j=>j[0]===name)))throw Error('Unknown suite');
const results=[],startedAt=new Date().toISOString();
const report=()=>fs.writeFileSync(path.join(out,requested.length?'report-'+requested.join('-')+'.json':'report.json'),JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),startedAt,updatedAt:new Date().toISOString(),scope:'Serial local production frontend with synthetic API/IndexedDB; no live account writes or paid AI calls. Chromium viewports, not physical devices.',axe:!!process.env.AXE_SCRIPT,results},null,2)+'\n');
(async()=>{let server;try{
 server=await require('./helpers/production-fixture-server.cjs').start();
 for(const [name,file,extra] of jobs.filter(j=>!requested.length||requested.includes(j[0]))){
  const start=Date.now(),log=path.join(out,name+'.log');console.log('START '+name);const stream=fs.createWriteStream(log);
  const result=await new Promise(resolve=>{
   const child=spawn(process.execPath,[file],{cwd:root,detached:true,env:{...process.env,WRITING_TEST_ORIGIN:server.origin,UNOWORD_RUN_LIVE_TESTS:'0',UNOWORD_RUN_KEY_SWAP_TEST:'0',...extra},stdio:['ignore','pipe','pipe']});
   let timedOut=false,error;child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
   const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGTERM')}catch{}},300000);
   child.on('error',e=>error=e.message);child.on('close',(code,signal)=>{clearTimeout(timer);stream.end(()=>resolve({name,status:code===0&&!timedOut&&!error?'passed':'failed',code,signal,timedOut,error,seconds:Math.round((Date.now()-start)/10)/100,log:path.relative(root,log)}))});
  });results.push(result);report();console.log(result.status.toUpperCase()+' '+name+' '+result.seconds+'s');
  if(result.status!=='passed')console.error(fs.readFileSync(log,'utf8').slice(-2500));
  if(name.startsWith('typing-')&&extra.POLISH_CPU_RATE){const source=path.join(root,'tests/artifacts/editor-polish/after-'+extra.POLISH_CPU_RATE+'x.json');if(result.status==='passed')fs.copyFileSync(source,path.join(out,name+'.json'));}
  if(name==='typing-network-4x'&&result.status==='passed')fs.copyFileSync(path.join(root,'tests/artifacts/phase8/performance.json'),path.join(out,'typing-network-4x.json'));
 }
 process.exitCode=results.some(r=>r.status!=='passed')?1:0;
}finally{if(server)await server.close()}})().catch(error=>{console.error(error);process.exitCode=1});
