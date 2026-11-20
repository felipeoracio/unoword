/** Built editor, isolated persistence, actual route contents and save protection. */
const {spawn}=require('node:child_process');
(async()=>{
 const server=await require('./helpers/production-fixture-server.cjs').start();
 try{
  for(const scenario of ['NAVIGATION_AUTOSAVE_ONLY','NAVIGATION_GUARD_ONLY']){
   await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['tests/writing-workspace.browser.cjs'],{
     stdio:'inherit',env:{...process.env,WRITING_TEST_ORIGIN:server.origin,[scenario]:'1'},
    });
    child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(Error(scenario+' exited '+code)));
   });
  }
 }finally{await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
