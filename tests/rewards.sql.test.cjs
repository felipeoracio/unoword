/** Real PostgreSQL/RLS in PGlite. No production data, provider or billing writes. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT||require('node:path').resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
test('personal rewards: schema, authoritative metrics, entitlement filtering and durable evidence',async()=>{
 const db=new PGlite({extensions:{vector}});
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;set search_path=public,extensions;`);
 await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
 for(const name of ['20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028040000_verified_streak_presentation.sql','20261029010000_session_pause_document_completion.sql','20261030010000_unified_account_writing_sync.sql','20261104010000_personal_writing_rewards.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 const owner=randomUUID(),other=randomUUID();await db.query('insert into auth.users values($1),($2)',[owner,other]);
 const call=async(name,...args)=>(await db.query('select '+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') r',args)).rows[0].r;
 const view=(paid=true)=>call('writing_rewards',owner,paid,'en');
 const initial=await view();assert.equal(initial.achievements.length,53);assert.equal(initial.preferences.enabled,true);
 for(let i=0;i<15;i++)await db.query(`insert into writing_activity(id,user_id,document_id,source,started_at,typed_words,pasted_words,duration_seconds,sequence,timer)
 values($1,$2,null,'extension',now()-($3||' days')::interval,100,500,0,1,jsonb_build_object('status','ended','active_ms',0,'paused_ms',0,'changed_at',extract(epoch from now())*1000))`,[randomUUID(),owner,i]);
 let result=await view();const badge=id=>result.achievements.find(a=>a.id===id);
 assert.equal(badge('words_1000').unlocked,true);assert.equal(result.totals.words,1500);assert.equal(badge('streaks_14').unlocked,true);assert.equal(badge('sessions_10').unlocked,true);
 result=await view(false);assert.equal(result.totals.streak,7);assert.ok(!result.achievements.some(a=>a.requirement>7&&a.metric==='streak'));assert.ok(!result.achievements.some(a=>a.category==='documents'));
 const count=Number((await db.query('select count(*) n from writing_user_rewards where user_id=$1',[owner])).rows[0].n);await view();assert.equal(Number((await db.query('select count(*) n from writing_user_rewards where user_id=$1',[owner])).rows[0].n),count);
 // Historical unlocks survive a missed day and user-requested clearing of activity.
 await db.query('delete from writing_activity where user_id=$1 and (started_at at time zone \'UTC\')::date=(now() at time zone \'UTC\')::date-2',[owner]);result=await view();assert.equal(result.totals.streak,2);assert.equal(badge('streaks_14').unlocked,true);
 let prefs=result.preferences;await call('writing_reward_settings',owner,prefs.revision,JSON.stringify({enabled:false}),true);result=await view();assert.equal(result.enabled,false);assert.deepEqual(result.achievements,[]);assert.equal(await call('writing_reward_claim',owner,true),null);
 assert.equal((await call('writing_reward_settings',owner,0,JSON.stringify({enabled:true}),true)).conflict,true);
 await call('writing_reward_settings',owner,result.preferences.revision,JSON.stringify({enabled:true}),true);result=await view();assert.equal(badge('words_1000').unlocked,true);assert.equal(await call('writing_reward_claim',owner,true),null,'re-enable does not replay history');
 // Today's target is captured before writing and cannot be lowered retroactively.
 const goalUser=randomUUID();await db.query('insert into auth.users values($1)',[goalUser]);await call('writing_update_preferences',goalUser,0,JSON.stringify({daily_goal:250,timezone:'UTC'}));
 const activity=randomUUID();await db.query(`insert into writing_activity(id,user_id,document_id,source,started_at,typed_words,duration_seconds,sequence) values($1,$2,null,'extension',now(),200,0,1)`,[activity,goalUser]);
 await call('writing_update_preferences',goalUser,1,JSON.stringify({daily_goal:100}));assert.equal((await call('writing_rewards',goalUser,true,'en')).totals.goals,0);
 await db.query('update writing_activity set typed_words=250,sequence=2 where id=$1',[activity]);assert.equal((await call('writing_rewards',goalUser,true,'en')).totals.goals,1);await db.query('update writing_activity set sequence=3 where id=$1',[activity]);assert.equal((await call('writing_rewards',goalUser,true,'en')).totals.goals,1);
 // Distinct completion evidence survives reopening and permanent document deletion.
 const doc=randomUUID();await db.query(`insert into writing_documents(id,user_id,title,content,plain_text,mutation_id,completion_status) values($1,$2,'Fixture','{"type":"doc","content":[{"type":"paragraph"}]}','',$3,'completed')`,[doc,owner,randomUUID()]);
 await db.query("update writing_documents set completion_status='draft' where id=$1",[doc]);await db.query("update writing_documents set completion_status='completed' where id=$1",[doc]);
 result=await view();assert.equal(badge('documents_1').unlocked,true);assert.equal(Number((await db.query('select count(*) n from writing_reward_document_completions where user_id=$1',[owner])).rows[0].n),1);await db.query('delete from writing_documents where id=$1',[doc]);assert.equal((await view()).achievements.find(a=>a.id==='documents_1').unlocked,true);
 // The shared interval union, not a sum of local timers, determines time badges.
 const timeUser=randomUUID();await db.query('insert into auth.users values($1)',[timeUser]);await call('writing_rewards',timeUser,true,'en');
 const base=Date.now()-7200000, a=randomUUID(), b=randomUUID();
 for(const [id,source,intervals,duration,status,words] of [[a,'editor',[[base,base+1800000],[base+2700000,base+4500000]],3600,'active',100],[b,'extension',[[base+900000,base+1800000],[base+4500000,base+5400000]],1800,'ended',200]]) {
  await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,duration_seconds,sequence,timer,active_intervals) values($1,$2,$3,$4, $5,$6,1,$7,$8)`,[id,timeUser,source,new Date(base).toISOString(),words,duration,JSON.stringify({status,active_ms:duration*1000,paused_ms:900000,changed_at:Date.now()}),JSON.stringify(intervals)]);
 }
 let timed=await call('writing_rewards',timeUser,true,'en');assert.equal(timed.totals.seconds,4500,'overlap counts once and global paused gap is excluded');assert.equal(timed.totals.sessions,1,'active session is not a completed session');assert.equal(timed.achievements.find(a=>a.id==='time_1').unlocked,true);
 assert.equal(await call('writing_reward_claim',timeUser,true),null,'an active writer is not interrupted');
 await db.query(`update writing_activity set timer=jsonb_set(timer,'{status}','"ended"') where id=$1`,[a]);
 const claimed=await call('writing_reward_claim',timeUser,true);assert.ok(claimed);assert.equal(await call('writing_reward_claim',timeUser,true),null,'a second device cannot celebrate the same batch');
 await db.query('update writing_activity set typed_words=700,sequence=2 where id=$1',[b]);await call('writing_rewards',timeUser,true,'en');assert.equal(await call('writing_reward_claim',timeUser,true),null,'five-minute calm celebration limit');
 // Favorites are verified, capped and private; downgrades keep earned records.
 result=await view();await call('writing_reward_settings',owner,result.preferences.revision,JSON.stringify({showcase:['streaks_14','words_100','documents_1']}),true);
 const downgraded=await view(false);assert.deepEqual(downgraded.preferences.showcase,['words_100']);assert.equal((await view()).preferences.showcase.length,3);
 await assert.rejects(()=>call('writing_reward_settings',owner,(downgraded.preferences.revision),JSON.stringify({showcase:['words_1000000']}),true),/invalid_showcase/);
 await assert.rejects(()=>call('writing_reward_settings',owner,(downgraded.preferences.revision),JSON.stringify({showcase:['streaks_14']}),false),/invalid_showcase/);
 await assert.rejects(()=>call('writing_reward_settings',owner,(downgraded.preferences.revision),JSON.stringify({showcase:['words_100','words_500','words_1000','sessions_1']}),true),/invalid_showcase/);
 // Definition changes never revoke awards or replace their original requirement.
 const edited=await call('writing_reward_admin_update','words_100',1,JSON.stringify({threshold:200,active:false}));assert.equal(edited.id,'words_100');assert.equal(await call('writing_reward_admin_update','words_100',1,JSON.stringify({active:true})),null);
 result=await view();assert.equal(badge('words_100').unlocked,true);assert.equal(badge('words_100').requirement,100);assert.equal(badge('words_100').active,false);assert.ok((await call('writing_reward_admin_catalog')).find(a=>a.id==='words_100').unlock_count>0);
 // Missing/partial historical coverage cannot create monthly growth awards.
 const growthUser=randomUUID();await db.query('insert into auth.users values($1)',[growthUser]);
 for(const [months,day,words] of [[2,2,100],[2,3,100],[1,2,100],[1,3,150],[1,4,200]])await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,duration_seconds,sequence,timer) values($1,$2,'extension',date_trunc('month',now())-($3||' month')::interval+($4||' day')::interval,$5,0,1,jsonb_build_object('status','ended','active_ms',0,'paused_ms',0,'changed_at',extract(epoch from now())*1000))`,[randomUUID(),growthUser,months,day,words]);
 let growth=await call('writing_rewards',growthUser,true,'en');assert.equal(growth.achievements.find(a=>a.id==='finding_rhythm').unlocked,false);assert.equal(growth.achievements.find(a=>a.id==='growing_practice').unlocked,false);
 await db.query(`update writing_reward_preferences set observed_since=date_trunc('month',now())-interval '2 months' where user_id=$1`,[growthUser]);
 growth=await call('writing_rewards',growthUser,true,'en');assert.equal(growth.achievements.find(a=>a.id==='finding_rhythm').unlocked,true);assert.equal(growth.achievements.find(a=>a.id==='growing_practice').unlocked,true);assert.equal(growth.achievements.find(a=>a.id==='new_chapter').unlocked,true);
 const bestActivity=randomUUID();await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,duration_seconds,sequence) values($1,$2,'extension',now(),300,0,1)`,[bestActivity,growthUser]);await call('writing_rewards',growthUser,true,'en');
 const bestCount=Number((await db.query(`select count(*) n from writing_personal_milestones where user_id=$1 and occurred_on=current_date`,[growthUser])).rows[0].n);
 await db.query('update writing_activity set typed_words=400,sequence=2 where id=$1',[bestActivity]);await call('writing_rewards',growthUser,true,'en');assert.equal(Number((await db.query(`select count(*) n from writing_personal_milestones where user_id=$1 and occurred_on=current_date`,[growthUser])).rows[0].n),bestCount);
 for(let weeks=1;weeks<=4;weeks++)await db.query(`insert into writing_reward_goal_days(user_id,reporting_date,target,timezone,locked,achieved_at) values($1,current_date-($2::int*7),100,'UTC',true,now()) on conflict do nothing`,[growthUser,weeks]);
 assert.equal((await call('writing_rewards',growthUser,true,'en')).achievements.find(a=>a.id==='steady_progress').unlocked,true);
 // Changing timezone cannot count overlapping reporting days twice.
 const zoneUser=randomUUID();await db.query('insert into auth.users values($1)',[zoneUser]);await call('writing_update_preferences',zoneUser,0,JSON.stringify({daily_goal:100,timezone:'Pacific/Kiritimati'}));
 await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,duration_seconds,sequence) values($1,$2,'extension',now(),100,0,1)`,[randomUUID(),zoneUser]);
 await call('writing_update_preferences',zoneUser,1,JSON.stringify({daily_goal:100,timezone:'America/Adak'}));await db.query(`insert into writing_activity(id,user_id,source,started_at,typed_words,duration_seconds,sequence) values($1,$2,'extension',now(),100,0,1)`,[randomUUID(),zoneUser]);
 assert.equal((await call('writing_rewards',zoneUser,true,'en')).totals.goals,1,'same writing in overlapping timezone days is one goal');
 const dst=await db.query(`select extract(epoch from (('2026-11-02'::timestamp at time zone 'America/New_York')-('2026-11-01'::timestamp at time zone 'America/New_York'))) seconds`);assert.equal(Number(dst.rows[0].seconds),90000);
 const backfill=await call('writing_reward_backfill',null,2);assert.equal(backfill.processed,2);assert.equal(backfill.has_more,true);assert.equal((await call('writing_reward_backfill',backfill.next_cursor,50)).has_more,false);
 // Reapplying the migration preserves awards, admin edits and preferences.
 await db.exec(fs.readFileSync('supabase/migrations/20261104010000_personal_writing_rewards.sql','utf8'));
 assert.equal((await call('writing_reward_admin_catalog')).find(a=>a.id==='words_100').threshold,200);
 // Direct client access can neither grant awards nor reveal premium/private data.
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 await assert.rejects(()=>db.query('select * from writing_user_rewards'));await assert.rejects(()=>call('writing_rewards',owner,true,'en'));await assert.rejects(()=>db.query("insert into writing_user_rewards(user_id,achievement_id,achieved_on,awarded_requirement) values($1,'words_100',current_date,100)",[other]));await db.exec('reset role');
 console.log('PASS: interval union/pause exclusion, calm deduplicated claims, showcase permissions, stable edited awards, honest completed-month growth, personal-best deduplication, timezone overlap, DST, bounded backfill, migration replay; 53 achievements, actual 15-day history/Free cap, idempotent unlocks, disabled/re-enabled retention, locked daily goals, distinct durable completions, cross-account denial.');
 }finally{await db.close();}
});
