import {describe,it,expect} from 'vitest';
import {validGuidedGoal,guidedProgress,readGuidedPlan,validGuidedDirection} from '../../shared/guided-writing';
describe('guided session foundation',()=>{
 it('validates positive whole session goals',()=>{for(const n of [1,100,250,500,750,1000,1500,10000])expect(validGuidedGoal(n)).toBe(true);for(const n of [0,-1,2.5,10001,NaN,Infinity,'500',true])expect(validGuidedGoal(n)).toBe(false);});
 it('tracks canonical session progress, deletion and overshoot',()=>{expect(guidedProgress(325,500)).toEqual({written:325,remaining:175,percent:65,complete:false});expect(guidedProgress(250,500).remaining).toBe(250);expect(guidedProgress(520,500)).toEqual({written:520,remaining:0,percent:100,complete:true});});
 it('validates allocations against the remaining scope',()=>{expect(validGuidedDirection({goal:500,target_words:150,intention:'continue',sections:[{title:'Outcome',words:100},{title:'Reflection',words:50}]})).toBe(true);expect(validGuidedDirection({goal:100,target_words:100,intention:'new',sections:[{title:'Detail',words:60},{title:'Meaning',words:30}]})).toBe(false);});
 it('isolates cached plans by owner and document',()=>{const raw=JSON.stringify({version:1,owner:'a',documentId:'d',goal:500,intention:'new',sessionId:'s',direction:null,contextKey:'general',completionDismissed:false});expect(readGuidedPlan(raw,'a','d')?.goal).toBe(500);expect(readGuidedPlan(raw,'b','d')).toBeNull();expect(readGuidedPlan(raw,'a','e')).toBeNull();expect(readGuidedPlan('{','a','d')).toBeNull();});
});
