/** Local fixture uses Vercel's route compiler; it is not a deployed-edge probe. */
const {getTransformedRoutes}=require('../../frontend/node_modules/@vercel/routing-utils');
const config=require('../../vercel.json');
const transformed=getTransformedRoutes({redirects:config.redirects});
if(transformed.error)throw Error(JSON.stringify(transformed.error));
function redirectFor(input){
 const url=new URL(input);
 const matches=condition=>condition.type==='host'?url.hostname===condition.value:
  condition.type==='query'&&(condition.value===undefined?url.searchParams.has(condition.key):url.searchParams.get(condition.key)===condition.value);
 for(const rule of transformed.routes){
  const capture=new RegExp(rule.src).exec(url.pathname);
  if(!capture||!(rule.has||[]).every(matches)||(rule.missing||[]).some(matches))continue;
  let location=rule.headers.Location.replace(/\$(\d+)/g,(_,index)=>capture[Number(index)]||'');
  if(url.search){
   const hash=location.indexOf('#'),fragment=hash<0?'':location.slice(hash);
   location=hash<0?location:location.slice(0,hash);
   location+=(location.includes('?')?'&':'?')+url.search.slice(1)+fragment;
  }
  return {status:rule.status,location};
 }
 return null;
}
module.exports={redirectFor,config};
