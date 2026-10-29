import { randomUUID } from 'node:crypto';
import { validateProject, projectRevision, InputError } from './planner.mjs';
import { verifyPlan } from './verify.mjs';
export class ReviewError extends Error {
  constructor(code,message,status=400){super(message);this.name='ReviewError';this.code=code;this.status=status;}
}
export class ImportError extends ReviewError {
  constructor(code,message,status=400){super(code,message,status);this.name='ImportError';}
}
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),copy=v=>structuredClone(v);
function request(value,allowed){
  if(!record(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw new ReviewError('invalid_request','The request contains unsupported fields.');
}
function nonempty(value,label){
  if(typeof value!=='string'||!value||value.length>128)throw new ReviewError('invalid_request',label+' is required.');
}
function canonicalProject(value){
  try{return validateProject(value);}
  catch(error){throw new ReviewError('invalid_project',error instanceof InputError?'The project contains invalid or incomplete fields.':'The project could not be validated.');}
}
function allowedObject(value,keys){
  if(!record(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>keys.includes(key)));
}
function canonicalPlan(project,value){
  if(!record(value))throw new ReviewError('invalid_plan','Choose a valid current plan.');
  const plan=allowedObject(value,['id','inputRevision','members','tasks','approvalRequired']);
  if(Array.isArray(plan.tasks))plan.tasks=plan.tasks.map(task=>allowedObject(task,['id','providerId','recipientId','skill','start','end']));
  let verdict;try{verdict=verifyPlan(project,plan);}catch{throw new ReviewError('invalid_plan','The selected plan could not be verified.');}
  if(!verdict?.ok)throw new ReviewError('invalid_plan','The selected plan is not valid for this exact project.');
  plan.metrics={people:plan.members.length,startsAt:Math.min(...plan.tasks.map(t=>t.start)),finishesAt:Math.max(...plan.tasks.map(t=>t.end)),sessionMinutes:plan.tasks.reduce((sum,t)=>sum+t.end-t.start,0)};
  plan.validation={ok:verdict.ok,errors:[...verdict.errors]};
  return copy(plan);
}
function fingerprint(plan){
  return JSON.stringify({id:plan.id,inputRevision:plan.inputRevision,members:plan.members,tasks:plan.tasks,approvalRequired:plan.approvalRequired});
}
export function createReviewBook(){
  const sessions=new Map();
  const close=id=>{const session=sessions.get(id);if(session){session.closed=true;session.decisions.clear();}};
  const snapshot=session=>{
    const decisions=session.members.flatMap(memberId=>{const d=session.decisions.get(memberId);return d?[{memberId,action:d.action,at:d.at}]:[];});
    const approvals=decisions.filter(d=>d.action==='approve').map(d=>({memberId:d.memberId,planId:session.planId,sessionId:session.sessionId,at:d.at}));
    const declinedBy=decisions.filter(d=>d.action==='decline').map(d=>d.memberId);
    const pending=session.members.filter(id=>!session.decisions.has(id));
    const status=declinedBy.length?'declined':session.members.length>=2&&approvals.length===session.members.length?'approved':'waiting';
    return copy({mode:'simulated',sessionId:session.sessionId,planId:session.planId,status,approvals,decisions,pending,declinedBy});
  };
  return{
    start(input){
      request(input,['project','plan','previousSessionId']);
      if(input.previousSessionId!==undefined)nonempty(input.previousSessionId,'Previous session ID');
      const project=canonicalProject(input.project),plan=canonicalPlan(project,input.plan),sessionId=randomUUID();
      const session={sessionId,planId:plan.id,inputRevision:projectRevision(project),planFingerprint:fingerprint(plan),members:[...plan.members],decisions:new Map(),closed:false};
      if(input.previousSessionId!==undefined)close(input.previousSessionId);
      if(sessions.size>=128)sessions.delete(sessions.keys().next().value);
      sessions.set(sessionId,session);return snapshot(session);
    },
    decide(input){
      request(input,['sessionId','project','plan','actorId','action']);
      nonempty(input.sessionId,'Session ID');nonempty(input.actorId,'Actor ID');
      if(!['approve','decline'].includes(input.action))throw new ReviewError('invalid_action','Choose approve or decline.');
      const session=sessions.get(input.sessionId);
      if(!session)throw new ReviewError('unknown_session','This review session is no longer available. Start a new review.',409);
      if(session.closed)throw new ReviewError('closed_session','This review session was retired. Start a new review.',409);
      if(!session.members.includes(input.actorId))throw new ReviewError('actor_not_required','This person is not a participant in the chosen plan.');
      let project;
      try{project=canonicalProject(input.project);}catch{close(input.sessionId);throw new ReviewError('stale_review','The project changed or is invalid. Previous simulated approvals were cleared.',409);}
      if(projectRevision(project)!==session.inputRevision){close(input.sessionId);throw new ReviewError('stale_review','The project changed. Previous simulated approvals were cleared.',409);}
      let plan;
      try{plan=canonicalPlan(project,input.plan);}catch{close(input.sessionId);throw new ReviewError('stale_review','The chosen plan changed or is invalid. Start a new review.',409);}
      if(fingerprint(plan)!==session.planFingerprint){close(input.sessionId);throw new ReviewError('stale_review','The chosen schedule changed. Previous simulated approvals were cleared.',409);}
      const previous=session.decisions.get(input.actorId);
      if(previous?.action!==input.action)session.decisions.set(input.actorId,{action:input.action,at:new Date().toISOString()});
      return snapshot(session);
    },
    retire(input){request(input,['sessionId']);nonempty(input.sessionId,'Session ID');close(input.sessionId);return{mode:'simulated',sessionId:input.sessionId,retired:true};}
  };
}
export function importDemo(raw){
  if(!record(raw)||raw.format!=='loopkind-demo'||raw.version!==1||raw.mode!=='local-demo')throw new ImportError('invalid_envelope','Expected a version 1 LOOPKIND local-demo export.');
  try{
    const project=canonicalProject(raw.project),selectedPlan=raw.selectedPlan===undefined||raw.selectedPlan===null?null:canonicalPlan(project,raw.selectedPlan);
    return copy({format:'loopkind-demo',version:1,mode:'local-demo',project,selectedPlan,approvals:[],history:[],reviewReset:true});
  }catch(error){if(error instanceof ReviewError)throw new ImportError(error.code,error.message,error.status);throw new ImportError('invalid_import','The import could not be validated.');}
}
