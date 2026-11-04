import { test } from 'node:test';
import assert from 'node:assert/strict';
import {nextAchievement,rewardProgress,type Achievement,type Rewards} from '../../../shared/rewards';
const item=(id:string,metric:string,progress:number,requirement:number,unlocked=false):Achievement=>({id,name:id,description:'',category:metric,metric,tier:'bronze',badge_image:null,requirement,progress,unlocked,earned_on:null,awarded_at:null,active:true});
test('next milestone favors achievable progress without telling a writer to take a break',()=>{
 const data={achievements:[item('return','return_days',13,14),item('earned','words',100,100,true),item('words','words',90,100),item('streak','streak',1,7)]} as Rewards;
 assert.equal(nextAchievement(data)?.id,'words');assert.equal(nextAchievement({achievements:[]} as unknown as Rewards),undefined);
});
test('the shared web/native progress label gives readable active hours and Spanish units',()=>{
 assert.equal(rewardProgress(item('time','seconds',10800,18000)),'3 / 5 active hours');
 assert.equal(rewardProgress(item('time','seconds',5400,18000),'es'),'1,5 / 5 horas activas');
 assert.equal(rewardProgress(item('goal','goals',7,5)),'5 / 5 goal days');
});
