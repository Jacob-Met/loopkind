import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {findPlans} from '../src/planner.mjs';
import {verifyPlan} from '../src/verify.mjs';

  const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'), clone=value=>structuredClone(value);
  function cycle(count,windows=[{start:540,end:630}],durationMinutes=30) {
    const ids=['A','B','C','D'].slice(0,count);
    return {version:1,title:'Independent cycle fixture',date:'2026-11-02',utcOffset:'+00:00',skills:ids.map(id=>({id:`skill-${id}`,label:`Service ${id}`})),
      members:ids.map((id,index)=>({id,name:id,active:true,confirmed:true,materialsReady:true,offer:`skill-${id}`,need:`skill-${ids[(index+count-1)%count]}`,durationMinutes,windows:clone(windows),afterReceive:false}))};
  }
  function solve(input,options) {const result=findPlans(input,options);assert.ok(Array.isArray(result.plans));for(const plan of result.plans){const checked=verifyPlan(result.project,plan);assert.equal(checked.ok,true,checked.errors.join('\n'));}return result;}
  function choose(result,length){const plan=result.plans.find(candidate=>candidate.members.length===length);assert.ok(plan,`Expected a feasible ${length}-person cycle`);return plan;}
  function rebind(plan){plan.id=`plan-${sha({inputRevision:plan.inputRevision,tasks:plan.tasks}).slice(0,20)}`;return plan;}
  test('a three-person chain respects receipt-before-help and exact boundary contact',()=>{
    const input=cycle(3);input.members[0].durationMinutes=45;input.members[0].windows=[{start:540,end:615}];input.members[0].afterReceive=true;input.members[1].windows=[{start:570,end:645}];input.members[1].afterReceive=true;input.members[2].windows=[{start:540,end:645}];
    const result=solve(input),plan=choose(result,3),byProvider=new Map(plan.tasks.map(t=>[t.providerId,t]));
    assert.deepEqual([byProvider.get('C').start,byProvider.get('C').end],[540,570]);
    assert.deepEqual([byProvider.get('A').start,byProvider.get('A').end],[570,615]);
    assert.deepEqual([byProvider.get('B').start,byProvider.get('B').end],[615,645]);
    assert.ok(result.plans.every(candidate=>candidate.members.length===3));
  });
  test('three individually feasible edges cannot double-book their shared people',()=>{
    const result=solve(cycle(3,[{start:540,end:600}]));assert.equal(result.plans.length,0);assert.equal(result.search.complete,true);assert.equal(result.search.exhausted,false);
  });
  test('a four-person cycle uses parallel opposite edges to fit a one-hour window',()=>{
    const plan=choose(solve(cycle(4,[{start:540,end:600}])),4);
    assert.equal(Math.max(...plan.tasks.map(t=>t.end))-Math.min(...plan.tasks.map(t=>t.start)),60);
    const occupied=new Map();for(const task of plan.tasks)for(let minute=task.start;minute<task.end;minute+=15)occupied.set(minute,(occupied.get(minute)??0)+1);
    assert.ok([...occupied.values()].every(count=>count===2),'Two disjoint tasks must run in each occupied slot');
  });
  test('slot backtracking finds a feasible cycle after the first apparent outgoing slot fails',()=>{
    const input=cycle(3,[{start:0,end:90}]);input.members[0].afterReceive=true;input.members[1].windows=[{start:0,end:30},{start:60,end:90}];input.members[2].windows=[{start:0,end:60}];
    const plan=choose(solve(input),3),byProvider=new Map(plan.tasks.map(t=>[t.providerId,t]));
    assert.deepEqual([byProvider.get('B').start,byProvider.get('B').end],[0,30]);assert.deepEqual([byProvider.get('C').start,byProvider.get('C').end],[30,60]);assert.deepEqual([byProvider.get('A').start,byProvider.get('A').end],[60,90]);
  });
  test('every member requiring receipt first creates an impossible positive-duration cycle',()=>{
    const input=cycle(3,[{start:0,end:1440}]);input.members.forEach(m=>{m.afterReceive=true;});const result=solve(input);
    assert.equal(result.plans.length,0);assert.equal(result.search.complete,true);assert.equal(result.search.exhausted,false);assert.ok(result.rejectedCycles.some(r=>/circular|precedence|dependency/i.test(`${r.reason} ${r.detail}`)));
  });
  test('separate availability fragments cannot be treated as one uninterrupted service slot',()=>{
    const result=solve(cycle(3,[{start:0,end:15},{start:30,end:45},{start:60,end:75}]));assert.equal(result.plans.length,0);assert.equal(result.search.complete,true);
  });
  test('withdrawal, missing materials, and incomplete unreviewed intake never enter a cycle',()=>{
    const input=cycle(3),oldPlan=choose(solve(input),3);
    for(const change of [{active:false},{materialsReady:false},{confirmed:false,offer:null,need:null,durationMinutes:null,windows:[]}]){
      const changed=clone(input);Object.assign(changed.members[1],change);const result=solve(changed);assert.equal(result.plans.length,0);assert.equal(verifyPlan(result.project,oldPlan).ok,false);
    }
  });
  test('the exact date, fixed offset, tasks, and complete approval set bind a plan',()=>{
    const result=solve(cycle(3)),plan=choose(result,3);
    for(const change of [{date:'2026-11-03'},{utcOffset:'+01:00'}])assert.equal(verifyPlan(solve({...result.project,...change}).project,plan).ok,false);
    const omitted=clone(plan);omitted.approvalRequired.pop();assert.equal(verifyPlan(result.project,omitted).ok,false);
    const altered=clone(plan);altered.tasks[0].start+=15;altered.tasks[0].end+=15;const verdict=verifyPlan(result.project,altered);assert.equal(verdict.ok,false);assert.ok(verdict.errors.some(m=>/Plan ID/.test(m)));
  });
  test('degree counts alone cannot disguise two disconnected exchanges as one four-person cycle',()=>{
    const input=cycle(4,[{start:0,end:120}],15);input.skills=[{id:'shared',label:'Shared service'}];input.members.forEach(m=>{m.offer='shared';m.need='shared';});
    const result=solve(input),inputRevision=sha(result.project);
    const plan=rebind({inputRevision,members:['A','B','C','D'],approvalRequired:['A','B','C','D'],tasks:[
      {id:'A->B',providerId:'A',recipientId:'B',skill:'shared',start:0,end:15},
      {id:'B->A',providerId:'B',recipientId:'A',skill:'shared',start:15,end:30},
      {id:'C->D',providerId:'C',recipientId:'D',skill:'shared',start:0,end:15},
      {id:'D->C',providerId:'D',recipientId:'C',skill:'shared',start:15,end:30}]});
    const verdict=verifyPlan(result.project,plan);assert.equal(verdict.ok,false);assert.ok(verdict.errors.some(m=>/connected cycle/.test(m)));
  });
  test('independent verification detects coherent-ID overlap and service mutations',()=>{
    const result=solve(cycle(3)),plan=choose(result,3),overlapping=clone(plan);
    overlapping.tasks[1].start=overlapping.tasks[0].start;overlapping.tasks[1].end=overlapping.tasks[1].start+30;rebind(overlapping);
    const verdict=verifyPlan(result.project,overlapping);assert.equal(verdict.ok,false);assert.ok(verdict.errors.some(m=>/overlap/.test(m)));
    const wrong=clone(plan);wrong.tasks[0].skill=result.project.skills.find(skill=>skill.id!==wrong.tasks[0].skill).id;rebind(wrong);assert.equal(verifyPlan(result.project,wrong).ok,false);
  });
  test('exhausting a global search budget is incomplete evidence, not a proof of infeasibility',()=>{
    const input=cycle(4,[{start:0,end:120}],15);input.skills=[{id:'shared',label:'Shared service'}];input.members=Array.from({length:12},(_,index)=>({...clone(input.members[0]),id:`M${index}`,name:`Member ${index}`,offer:'shared',need:'shared'}));
    const result=solve(input,{maxStates:1});assert.ok(result.search.explored<=1);assert.equal(result.search.exhausted,true);assert.equal(result.search.complete,false);
  });
  test('identical canonical inputs produce the same selected schedules and plan identities',()=>{
    const input=cycle(4,[{start:540,end:600}]),first=solve(input),second=solve(clone(input));assert.deepEqual(first.plans,second.plans);assert.deepEqual(first.search,second.search);
  });
