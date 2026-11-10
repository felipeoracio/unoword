import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProjectState,applyProjectOperation,inProject,recoverProjectCaches,validateProject,type ProjectOperation} from '../../../shared/projects';
const owner='account-a';
const operation=(type:ProjectOperation['type'],body:Record<string,unknown>,extra:Partial<ProjectOperation>={}):ProjectOperation=>({id:'operation',method:'PUT',path:'/workspace/projects',type,body,created_at:'2026-11-09T12:00:00Z',...extra});
test('project selection never changes document memberships or creates writing activity',()=>{
 const original=emptyProjectState(owner);original.associations=[{user_id:owner,project_id:'memoir',resource_kind:'document',resource_id:'draft'}];
 const next=applyProjectOperation(original,operation('selection',{project_id:'novel',revision:0,last_documents:{memoir:'draft'}}));
 assert.equal(next.preferences.active_project_id,'novel');assert.deepEqual(next.associations,original.associations);assert.ok(inProject(next,'document','draft','memoir'));assert.ok(!inProject(next,'document','draft','novel'));assert.equal(original.preferences.active_project_id,null);
});
test('shared resource assignments are idempotent and never duplicate a file',()=>{
 const op=operation('resource',{project_ids:['memoir','novel'],revision:0,mutation_id:'stable'}, {resource:{kind:'source',id:'reference'}});
 const state=applyProjectOperation(applyProjectOperation(emptyProjectState(owner),op),op);
 assert.equal(state.associations.length,2);assert.equal(state.resource_versions.length,1);assert.equal(state.resource_versions[0].revision,1);assert.ok(!('files' in state));
});
test('deleting a project keeps other memberships and leaves unassigned writing in General',()=>{
 let state=emptyProjectState(owner);state=applyProjectOperation(state,operation('resource',{project_ids:['memoir','novel'],revision:0},{resource:{kind:'document',id:'shared'}}));state=applyProjectOperation(state,operation('resource',{project_ids:['memoir'],revision:0},{resource:{kind:'document',id:'private'}}));
 const next=applyProjectOperation(state,operation('delete',{}, {project_id:'memoir'}));assert.ok(inProject(next,'document','shared','novel'));assert.ok(!inProject(next,'document','shared',null));assert.ok(inProject(next,'document','private',null));assert.equal(state.associations.length,3);
});
test('profile answer queue does not modify legacy profile or activity',()=>{
 const state=emptyProjectState(owner);const next=applyProjectOperation(state,operation('profile',{custom_answer:'My voice',notes:'Retain my details'}, {question_id:'style'}));assert.deepEqual(next.projects,[]);assert.deepEqual(next.associations,[]);assert.deepEqual(next.preferences,state.preferences);
});

test('recovery merges independent tab outboxes without copying other accounts or discarding conflicts',()=>{
 const first=emptyProjectState(owner),second={...emptyProjectState(owner),updated_at:'2026-11-10T00:00:00Z'};
 const a=operation('selection',{project_id:'memoir',revision:0},{id:'one'}),b=operation('selection',{project_id:'novel',revision:0},{id:'two'});
 const recovered=recoverProjectCaches(owner,[{server:first,pending:[a]},{server:second,pending:[a,b]},{server:emptyProjectState('another-account'),pending:[operation('delete',{}, {id:'foreign'})]}]);
 assert.deepEqual(recovered.pending.map(row=>row.id),['one','two']);assert.equal(recovered.server,second);assert.equal(recovered.pending[1].body.revision,0,'Conflicting revisions are preserved for explicit resolution');
});

test('invalid project goals and dates cannot poison the offline outbox',()=>{
 assert.throws(()=>validateProject({name:'Memoir',goals:{daily_words:-10}}),/whole numbers/);
 assert.throws(()=>validateProject({name:'Memoir',goals:{daily_words:NaN}}),/whole numbers/);
 assert.throws(()=>validateProject({name:'Memoir',target_date:'2026-02-31'}),/valid target date/);
 assert.throws(()=>validateProject({name:'  '}),/project name/);
 assert.doesNotThrow(()=>validateProject({name:'Memoir',goals:{daily_words:250},target_date:'2026-12-01'}));
});
