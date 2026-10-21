const assert = require('node:assert/strict');
const { test } = require('node:test');
const dates = require('../shared/dates.js');
const { computeStreak } = require('../shared/history.js');
const { websiteStatus, publicWebUrl } = require('../shared/resource-state.js');
const tz = 'America/Chicago';

test('Today includes evening Chicago sessions after UTC midnight',()=>{
  const now=Date.parse('2026-10-21T01:15:00Z');
  const r=dates.rangeBounds('today',now,tz);
  assert.equal(new Date(r.start).toISOString(),'2026-10-20T05:00:00.000Z');
  assert.equal(new Date(r.end).toISOString(),'2026-10-21T05:00:00.000Z');
  assert.ok(r.start<=now && now<r.end);
});
test('Spring DST day lasts 23 hours',()=>{
  const r=dates.rangeBounds('today',Date.parse('2026-03-08T18:00Z'),tz);
  assert.equal((r.end-r.start)/3600000,23);
});
test('Fall DST day lasts 25 hours',()=>{
  const r=dates.rangeBounds('today',Date.parse('2026-11-01T18:00Z'),tz);
  assert.equal((r.end-r.start)/3600000,25);
});
test('Week has seven distinct calendar buckets across DST',()=>{
  const r=dates.rangeBounds('week',Date.parse('2026-11-01T18:00Z'),tz);
  const keys=dates.dayKeysForRange(r.start,r.end,tz);
  assert.equal(keys.length,7);assert.equal(new Set(keys).size,7);
  assert.equal(keys[0],'2026-10-26');assert.equal(keys.at(-1),'2026-11-01');
});
test('Leap February uses the correct month boundaries',()=>{
  const r=dates.rangeBounds('month',Date.parse('2024-02-20T18:00Z'),tz);
  assert.equal(dates.dayKeysForRange(r.start,r.end,tz).length,29);
});
test('Streak counts calendar days after a short DST day',()=>{
  const history=['2026-03-07T18:00Z','2026-03-08T18:00Z'].map(startedAt=>({startedAt:Date.parse(startedAt),typedWords:10}));
  assert.equal(computeStreak(history,tz,Date.parse('2026-03-09T05:30Z')),2);
});
test('All-time range retains real history without fake boundaries',()=>{
  assert.deepEqual(dates.rangeBounds('all',123456,tz),{start:0,end:123457});
});
const ready={enabled:true,processing_status:'ready',word_count:120,chunk_count:2,indexing_status:'indexed'};
test('Ready requires text and a proven complete index',()=>assert.equal(websiteStatus(ready),'ready'));
for(const [label,patch,expected] of [
  ['a URL alone',{word_count:0},'not_indexed'],['missing passages',{chunk_count:0},'not_indexed'],
  ['an incomplete index',{indexing_status:'partial'},'not_indexed'],['unknown old metadata',{indexing_status:'unknown'},'not_indexed'],
  ['disabled content',{enabled:false},'disabled'],['failed extraction',{processing_status:'failed'},'failed'],['processing',{processing_status:'processing'},'processing'],
])test(`Status distinguishes ${label}`,()=>assert.equal(websiteStatus({...ready,...patch}),expected));
test('Open never accepts executable or malformed URLs',()=>{
  assert.equal(publicWebUrl('javascript:alert(1)'),null);
  assert.equal(publicWebUrl('data:text/html,unsafe'),null);
  assert.equal(publicWebUrl('not a url'),null);
  assert.equal(publicWebUrl('https://example.com/a?query=long'),'https://example.com/a?query=long');
});
