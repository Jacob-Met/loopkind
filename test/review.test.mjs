import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {findPlans} from '../src/planner.mjs';
import {createReviewBook,importDemo,ReviewError,ImportError} from '../src/review.mjs';
const clone=v=>structuredClone(v),sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const result=findPlans({version:1,title:'Review fixture',date:'2026-11-02',utcOffset:'+00:00',skills:['a','b','c'].map(id=>({id,label:id})),members:['A','B','C'].map((id,index)=>({id,name:id,active:true,confirmed:true,materialsReady:true,offer:['a','b','c'][index],need:['c','a','b'][index],durationMinutes:15,windows:[{start:0,end:90}],afterReceive:false}))});
 const plan=result.plans.find(p=>p.members.length===3);assert.ok(plan);return{project:result.project,plan};
}
const act=(book,session,data,actorId,action='approve')=>book.decide({sessionId:session.sessionId,project:data.project,plan:data.plan,actorId,action});
const envelope=(data,extra={})=>({format:'loopkind-demo',version:1,mode:'local-demo',project:data.project,selectedPlan:data.plan,...extra});
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof ReviewError&&(!code||e.code===code));
test('a reviewed profile does not approve a plan, and no-plan readiness is impossible',()=>{
 const book=createReviewBook(),data=fixture();
 rejects(()=>book.start({project:data.project,plan:null}),'invalid_plan');
 const state=book.start(data);assert.equal(state.mode,'simulated');assert.equal(state.status,'waiting');assert.deepEqual(state.approvals,[]);assert.deepEqual([...state.pending].sort(),['A','B','C']);
});
test('only all exact-plan simulated approvals make the current review approved',()=>{
 const book=createReviewBook(),data=fixture(),session=book.start(data);let state;
 for(const id of data.plan.members)state=act(book,session,data,id);
 assert.equal(state.status,'approved');assert.equal(state.mode,'simulated');assert.deepEqual(state.pending,[]);assert.equal(state.approvals.length,3);
 assert.ok(state.approvals.every(a=>a.planId===data.plan.id&&a.sessionId===session.sessionId));assert.equal('authenticated' in state,false);assert.equal('actualConsent' in state,false);
});
test('duplicate actions are idempotent and a decline persists until that actor revises it',()=>{
 const book=createReviewBook(),data=fixture(),session=book.start(data);
 const declined=act(book,session,data,'B','decline');assert.deepEqual(act(book,session,data,'B','decline'),declined);
 act(book,session,data,'A');const state=act(book,session,data,'C');
 assert.equal(state.status,'declined');assert.deepEqual(state.declinedBy,['B']);assert.equal(state.approvals.length,2);
 const revised=act(book,session,data,'B');assert.equal(revised.status,'approved');assert.deepEqual(revised.declinedBy,[]);assert.equal(revised.decisions.length,3);assert.deepEqual(act(book,session,data,'B'),revised);
});
test('unknown actors and client-supplied approval flags are rejected without inheriting decisions',()=>{
 const book=createReviewBook(),data=fixture(),session=book.start(data);rejects(()=>act(book,session,data,'outsider'),'actor_not_required');
 for(const extra of[{approvals:[{memberId:'B'}]},{status:'approved'},{actualConsent:true}])rejects(()=>book.decide({sessionId:session.sessionId,...data,actorId:'A',action:'approve',...extra}),'invalid_request');
 const state=act(book,session,data,'A');assert.equal(state.approvals.length,1);assert.equal(state.status,'waiting');
});
test('edit then exact reversion starts a new generation and cannot resurrect original approvals',()=>{
 const book=createReviewBook(),data=fixture(),original=book.start(data);
 for(const id of data.plan.members)act(book,original,data,id);
 const result=findPlans({...data.project,title:'Edited and committed'}),edited={project:result.project,plan:result.plans.find(p=>p.members.length===3)};
 const second=book.start({...edited,previousSessionId:original.sessionId}),reverted=book.start({...data,previousSessionId:second.sessionId});
 assert.notEqual(reverted.sessionId,original.sessionId);assert.equal(reverted.planId,original.planId);assert.equal(reverted.status,'waiting');assert.deepEqual(reverted.approvals,[]);
 rejects(()=>act(book,original,data,'A'),'closed_session');rejects(()=>act(book,second,edited,'A'),'closed_session');
});
test('stale or invalid project, date, offset, and withdrawal decisions retire their session before reversion',()=>{
 const original=fixture();
 for(const mutate of[p=>{p.title='Changed';},p=>{p.date='2026-11-03';},p=>{p.utcOffset='+01:00';},p=>{p.members[0].active=false;},p=>{p.members[0].durationMinutes=20;},p=>{p.date='2026-02-30';}]){
  const book=createReviewBook(),session=book.start(original);act(book,session,original,'A');const changed=clone(original.project);mutate(changed);
  rejects(()=>act(book,session,{project:changed,plan:original.plan},'B'),'stale_review');rejects(()=>act(book,session,original,'B'),'closed_session');
 }
});
test('a different independently valid schedule cannot inherit the original approvals',()=>{
 const book=createReviewBook(),data=fixture(),session=book.start(data);act(book,session,data,'A');
 const later=clone(data.plan);later.tasks.forEach(t=>{t.start+=15;t.end+=15;});later.id='plan-'+sha({inputRevision:later.inputRevision,tasks:later.tasks}).slice(0,20);
 rejects(()=>act(book,session,{project:data.project,plan:later},'B'),'stale_review');rejects(()=>act(book,session,data,'B'),'closed_session');
});
test('input and outward snapshots are independent, and retire is idempotent',()=>{
 const book=createReviewBook(),data=fixture(),pristine=clone(data),state=book.start(data);assert.deepEqual(data,pristine);
 state.pending.length=0;state.approvals.push({memberId:'B',planId:data.plan.id,sessionId:state.sessionId,at:'forged'});
 data.project.members[0].name='External object mutation';data.plan.members.reverse();
 const approved=act(book,state,pristine,'A');assert.equal(approved.approvals.length,1);assert.equal(approved.approvals[0].memberId,'A');assert.equal(approved.status,'waiting');
 approved.decisions[0].action='decline';assert.equal(act(book,state,pristine,'A').status,'waiting');
 const first=book.retire({sessionId:state.sessionId});assert.deepEqual(book.retire({sessionId:state.sessionId}),first);rejects(()=>act(book,state,pristine,'A'),'closed_session');
});
test('import retains a verified project and plan but strips imported review assertions and recomputes metadata',()=>{
 const data=fixture(),raw=envelope(data,{approvals:data.plan.members.map(memberId=>({memberId,approved:true})),history:[{actualConsent:true}],sessionId:'forged-session',authenticated:true,actualConsent:true,ready:true});
 raw.selectedPlan={...clone(raw.selectedPlan),authenticated:true,actualConsent:true};raw.selectedPlan.tasks[0].actualConsent=true;
 raw.selectedPlan.metrics={people:999,startsAt:-1,finishesAt:99999,sessionMinutes:99999};raw.selectedPlan.validation={ok:false,errors:['FORGED']};
 const before=clone(raw),imported=importDemo(raw);assert.deepEqual(raw,before);assert.equal(imported.mode,'local-demo');assert.equal(imported.reviewReset,true);
 assert.deepEqual(imported.approvals,[]);assert.deepEqual(imported.history,[]);assert.deepEqual(imported.project,data.project);assert.deepEqual(imported.selectedPlan,data.plan);
 assert.equal(JSON.stringify(imported).includes('actualConsent'),false);assert.equal(JSON.stringify(imported).includes('authenticated'),false);
 assert.equal(createReviewBook().start({project:imported.project,plan:imported.selectedPlan}).status,'waiting');
});
test('invalid imports fail atomically without disturbing a live review',()=>{
 const book=createReviewBook(),data=fixture(),session=book.start(data),before=act(book,session,data,'A');
 const invalidPlan=clone(data.plan);invalidPlan.tasks[0].end+=15;const invalidProject=clone(data.project);invalidProject.date='2026-02-30';
 for(const bad of[envelope(data,{version:2}),envelope(data,{mode:'actual-consent'}),envelope(data,{selectedPlan:invalidPlan}),envelope(data,{project:invalidProject})]){
  assert.throws(()=>importDemo(bad),ImportError);assert.deepEqual(act(book,session,data,'A'),before);
 }
 rejects(()=>book.start({project:data.project,plan:invalidPlan,previousSessionId:session.sessionId}),'invalid_plan');assert.deepEqual(act(book,session,data,'A'),before);
});
test('a project-only import resets review without inventing a selected plan',()=>{
 const data=fixture(),raw=envelope(data);delete raw.selectedPlan;const imported=importDemo(raw);
 assert.equal(imported.selectedPlan,null);assert.equal(imported.reviewReset,true);assert.deepEqual(imported.approvals,[]);
 rejects(()=>createReviewBook().start({project:imported.project,plan:imported.selectedPlan}),'invalid_plan');
});
test('the session book is bounded and evicts the oldest review after 128 admissions',()=>{
 const book=createReviewBook(),data=fixture(),sessions=Array.from({length:129},()=>book.start(data));
 assert.equal(new Set(sessions.map(s=>s.sessionId)).size,129);
 assert.throws(()=>act(book,sessions[0],data,'A'),e=>e instanceof ReviewError&&e.code==='unknown_session'&&e.status===409);
 assert.equal(act(book,sessions[128],data,'A').approvals.length,1);
});
