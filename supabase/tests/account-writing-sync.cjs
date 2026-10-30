/** Real isolated PostgreSQL: migration, CAS, completion timestamps, timers and RLS. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const root=process.env.PGLITE_ROOT||require('node:path').resolve('tests/node_modules');
const {PGlite}=require(root+'/@electric-sql/pglite'),{vector}=require(root+'/@electric-sql/pglite-pgvector');
(async()=>{
 const db=new PGlite({extensions:{vector}});
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create extension vector with schema extensions;set search_path=public,extensions;`);
 await db.exec(fs.readFileSync('supabase/migrations/20260929010000_ai_writing_coach_foundation.sql','utf8').split('-- Private Supabase Storage bucket.')[0].replace(/create extension if not exists pgcrypto;/g,''));
 for(const f of ['20261023010000_writing_workspace.sql','20261023020000_writing_workspace_pro.sql','20261028010000_shared_ai_quota.sql','20261028040000_verified_streak_presentation.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));

 const migration=fs.readFileSync('supabase/migrations/20261029010000_session_pause_document_completion.sql','utf8');await db.exec(migration);
 const unified=fs.readFileSync('supabase/migrations/20261030010000_unified_account_writing_sync.sql','utf8');await db.exec(unified);await db.exec(unified);
 const owner=randomUUID(),other=randomUUID(),doc=randomUUID();
 await db.query('insert into auth.users values($1),($2)',[owner,other]);
 await db.query("insert into ai_entitlements(user_id,plan,status,daily_request_limit) values($1,'pro','active',10)",[owner]);
 await db.query("insert into writing_documents(id,user_id,title,mutation_id) values($1,$2,'Disposable',$3)",[doc,owner,randomUUID()]);
 const day='2026-10-20';const at=s=>Date.parse(day+'T'+s+'Z');
 const editor={id:randomUUID(),document_id:doc,started_at:new Date(at('12:00:00')).toISOString(),typed_words:500,pasted_words:500,duration_seconds:1200,sequence:1,
 device_id:'editor-A',active_intervals:[[at('12:00:00'),at('12:20:00')]],timer:{status:'paused',active_ms:1200000,paused_ms:0,changed_at:at('12:20:00')}};
 const ext={key:'extension-B',started_at:new Date(at('12:20:00')).toISOString(),typed_words:300,pasted_words:500,duration_seconds:900,sequence:2,
 device_id:'extension-B',active_intervals:[[at('12:20:00'),at('12:35:00')]],timer:{status:'ended',active_ms:900000,paused_ms:0,changed_at:at('12:35:00')}};
 const asUser=async who=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);};
 const put=async row=>db.query('select workspace_save_activity($1) r',[JSON.stringify(row)]).then(r=>r.rows[0].r);
 const sync=async row=>{await db.exec('reset role');return db.query('select writing_sync_extension($1,$2) r',[owner,JSON.stringify([row])]);};
 const summary=async(date=day,tz='UTC',paid=true)=>{await db.exec('reset role');return db.query('select writing_account_summary($1,$2,$3,$4) r',[owner,tz,date,paid]).then(r=>r.rows[0].r);};
 await asUser(owner);await put(editor);await put(editor);
 let result=await summary();assert.equal(result.dailyActiveWritingSeconds,1200);assert.equal(result.dailyWordCount,500);assert.equal(result.sessions.length,1);assert.equal(result.sessions[0].active_seconds,1200);
 await sync(ext);await sync(ext);result=await summary();assert.equal(result.dailyActiveWritingSeconds,2100);assert.equal(result.lifetimeActiveWritingSeconds,2100);assert.equal(result.dailyWordCount,800);
 // Duplicate delivery and stale updates cannot inflate either counter.
 await sync({...ext,sequence:1,typed_words:9999});result=await summary();assert.equal(result.dailyWordCount,800);
 // Concurrent device C overlaps both; union duration stays 35 minutes.
 await sync({...ext,key:'overlap-C',started_at:new Date(at('12:10:00')).toISOString(),typed_words:200,duration_seconds:1200,active_intervals:[[at('12:10:00'),at('12:30:00')]],sequence:1});
 result=await summary();assert.equal(result.dailyActiveWritingSeconds,2100);assert.equal(result.dailyWordCount,1000);
 // Active checkpoints count before End. A later checkpoint adds only new time.
 await sync({...ext,sequence:3,duration_seconds:1200,active_intervals:[[at('12:20:00'),at('12:40:00')]],timer:{...ext.timer,status:'active',active_ms:1200000}});
 result=await summary();assert.equal(result.dailyActiveWritingSeconds,2400);
 // 10 active + 5 paused + 10 active =20; paused gap excludes five minutes.
 await sync({...ext,key:'pause-D',started_at:new Date(at('13:00:00')).toISOString(),typed_words:10,duration_seconds:1200,
 active_intervals:[[at('13:00:00'),at('13:10:00')],[at('13:15:00'),at('13:25:00')]]});
 result=await summary();assert.equal(result.dailyActiveWritingSeconds,3600);
 // Midnight allocates elapsed portions, independently of the session-start day.
 await sync({...ext,key:'midnight',started_at:'2026-10-19T23:50:00Z',typed_words:20,duration_seconds:1800,
 active_intervals:[[Date.parse('2026-10-19T23:50:00Z'),Date.parse('2026-10-20T00:20:00Z')]]});
 assert.equal((await summary('2026-10-19')).dailyActiveWritingSeconds,600);assert.equal((await summary()).dailyActiveWritingSeconds,4800);
 // Stale abandoned active session never extrapolates into days of fake time.
 assert.equal((await summary()).lifetimeActiveWritingSeconds,5400);
 // A DST fall-back reporting day is 25 hours; no fixed 24h date arithmetic.
 await sync({...ext,key:'dst',started_at:'2025-11-02T03:30:00Z',duration_seconds:3600,typed_words:1,
 active_intervals:[[Date.parse('2025-11-02T03:30:00Z'),Date.parse('2025-11-02T04:30:00Z')]]});
 assert.equal((await summary('2025-11-01','America/New_York')).dailyActiveWritingSeconds,1800);
 assert.equal((await summary('2025-11-02','America/New_York')).dailyActiveWritingSeconds,1800);
 // Historical charts and summaries use precisely the same interval union.
 await db.exec('reset role');
 const history=(await db.query("select writing_progress_history($1,'UTC',0) r",[owner])).rows[0].r;
 const entry=history.find(row=>row.date===day);assert.equal(entry.duration_seconds,4800);assert.equal(entry.typed_words,1010);
 const stats=(await db.query("select writing_account_statistics($1,'all','UTC') r",[owner])).rows[0].r;
 assert.equal(stats.totalWords,1031);assert.equal(stats.activeWritingSeconds,(await summary()).lifetimeActiveWritingSeconds);
 // Account preferences become authoritative across every client's timezone hint.
 await db.query('select writing_update_preferences($1,0,$2)',[owner,JSON.stringify({daily_goal:1000,timezone:'America/Chicago',language:'es'})]);
 result=await summary(day,'UTC');assert.equal(result.timezone,'America/Chicago');assert.equal(result.dailyGoal,1000);
 let conflict=(await db.query('select writing_update_preferences($1,0,$2) r',[owner,JSON.stringify({daily_goal:50})])).rows[0].r;assert.ok(conflict.conflict);assert.equal(conflict.current.daily_goal,1000);
 // Free presentation never returns uncapped history. Existing data survives tiers.
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await assert.rejects(summary(day,'UTC',false),/writing_history_pro_required/);
 const freeView=await summary(today,'UTC',false);assert.ok(freeView.displayedStreak<=7);assert.ok(!('longestStreak' in freeView));assert.ok(!('milestones' in freeView));assert.equal(freeView.lifetimeActiveWritingSeconds,result.lifetimeActiveWritingSeconds);
 await asUser(other);assert.equal((await db.query('select * from writing_activity where user_id=$1',[owner])).rows.length,0);
 await assert.rejects(db.query('select writing_account_summary($1)',[owner]),/permission denied/);
 await assert.rejects(db.query('select writing_update_preferences($1,1,$2)',[owner,'{}']),/permission denied/);
 await assert.rejects(put({...editor,id:randomUUID()}),/row-level security/);
 await asUser(owner);await assert.rejects(put({...editor,id:randomUUID(),active_intervals:[[at('12:20:00'),at('12:00:00')]]}),/invalid_active_intervals/);
 // Legacy rows remain visible without invented pause detail.
 await db.exec('reset role');await sync({...ext,key:'legacy',started_at:'2026-10-18T12:00:00Z',active_intervals:undefined,timer:undefined,duration_seconds:600});
 assert.equal((await summary('2026-10-18')).dailyActiveWritingSeconds,600);
 // Reapplying the migration preserves activity, preferences and aggregates.
 const beforeReapply=await summary();await db.exec(unified);const afterReapply=await summary();
 assert.equal(afterReapply.lifetimeActiveWritingSeconds,beforeReapply.lifetimeActiveWritingSeconds);
 assert.equal(afterReapply.lifetimeWordCount,beforeReapply.lifetimeWordCount);assert.equal(afterReapply.dailyGoal,1000);
 // Deleting a document retains its checkpointed activity and does not add stale time.
 await db.query("update writing_documents set status='trashed' where id=$1",[doc]);await asUser(owner);
 await db.query('select workspace_empty_trash($1)',[JSON.stringify([{id:doc,revision:1}])]);
 assert.equal((await db.query('select document_id from writing_activity where id=$1',[editor.id])).rows[0].document_id,null);
 await db.close();console.log('PASS unified PostgreSQL: editor20+extension15=35; session isolation; overlap union; active checkpoints; pause gaps; retries/stale sequence; midnight; DST; account timezone/goals CAS; owner/Pro security; Free streak privacy; legacy preservation; Trash ledger retention.');
})().catch(e=>{console.error(e);process.exit(1);});
