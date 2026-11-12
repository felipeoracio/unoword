/** Production navigation with isolated accounts, catalog and writing persistence. */
const {spawn}=require('node:child_process');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start({dist:process.env.NAV_TEST_DIST});
 async function run(file,extra){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{stdio:'inherit',env:{...process.env,WRITING_TEST_ORIGIN:server.origin,...extra}});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(file+' exited '+code)));});}
 try{
  await run('tests/studio-library-settings.browser.cjs',{NAVIGATION_MOTION_ONLY:'1'});
  if(process.env.NAV_LAB_ONLY!=='1'&&process.env.NAV_SKIP_GUARD!=='1')await run('tests/writing-workspace.browser.cjs',{NAVIGATION_GUARD_ONLY:'1',NAV_GUARD_VIDEO:process.env.NAV_RECORD_VIDEO||'0'});
 }finally{await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
