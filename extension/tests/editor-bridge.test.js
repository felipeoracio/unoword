const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
test('Editor content bridge sends metadata requests only, validates origin and skips normal typing listeners',()=>{
 const listeners={},sent=[],posted=[];
 const window={addEventListener:(event,listener)=>listeners[event]=listener,postMessage:(message,origin)=>posted.push({message,origin})};
 const location={origin:'https://unoword.vercel.app',pathname:'/editor'};
 const chrome={runtime:{sendMessage:(message,callback)=>{sent.push(message);callback?.({ok:true,ownerId:'writer',sessions:[]})}},storage:{onChanged:{addListener(){}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../content.js'),'utf8'),{window,location,chrome});
 assert.deepEqual(Object.keys(listeners),['message']);
 listeners.message({source:window,origin:location.origin,data:{type:'UNO_WORD_REQUEST_LOCAL_PROGRESS'}});
 assert.equal(sent.at(-1).type,'GET_LOCAL_WRITING_PROGRESS');assert.equal(posted.at(-1).message.type,'UNO_WORD_LOCAL_PROGRESS');
 listeners.message({source:window,origin:'https://attacker.example',data:{type:'UNO_WORD_ACTIVITY_SAVED'}});assert.equal(sent.length,1);
 listeners.message({source:{},origin:location.origin,data:{type:'UNO_WORD_ACTIVITY_SAVED'}});assert.equal(sent.length,1);
 listeners.message({source:window,origin:location.origin,data:{type:'UNO_WORD_ACTIVITY_SAVED',typedWords:999999}});
 assert.equal(sent.at(-1).type,'SYNC_EDITOR_ACTIVITY');assert.equal(sent.at(-1).typedWords,undefined,'Counts come from the server, not page messages');
});
