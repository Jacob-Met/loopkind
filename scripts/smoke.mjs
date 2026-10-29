import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,LOOPKIND_PORT:'0'},stdio:['ignore','pipe','pipe']});
let exited=false;child.once('exit',()=>{exited=true;});child.stderr.resume();
async function stop(){
 if(exited)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');let timer;
 await Promise.race([done,new Promise(r=>{timer=setTimeout(r,2000);})]);clearTimeout(timer);
 if(!exited){child.kill('SIGKILL');await done;}
}
try{
 const base=await new Promise((resolve,reject)=>{
  let buffer='';
  const timer=setTimeout(()=>finish(Error('Server did not announce a startup URL within 10 seconds.')),10000);
  const finish=(error,url)=>{clearTimeout(timer);child.stdout.off('data',onData);child.off('error',onError);child.off('exit',onExit);error?reject(error):resolve(url);};
  const onError=e=>finish(e),onExit=(code,signal)=>finish(Error('Server exited before startup ('+(code??signal)+').'));
  const onData=chunk=>{
   buffer+=chunk.toString('utf8');if(buffer.length>65536){finish(Error('Unexpectedly large startup output.'));return;}
   for(let end;(end=buffer.indexOf('\n'))!==-1;){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let data;try{data=JSON.parse(line);}catch{continue;}
    if(typeof data.url==='string'&&Number.isInteger(data.port)&&data.port>0){
     const u=new URL(data.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){finish(Error('Smoke server must announce a loopback URL.'));return;}finish(null,u.origin);return;
    }
   }
  };
  child.stdout.on('data',onData);child.once('error',onError);child.once('exit',onExit);
 });
 child.stdout.resume();
 async function request(path,body){
  const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{Origin:base}:{Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  let data;try{data=await r.json();}catch{throw Error(path+': expected JSON (HTTP '+r.status+').');}return{status:r.status,ok:r.ok,data};
 }
 async function good(path,body){const r=await request(path,body);assert.ok(r.ok,path+': HTTP '+r.status+', '+(r.data.error?.message||'request failed'));return r.data;}
 const project=await good('/api/example?scenario=three'),result=await good('/api/plan',project),plan=result.plans.find(p=>p.members.length===3);
 assert.ok(plan);assert.equal(plan.validation.ok,true);assert.equal(plan.tasks.length,3);
 const maraTask=plan.tasks.find(t=>t.providerId==='mara');assert.equal(maraTask.end-maraTask.start,45);
 const session=await good('/api/review-start',{project,plan});assert.equal(session.mode,'simulated');assert.equal(session.status,'waiting');assert.deepEqual(session.approvals,[]);assert.equal(session.pending.length,3);assert.ok(session.sessionId);
 const forged=await request('/api/review',{sessionId:session.sessionId,project,plan,actorId:plan.members[0],action:'approve',approvals:plan.members.map(memberId=>({memberId,planId:plan.id,sessionId:session.sessionId,at:new Date().toISOString()}))});assert.equal(forged.status,400);
 let review=session;
 for(const[i,actorId]of plan.members.entries()){
  review=await good('/api/review',{sessionId:session.sessionId,project,plan,actorId,action:'approve'});
  assert.equal(review.mode,'simulated');assert.equal(review.approvals.length,i+1);assert.equal(review.pending.length,plan.members.length-i-1);assert.equal(review.status,i===plan.members.length-1?'approved':'waiting');
 }
 const changed=structuredClone(project);changed.members.find(m=>m.id===plan.members[0]).active=false;
 const withdrawn=await request('/api/review',{sessionId:session.sessionId,project:changed,plan,actorId:plan.members[1],action:'approve'});assert.ok([400,409].includes(withdrawn.status));
 assert.equal((await good('/api/plan',changed)).plans.length,0);
 await good('/api/review-retire',{sessionId:session.sessionId});
 const stale=await request('/api/review',{sessionId:session.sessionId,project,plan,actorId:plan.members[0],action:'approve'});assert.equal(stale.status,409);
 const imported=await good('/api/import',{format:'loopkind-demo',version:1,mode:'local-demo',project,selectedPlan:plan,approvals:review.approvals,history:[]});
 assert.equal(imported.reviewReset,true);assert.deepEqual(imported.approvals,[]);assert.ok(!imported.sessionId);assert.ok(imported.selectedPlan);
 const fresh=await good('/api/review-start',{project:imported.project,plan:imported.selectedPlan});assert.notEqual(fresh.sessionId,session.sessionId);assert.deepEqual(fresh.approvals,[]);assert.equal(fresh.status,'waiting');
 const declined=await good('/api/review',{sessionId:fresh.sessionId,project:imported.project,plan:imported.selectedPlan,actorId:plan.members[0],action:'decline'});assert.equal(declined.status,'declined');await good('/api/review-retire',{sessionId:fresh.sessionId});
 const fourProject=await good('/api/example?scenario=four'),four=(await good('/api/plan',fourProject)).plans.find(p=>p.members.length===4);
 assert.ok(four);assert.equal(four.validation.ok,true);assert.ok(four.metrics.finishesAt-four.metrics.startsAt<=60);
 assert.ok(four.tasks.some((a,i)=>four.tasks.some((b,j)=>i<j&&Math.max(a.start,b.start)<Math.min(a.end,b.end))));
 for(const scenario of['circular','tight'])assert.equal((await good('/api/plan',await good('/api/example?scenario='+scenario))).plans.length,0);
 console.log(JSON.stringify({ok:true,mode:'local-demo',checks:['three-person schedule','giver duration','server-owned simulated approvals','client approval rejection','withdrawal','retired session rejection','import resets review','decline','four-person parallel schedule','circular and tight negatives'],providerCalled:false}));
}finally{await stop();}
