const {randomUUID}=require('node:crypto');
exports.projectsFixture=(getOwner,getDocuments=()=>[])=>{
 const accounts=new Map();
 return function handle(key,method,body){
  if(!key.startsWith('/workspace/projects'))return null;
  const user_id=getOwner(),stamp=()=>new Date().toISOString();
  if(!accounts.has(user_id))accounts.set(user_id,{user_id,projects:[],associations:[],resource_versions:[],preferences:{user_id,active_project_id:null,last_documents:{},revision:0},updated_at:stamp()});
  const state=accounts.get(user_id);let value=state,status=200;
  const catalog=()=>getDocuments().filter(d=>d.user_id===user_id).map(d=>({resource_kind:'document',id:d.id,title:d.title,allowed:d.ai_allowed,state:d.status,updated_at:d.updated_at}));
  if(key.endsWith('/profile/questions'))value=[{id:'types',title:'What do you enjoy writing?',title_es:'¿Qué te gusta escribir?',multiple:true,options:[{id:'memoir',label:'Memoir',label_es:'Memorias'},{id:'fiction',label:'Fiction',label_es:'Ficción'}]}];
  else if(key.endsWith('/profile/answers'))value=state.answers||[];
  else if(key.includes('/profile/answers/')){state.answers=[{...body,question_id:key.split('/').pop(),revision:body.revision+1}];value=state.answers[0]}
  else if(key.endsWith('/resources'))value=catalog();
  else if(key.endsWith('/preview')){const row=catalog().find(d=>d.id===key.split('/').at(-2));value={title:row?.title||'Private reference',text:'Synthetic preview only'}}
  else if(key.endsWith('/statistics')){const id=key.split('/').at(-2);value={project_id:id,timezone:'UTC',reporting_date:stamp().slice(0,10),total_words:0,daily_words:0,weekly_words:0,document_count:state.associations.filter(a=>a.project_id===id&&a.resource_kind==='document').length,last_activity:null}}
  else if(key.endsWith('/active')){
   if(state.preferences.mutation_id===body.mutation_id)value=state.preferences;
   else if(state.preferences.revision!==body.revision){status=409;value={detail:'workspace_preference_conflict'}}
   else {state.preferences={...state.preferences,active_project_id:body.project_id,last_documents:{...state.preferences.last_documents,...body.last_documents},revision:body.revision+1,mutation_id:body.mutation_id};value=state.preferences}
  }else if(/\/resources\/[^/]+\/[^/]+$/.test(key)){
   const [kind,id]=key.split('/').slice(-2),prev=state.resource_versions.find(r=>r.resource_id===id&&r.resource_kind===kind);
   if(prev?.mutation_id===body.mutation_id)value=prev;
   else if((prev?.revision||0)!==body.revision){status=409;value={detail:'resource_revision_conflict'}}
   else {state.associations=state.associations.filter(a=>a.resource_id!==id||a.resource_kind!==kind);for(const project_id of body.project_ids)state.associations.push({user_id,project_id,resource_kind:kind,resource_id:id});state.resource_versions=state.resource_versions.filter(r=>r.resource_id!==id||r.resource_kind!==kind);value={user_id,resource_kind:kind,resource_id:id,revision:body.revision+1,mutation_id:body.mutation_id};state.resource_versions.push(value)}
  }else if(key.endsWith('/delete')){const id=key.split('/').at(-2);state.projects=state.projects.filter(p=>p.id!==id);state.associations=state.associations.filter(a=>a.project_id!==id);if(state.preferences.active_project_id===id)state.preferences.active_project_id=null;value={resources_preserved:true}}
  else if(method==='PUT'){
   const id=key.split('/').pop(),prev=state.projects.find(p=>p.id===id);
   if(prev?.mutation_id===body.mutation_id)value=prev;
   else if((prev?.revision||0)!==body.revision){status=409;value={detail:'project_revision_conflict'}}
   else {value={...body,id,user_id,created_at:prev?.created_at||stamp(),updated_at:stamp(),revision:body.revision+1};state.projects=[value,...state.projects.filter(p=>p.id!==id)]}
  }
  if(method!=='GET')state.updated_at=stamp();
  return {status,value:structuredClone(value),state};
 }
}
