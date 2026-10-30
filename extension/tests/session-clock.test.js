const {test}=require('node:test');const assert=require('node:assert/strict');
const clock=require('../shared/session-clock.js');const cloud=require('../shared/cloud-progress.js');
const minute=60000;
test('25 minutes writing, 10 paused, 20 writing records 45/10/55 minutes',()=>{
 const start=1000000;let timer=clock.start(start);
 timer=clock.transition(timer,'paused',start+25*minute);
 assert.equal(clock.read(timer,start+35*minute).active_ms,25*minute);
 timer=JSON.parse(JSON.stringify(timer)); // restart/refresh restores the same paused state
 assert.equal(timer.status,'paused');
 timer=clock.transition(timer,'active',start+35*minute);
 timer=clock.transition(timer,'ended',start+55*minute);
 assert.deepEqual(clock.read(timer,start+80*minute),{active_ms:45*minute,paused_ms:10*minute,elapsed_ms:55*minute});
 assert.equal(clock.transition(timer,'active',start+90*minute),timer,'Ended sessions cannot restart by accident');
});
test('repeated pause/resume is idempotent; ending paused freezes active time',()=>{
 let timer=clock.start(1000);timer=clock.transition(timer,'paused',6000);
 const again=clock.transition(timer,'paused',7000);assert.equal(again,timer);
 timer=clock.transition(timer,'active',8000);timer=clock.transition(timer,'active',9000);
 timer=clock.transition(timer,'paused',10000);timer=clock.transition(timer,'ended',12000);
 assert.deepEqual(clock.read(timer,90000),{active_ms:7000,paused_ms:4000,elapsed_ms:11000});
});
test('clock survives suspended intervals, background tabs and serialization',()=>{
 const timer=JSON.parse(JSON.stringify(clock.start(1000)));
 assert.equal(clock.read(timer,3601000).active_ms,3600000);
 assert.equal(clock.read(timer,500).active_ms,0,'A backward device clock never creates negative duration');
});
test('legacy sessions keep their previous duration and metadata sync excludes pauses',()=>{
 assert.equal(clock.read(clock.forSession({startedAt:1000,endedAt:6000}),9000).active_ms,5000);
 const timer=clock.transition(clock.start(1000),'paused',6000);
 const row=cloud.session({ownerId:'writer',startedAt:1000,typedWords:12,pastedWords:8,progressVersion:1,timer},16000);
 assert.equal(row.duration_seconds,5);assert.equal(row.typed_words,12);assert.equal(row.pasted_words,8);
});
test('CSV round-trip preserves active and paused time; old CSV remains readable',()=>{
 const history=require('../shared/history.js');
 const row={id:1,startedAt:1000,endedAt:3301000,typedWords:25,timer:{status:'ended',active_ms:2700000,paused_ms:600000,changed_at:3301000}};
 const result=history.parseCSV(history.toCSV([row]));assert.equal(result.validCount,1);
 assert.deepEqual(clock.read(result.records[0].timer),{active_ms:2700000,paused_ms:600000,elapsed_ms:3300000});
 assert.equal(history.parseCSV('start_time,words_written\n2026-10-29T12:00:00Z,5').validCount,1);
});

test('Exact checkpoints preserve pauses, day-spanning ranges and duplicate timer reads',()=>{
 const start=Date.parse('2026-10-20T23:50:00Z');
 let row={started_at:new Date(start).toISOString(),timer:clock.start(start),active_intervals:[]};
 row.active_intervals=clock.intervals(row,start+1200000);
 row.timer=clock.checkpoint(row.timer,start+1200000);
 assert.deepEqual(row.active_intervals,[[start,start+1200000]]);
 assert.deepEqual(clock.intervals(row,start+1200000),row.active_intervals);
 row.timer=clock.transition(row.timer,'paused',start+1200000);
 row.timer=clock.transition(row.timer,'active',start+1500000);
 row.active_intervals=clock.intervals(row,start+2100000);
 assert.deepEqual(row.active_intervals,[[start,start+1200000],[start+1500000,start+2100000]]);
 assert.equal(row.active_intervals.reduce((n,[a,b])=>n+b-a,0),1800000);
});
