/** Actual production Tiptap editor with isolated, non-sensitive persistence APIs.
 * Optional FOCUS_HEADED=1 FOCUS_PAUSE=1 opens a reproducible interactive demo.
 * No real accounts, AI providers, payments or private writing are used. */
const {spawn}=require('node:child_process');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start({dist:process.env.FOCUS_TEST_DIST});
 try{
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['tests/writing-workspace.browser.cjs'],{stdio:'inherit',env:{...process.env,WRITING_TEST_ORIGIN:server.origin,FOCUS_MODE_ONLY:'1'}});
   child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Focus editor checks exited '+code)));
  });
 }finally{await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
