/** Isolated auth-provider UI regression runner. No live sign-ins or email. */
const {spawn}=require('node:child_process');
(async()=>{const server=await require('./helpers/production-fixture-server.cjs').start();try{
 for(const [file,key] of [['tests/google-oauth.browser.cjs','GOOGLE_TEST_ORIGIN'],['tests/email-signup.browser.cjs','SIGNUP_TEST_ORIGIN']]){
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[file],{stdio:'inherit',env:{...process.env,[key]:server.origin}});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(file+' exited '+code)))});
 }
}finally{await server.close()}})().catch(error=>{console.error(error);process.exitCode=1});
