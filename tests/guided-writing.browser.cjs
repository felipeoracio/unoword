/** Built editor with isolated persistence and AI boundaries; no customer or paid calls. */
const {spawn}=require('node:child_process');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start();
 try{await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['tests/writing-workspace.browser.cjs'],{stdio:'inherit',env:{...process.env,WRITING_TEST_ORIGIN:server.origin,GUIDED_SESSION_ONLY:'1'}});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Guided writing exited '+code)));
 });}finally{await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
