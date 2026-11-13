/** Existing image regression flow against the actual built editor. */
const {spawn}=require('node:child_process');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start();
 try{await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['tests/writing-workspace.browser.cjs'],{stdio:'inherit',env:{...process.env,WRITING_TEST_ORIGIN:server.origin,WRITING_IMAGES_ONLY:'1'}});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Legacy image checks exited '+code)));
 });}finally{await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
