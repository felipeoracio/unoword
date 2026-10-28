const assert=require('node:assert/strict');
const {test}=require('node:test');
global.WCDates=require('../shared/dates.js');
const {total,withActive,snapshot}=require('../shared/writing-progress.js');
const now=Date.parse('2026-10-28T01:00:00Z'),zone='America/Chicago';
test('Same dashboard total excludes paste, yesterday and duplicate editor records',()=>{
 const rows=[{id:'editor:one',startedAt:now,typedWords:500,pastedWords:900},
  {id:'editor:one',startedAt:now,typedWords:500}, {id:'local',startedAt:now,typedWords:250},
  {id:'yesterday',startedAt:now-86400000,typedWords:1000}];
 assert.equal(total(rows,now,zone),750);
 assert.equal(withActive(750,{active:true,startedAt:now,typedWords:100,pastedWords:900},zone,now),850);
});
test('Snapshot shares writer-local day and latest goal; never fabricates remaining words',()=>{
 const value=snapshot(1000,750,zone,now);
 assert.equal(value.date,'2026-10-27');assert.equal(value.words_written_today,750);assert.equal(value.daily_goal,1000);
 assert.equal(value.remaining_words,undefined);
 assert.equal(snapshot(250,750,zone,now).daily_goal,250);
});
test('Active sessions from yesterday and stopped cards are not counted twice',()=>{
 assert.equal(withActive(750,{active:true,startedAt:now-86400000,typedWords:100},zone,now),750);
 assert.equal(withActive(750,{active:false,startedAt:now,typedWords:750},zone,now),750);
});
test('Cleared history and deleted words immediately affect the next snapshot',()=>{
 assert.equal(total([],now,zone),0);
 assert.equal(total([{id:'same',startedAt:now,typedWords:100},{id:'same',startedAt:now,typedWords:0}],now,zone),0);
 assert.equal(snapshot(0,0,zone,now).daily_goal,null);
});
