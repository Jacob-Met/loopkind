const $=s=>document.querySelector(s);
const S={project:null,result:null,plan:null,review:null,actor:null,intake:null,provider:null,draft:null,epoch:0,busyPlan:false,busyReview:false,busyInterpret:false,reason:'',open:new Set()};
const requests=new Set(),retirePending=new Set(),retireFlights=new Map();
const STORAGE='loopkind.local-demo.v1';
let saveTimer,saveRevision=0;
const copy=x=>structuredClone(x);
function node(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function add(parent,...children){for(const child of children)if(child)parent.append(child);return parent;}
function button(text,classes,handler){const b=node('button','button '+classes,text);b.type='button';b.addEventListener('click',handler);return b;}
function option(value,text){const o=node('option','',text);o.value=value;return o;}
function time(minutes){return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');}
function minutes(value){if(!/^\d{2}:\d{2}$/.test(value))return NaN;const[h,m]=value.split(':').map(Number);return h*60+m;}
function person(id){return S.project?.members.find(m=>m.id===id);}
function name(id){return person(id)?.name||id;}
function skill(id){return S.project?.skills.find(s=>s.id===id)?.label||'Needs an answer';}
function tone(id){return 'tone-'+Math.max(0,S.project.members.findIndex(m=>m.id===id))%4;}
function avatar(id){return node('span','avatar '+tone(id),(name(id).trim()[0]||'?').toUpperCase());}
function info(message){const n=$('#notice');n.textContent=message;n.hidden=!message;}
function fail(error){if(error?.name==='AbortError')return;const n=$('#error');n.textContent=error?.message||String(error);n.hidden=false;}
function clearError(){$('#error').hidden=true;$('#error').textContent='';}
async function api(path,body,{cancellable=true,timeout=15000}={}){
 const controller=new AbortController();if(cancellable)requests.add(controller);
 let timedOut=false;
 const timer=setTimeout(()=>{if(!controller.signal.aborted){timedOut=true;controller.abort();}},timeout);
 try{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.error?.message||'The local server could not complete this request.');error.code=data.error?.code;error.status=response.status;throw error;}
  return data;
 }catch(error){
  if(timedOut&&error?.name==='AbortError'){
   const timeoutError=new Error('The local server did not respond in time. Try again; your current changes are still open.');
   timeoutError.code='request_timeout';throw timeoutError;
  }
  throw error;
 }finally{clearTimeout(timer);requests.delete(controller);}
}
function retire(id){
 if(!id)return Promise.resolve();
 retirePending.add(id);
 if(retireFlights.has(id))return retireFlights.get(id);
 const task=api('/api/review-retire',{sessionId:id},{cancellable:false}).then(()=>retirePending.delete(id)).finally(()=>retireFlights.delete(id));
 retireFlights.set(id,task);return task;
}
async function flushRetired(){await Promise.all([...retirePending].map(retire));}
function envelope(){return{format:'loopkind-demo',version:1,mode:'local-demo',project:copy(S.project),selectedPlan:S.plan?copy(S.plan):null,approvals:[],history:[]};}
function scheduleSave(){
 clearTimeout(saveTimer);$('#save-status').classList.remove('save-failed');$('#save-status').textContent='Saving this project…';const epoch=S.epoch,revision=++saveRevision;
 saveTimer=setTimeout(async()=>{
  if(!S.project)return;
  try{
   const safe=await api('/api/import',envelope());
   if(epoch!==S.epoch||revision!==saveRevision)return;
   localStorage.setItem(STORAGE,JSON.stringify({format:safe.format,version:safe.version,mode:safe.mode,project:safe.project,selectedPlan:safe.selectedPlan,approvals:[],history:[]}));
   $('#save-status').textContent='Saved here · reviews reset on reopening';
  }catch(error){
   if(epoch!==S.epoch||revision!==saveRevision||error.name==='AbortError')return;
   const status=$('#save-status');status.classList.add('save-failed');
   status.textContent=error.code==='request_timeout'?'Not saved yet · server response timed out.':'Not saved yet · check the edited fields';
   if(error.code==='request_timeout'){
    const retry=button('Retry save','small quiet',scheduleSave);retry.id='retry-save-btn';status.append(' ',retry);
   }
  }
 },300);
}
function invalidate(reason,{refreshPeople=false}={}){
 const id=S.review?.sessionId;
 S.epoch++;for(const request of requests)request.abort();requests.clear();
 S.result=null;S.plan=null;S.review=null;S.draft=null;
 S.busyPlan=false;S.busyReview=false;S.busyInterpret=false;S.reason=reason;
 if(id)retire(id).catch(()=>{info('Your previous review is cleared here. Reconnect the local server before starting a new review.');});
 clearError();renderPlan();renderDraft();updateButtons();scheduleSave();
 if(refreshPeople)renderPeople();
}
function editMember(id,field,value,{refresh=false}={}){
 const member=person(id);if(!member)return;
 member[field]=value;if(field!=='confirmed')member.confirmed=false;
 invalidate(field==='active'&&!value?member.name+' withdrew. The previous proposal is no longer available.':'Details changed. Find a new plan, then review it together.',{refreshPeople:refresh});
 if(!refresh)refreshMemberSummary(member);
 if(field==='name'){
  for(const entry of $('#intake-person').options)if(entry.value===id)entry.textContent=member.name;
 }
}
function labeled(labelText,control,full=false){
 const label=node('label',full?'full-width':'',labelText);label.htmlFor=control.id;label.append(control);return label;
}
function selectFor(id,values,value,change){
 const select=node('select');select.id=id;
 for(const[v,text]of values)select.append(option(v,text));
 select.value=value===null?'':String(value);select.addEventListener('change',()=>change(select.value));return select;
}
function inputFor(id,type,value,change,event='change'){
 const input=node('input');input.id=id;input.type=type;input.value=value??'';input.addEventListener(event,()=>change(input.value));return input;
}
function availabilityText(member){
 return (member.windows.length?member.windows.map(w=>time(w.start)+'–'+time(w.end)).join(' · '):'Add availability')+(member.durationMinutes?' · gives '+member.durationMinutes+' min':'');
}
function windowHintText(member){
 return 'Use 15-minute boundaries on '+S.project.date+' at UTC'+S.project.utcOffset+'.'+(member.windows.some(window=>window.end===1440)?' 24:00 means the end of this day.':'')+' A session must fit without a break.';
}
function refreshMemberSummary(member){
 const card=[...$('#people-list').children].find(card=>card.dataset.member===member.id);if(!card)return;
 card.classList.toggle('inactive',!member.active);
 card.querySelector('h3').textContent=member.name||'Unnamed person';
 card.querySelector('.avatar').textContent=(member.name.trim()[0]||'?').toUpperCase();
 const state=card.querySelector('.person-state');
 state.className='person-state '+(!member.active?'withdrawn':!member.confirmed?'needs-review':'');
 state.textContent=!member.active?'Withdrawn from this day':member.confirmed?'Details reviewed':'Details need review';
 const skills=card.querySelectorAll('.give-get strong');skills[0].textContent=skill(member.offer);skills[1].textContent=skill(member.need);
 card.querySelector('.availability-summary').textContent=availabilityText(member);
 document.getElementById(member.id+'-window-hint').textContent=windowHintText(member);
 for(const field of ['active','confirmed'])document.getElementById(member.id+'-'+field).checked=member[field];
 card.querySelectorAll('.window-row').forEach((row,index)=>{
  row.querySelector('input').setAttribute('aria-label',member.name+' available from '+(index+1));
  row.querySelector('select').setAttribute('aria-label',member.name+' available until '+(index+1));
  row.querySelector('button').setAttribute('aria-label','Remove '+member.name+' time window '+(index+1));
 });
}
function renderPeople(){
 if(!S.project)return;
 const list=$('#people-list');list.replaceChildren();$('#people-count').textContent=S.project.members.length+' people';
 for(const member of S.project.members){
  const card=node('details','person-card'+(!member.active?' inactive':''));card.dataset.member=member.id;card.open=S.open.has(member.id);
  card.addEventListener('toggle',()=>{if(card.open)S.open.add(member.id);else S.open.delete(member.id);});
  const summary=node('summary'),top=node('div','person-top'),heading=node('div','person-heading');
  add(heading,node('h3','',member.name||'Unnamed person'),node('div','person-state '+(!member.active?'withdrawn':!member.confirmed?'needs-review':''),!member.active?'Withdrawn from this day':member.confirmed?'Details reviewed':'Details need review'));
  add(top,avatar(member.id),heading,node('span','expand-mark','+'));summary.append(top);
  const giveGet=node('div','give-get');
  for(const[label,value]of[['Can give',member.offer],['Would welcome',member.need]]){
   const cell=node('div');add(cell,node('span','mini-label',label),node('strong','',skill(value)));giveGet.append(cell);
  }
  add(summary,giveGet,node('p','availability-summary',availabilityText(member)));
  const form=node('div','member-form'),grid=node('div','field-grid');
  const nameInput=inputFor(member.id+'-name','text',member.name,v=>editMember(member.id,'name',v,{refresh:false}),'input');nameInput.maxLength=80;
  grid.append(labeled('Name',nameInput,true));
  const choices=[['','Needs an answer'],...S.project.skills.map(s=>[s.id,s.label])];
  grid.append(labeled('Can help with',selectFor(member.id+'-offer',choices,member.offer,v=>editMember(member.id,'offer',v||null))));
  grid.append(labeled('Would welcome',selectFor(member.id+'-need',choices,member.need,v=>editMember(member.id,'need',v||null))));
  grid.append(labeled('Time to give',selectFor(member.id+'-duration',[['','Needs an answer'],...Array.from({length:12},(_,i)=>[String((i+1)*15),(i+1)*15+' minutes'])],member.durationMinutes,v=>editMember(member.id,'durationMinutes',v?Number(v):null))));
  grid.append(labeled('Materials or setup',selectFor(member.id+'-materials',[['','Needs an answer'],['true','Ready'],['false','Not ready yet']],member.materialsReady,v=>editMember(member.id,'materialsReady',v===''?null:v==='true'))));
  grid.append(labeled('When can I give?',selectFor(member.id+'-after',[['','Needs an answer'],['true','After I receive my help'],['false','I can give before receiving']],member.afterReceive,v=>editMember(member.id,'afterReceive',v===''?null:v==='true')),true));
  form.append(grid);
  const windowLabel=node('div','window-label','Available in these windows');
  windowLabel.append(button('+ Add time','small quiet',()=>{if(member.windows.length>=16)return;editMember(member.id,'windows',[...member.windows,{start:540,end:660}],{refresh:true});}));
  form.append(windowLabel);
  member.windows.forEach((window,index)=>{
   const row=node('div','window-row'),start=inputFor(member.id+'-start-'+index,'time',time(window.start),v=>{const next=copy(member.windows);next[index].start=minutes(v);editMember(member.id,'windows',next);});
   const end=selectFor(member.id+'-end-'+index,Array.from({length:96},(_,i)=>{const value=time((i+1)*15);return[value,value];}),time(window.end),v=>{const next=copy(member.windows);next[index].end=minutes(v);editMember(member.id,'windows',next);});
   start.step='900';start.setAttribute('aria-label',member.name+' available from '+(index+1));end.setAttribute('aria-label',member.name+' available until '+(index+1));end.setAttribute('aria-describedby',member.id+'-window-hint');
   const remove=button('×','',()=>editMember(member.id,'windows',member.windows.filter((_,i)=>i!==index),{refresh:true}));remove.className='icon-button';remove.setAttribute('aria-label','Remove '+member.name+' time window '+(index+1));
   add(row,start,node('span','','–'),end,remove);form.append(row);
  });
  const windowHint=node('p','field-hint',windowHintText(member));windowHint.id=member.id+'-window-hint';form.append(windowHint);
  const checks=node('div','checks');
  for(const[field,text]of[['active','Include me in this day'],['confirmed','I have checked my offer, time and requirements']]){
   const label=node('label','check-label'+(field==='confirmed'?' review-check':'')),input=node('input');input.type='checkbox';input.id=member.id+'-'+field;input.checked=member[field];input.addEventListener('change',()=>editMember(member.id,field,input.checked));
   add(label,input,node('span','',text));checks.append(label);
  }
  form.append(checks);add(card,summary,form);list.append(card);
 }
 $('#add-person-btn').disabled=S.project.members.length>=12;
 $('#skill-list').replaceChildren(...S.project.skills.map(s=>node('span','skill-tag',s.label)));
}
function updateButtons(){
 $('#find-plan-btn').disabled=!S.project||S.busyPlan;
 $('#find-plan-btn').textContent=S.busyPlan?'Finding a shared plan…':'Find a shared plan ↗';
 $('#interpret-btn').disabled=!S.project||!S.provider?.configured||S.busyInterpret||!S.intake;
 $('#interpret-btn').textContent=S.busyInterpret?'Reading this note…':'Suggest fields from this note';
}
function renderProject(){
 $('#project-title').value=S.project.title;$('#project-date').value=S.project.date;$('#project-offset').value=S.project.utcOffset;
 renderPeople();renderPlan();renderIntake();renderDraft();updateButtons();
}

function renderPlan(){
 const root=$('#plan-content');root.replaceChildren();
 if(!S.plan){
  if(S.result){renderNoPlan(root);return;}
  const empty=node('div','empty-plan');
  add(empty,node('div','empty-symbol','↺'),node('h3','',S.reason?'A fresh look, together.':'Good things go around.'),node('p','',S.reason||'Start with the three neighbours on the left. We will look for a circle and a time they can all keep.'));
  root.append(empty);return;
 }
 const plan=S.plan;
 add(root,add(node('p','plan-success'),node('span','success-dot','✓'),node('span','','A schedule that fits')),
  node('h3','proposal-title',plan.members.length+' people. One circle of help.'),
  node('p','proposal-subtitle',S.project.date+' · '+time(plan.metrics.startsAt)+'–'+time(plan.metrics.finishesAt)+' · UTC'+S.project.utcOffset));
 if(S.result?.plans.length>1){
  const options=node('div','plan-options');
  options.append(labeled('Other workable circles',selectFor('plan-choice',S.result.plans.map((p,i)=>[p.id,'Circle '+(i+1)+' · '+p.members.length+' people · '+time(p.metrics.startsAt)+'–'+time(p.metrics.finishesAt)]),plan.id,id=>choosePlan(id))));root.append(options);
 }
 const strip=node('div','circle-strip');strip.setAttribute('aria-label','Giving order around the circle');
 plan.members.forEach((id,i)=>{const chip=node('span','circle-member');add(chip,avatar(id),node('span','',name(id)));strip.append(chip);if(i<plan.members.length-1)strip.append(node('span','circle-arrow','→'));});
 strip.append(node('span','loop-return','↺ back to '+name(plan.members[0])));root.append(strip);
 const omitted=S.project.members.filter(member=>!plan.members.includes(member.id));
 if(omitted.length){
  const aside=node('aside','circle-omissions');aside.id='circle-omissions';aside.setAttribute('aria-labelledby','circle-omissions-title');
  const heading=node('h4','','Not in this circle');heading.id='circle-omissions-title';aside.append(heading);
  const list=node('ul');
  const labels={unreviewed:'details need review',materials_not_ready:'materials or setup are not confirmed ready',incomplete:'required details are unanswered'};
  for(const member of omitted){
   const blocked=S.result?.blockedMembers.find(item=>item.id===member.id);
   const reason=blocked?.reasons.includes('inactive')?'withdrawn from this day':blocked?blocked.reasons.map(reason=>labels[reason]||reason).join('; '):'not included in this proposal';
   const item=node('li');item.dataset.omittedMember=member.id;
   add(item,node('strong','',member.name),node('span','',reason+'.'));list.append(item);
  }
  aside.append(list);root.append(aside);
 }

 const timeline=node('div','timeline');timeline.id='timeline';
 add(timeline,add(node('div','timeline-title'),node('strong','','Everyone’s time, together'),node('span','','Both people attend each session')));
 const axis=node('div','time-axis');add(axis,node('span','',time(plan.metrics.startsAt)),node('span','',time(Math.round((plan.metrics.startsAt+plan.metrics.finishesAt)/2))),node('span','',time(plan.metrics.finishesAt)));timeline.append(axis);
 const span=plan.metrics.finishesAt-plan.metrics.startsAt;
 for(const task of plan.tasks){
  const row=node('div','timeline-row'),label=node('div','task-label');
  add(label,node('strong','',name(task.providerId)+' → '+name(task.recipientId)),node('span','',skill(task.skill)),node('span','task-time',time(task.start)+'–'+time(task.end)));
  label.lastChild.style.display='block';
  const track=node('div','track'),bar=node('div','task-bar '+tone(task.providerId));
  bar.style.setProperty('--left',((task.start-plan.metrics.startsAt)/span*100)+'%');bar.style.setProperty('--width',((task.end-task.start)/span*100)+'%');
  add(bar,node('strong','',(task.end-task.start)+' min'));
  track.setAttribute('role','img');track.setAttribute('aria-label',name(task.providerId)+' helps '+name(task.recipientId)+' with '+skill(task.skill)+', '+time(task.start)+' to '+time(task.end));track.append(bar);
  add(row,label,track);timeline.append(row);
 }
 const parallel=plan.tasks.some((a,i)=>plan.tasks.some((b,j)=>i<j&&Math.max(a.start,b.start)<Math.min(a.end,b.end)));
 timeline.append(node('p','timeline-caption',parallel?'Some sessions happen together. Their participants are different, so nobody is double-booked.':'Sessions respect the giver’s duration and everyone’s receive-first conditions.'));
 root.append(timeline);
 const review=node('section','review-box');review.id='review-box';review.setAttribute('aria-label','Simulated participant review');
 add(review,node('h3','','Does this work for you?'),node('p','review-intro','Review the complete circle, then try each person’s demo decision.'));
 if(!plan.members.includes(S.actor))S.actor=plan.members[0];
 const selector=node('div','review-selector');selector.append(labeled('Demo view',selectFor('review-person',plan.members.map(id=>[id,name(id)]),S.actor,id=>{S.actor=id;renderPlan();})));review.append(selector);
 const giving=plan.tasks.find(t=>t.providerId===S.actor),receiving=plan.tasks.find(t=>t.recipientId===S.actor),commitments=node('div','my-commitments');
 for(const[label,task,who]of[['You give',giving,'To '+name(giving.recipientId)],['You receive',receiving,'From '+name(receiving.providerId)]]){
  const card=node('div','commitment');add(card,node('span','mini-label',label),node('strong','',skill(task.skill)),node('p','',who),node('p','',time(task.start)+'–'+time(task.end)+' · '+(task.end-task.start)+' min'));commitments.append(card);
 }
 review.append(commitments);
 review.append(node('p','personal-condition',person(S.actor).afterReceive?'Your condition is met: your incoming help finishes before you start giving.':'You said you can give before receiving. This proposal keeps your reviewed time and setup.'));
 if(!S.review){
  const retry=button(S.busyReview?'Opening a fresh demo review…':'Start a fresh demo review','primary',()=>startReview(S.epoch));retry.disabled=S.busyReview;review.append(retry);
 }else{
  const actions=node('div','review-actions'),approve=button('Simulate '+name(S.actor)+'’s approval','primary',()=>decide('approve')),decline=button('Not this plan','decline',()=>decide('decline'));
  approve.id='approve-btn';decline.id='decline-btn';approve.disabled=decline.disabled=S.busyReview;add(actions,approve,decline);review.append(actions);
  const roster=node('div','review-roster');
  for(const id of plan.members){
   const decision=S.review.decisions.find(d=>d.memberId===id)?.action;
   roster.append(node('span','roster-item '+(decision==='approve'?'approved':decision==='decline'?'declined':''),(decision==='approve'?'✓ ':decision==='decline'?'– ':'○ ')+name(id)));
  }
  review.append(roster);
  let status='Waiting for '+S.review.pending.length+' of '+plan.members.length+' demo approvals.';
  if(S.review.status==='approved')status='All '+plan.members.length+' approved this demo proposal.';
  if(S.review.status==='declined')status=S.review.declinedBy.map(name).join(', ')+' needs a different plan. This circle is not approved.';
  const statusLine=node('p','review-status'+(S.review.status==='approved'?' all-approved':''),status);statusLine.id='review-status';statusLine.setAttribute('role','status');review.append(statusLine);
 }
 const withdraw=button('Withdraw '+name(S.actor)+' from this day','',()=>{const id=S.actor;editMember(id,'active',false);info(name(id)+' withdrew. The earlier proposal and simulated approvals are cleared.');});withdraw.className='text-button withdraw-link';withdraw.id='withdraw-btn';review.append(withdraw);
 review.append(node('p','review-footnote','All approvals here are simulations. Changing a detail, choosing another plan or reopening the project starts a new review. No invitations are sent.'));
 root.append(review);
 if(S.result)root.append(node('p','search-note',S.result.search.complete?'Checked '+S.result.search.checkedCycles+' matching circle'+(S.result.search.checkedCycles===1?'':'s')+' on the 15-minute grid. Showing one workable schedule per circle; this is not a proof of the best possible schedule.':'The search reached its limit. These verified schedules are usable proposals; other circles remain unchecked.'));
}
function renderNoPlan(root){
 const result=S.result,box=node('div','explanation');
 add(box,node('h3','',result.search.complete?'No shared plan fits yet.':'The search needs another look.'),node('p','',result.search.complete?'Here is what is getting in the way. The planner keeps everyone’s stated conditions.':'The search reached its limit before every circle was checked. No plan found does not mean a plan is impossible.'));
 const list=node('ul'),seen=new Set();
 for(const rejection of result.rejectedCycles){
  let message;
  if(rejection.reason==='circular_prerequisites')message='Everyone in this circle needs to receive help first. Nobody can start; someone would have to voluntarily change that condition.';
  else if(rejection.reason==='availability'){const d=rejection.detail;message=name(d.providerId)+' → '+name(d.recipientId)+' needs '+d.requiredMinutes+' uninterrupted minutes, but their longest shared window is '+Math.max(0,d.largestSharedWindow)+' minutes.';}
  else if(rejection.reason==='no_schedule')message='The individual sessions have possible times, but they cannot all fit without double-booking someone or breaking a receive-first condition.';
  else if(rejection.reason==='search_limit')message='Some scheduling possibilities remain unchecked because the search reached its limit.';
  if(message&&!seen.has(message)){seen.add(message);list.append(node('li','',message));}
  if(seen.size>=3)break;
 }
 const labels={inactive:'withdrawn',unreviewed:'details need review',materials_not_ready:'materials are not confirmed ready',incomplete:'some required details are unanswered'};
 for(const blocked of result.blockedMembers)list.append(node('li','',name(blocked.id)+': '+blocked.reasons.map(r=>labels[r]||r).join('; ')+'.'));
 if(!result.search.enumeratedCycles)list.append(node('li','','There is no complete 2–4 person circle among the currently eligible offers and requests.'));
 box.append(list);root.append(box);
}
async function startReview(epoch){
 if(!S.plan||epoch!==S.epoch)return;
 const plan=copy(S.plan),project=copy(S.project);S.busyReview=true;renderPlan();
 try{
  await flushRetired();if(epoch!==S.epoch)return;
  const review=await api('/api/review-start',{project,plan},{cancellable:false});
  if(epoch!==S.epoch||S.plan?.id!==plan.id){retire(review.sessionId).catch(()=>{});return;}
  S.review=review;
 }catch(error){if(epoch===S.epoch)fail(error);}
 finally{if(epoch===S.epoch){S.busyReview=false;renderPlan();scheduleSave();}}
}
async function findPlan(){
 if(!S.project||S.busyPlan)return;
 invalidate('Looking for a fresh plan…');const epoch=S.epoch,project=copy(S.project);S.busyPlan=true;updateButtons();
 try{
  const result=await api('/api/plan',project);if(epoch!==S.epoch)return;
  S.project=result.project;S.result=result;S.plan=result.plans[0]||null;S.reason='';renderPeople();renderPlan();renderIntake();
  if(S.plan)await startReview(epoch);
 }catch(error){if(epoch===S.epoch){S.reason='Check the edited details, then try again.';fail(error);renderPlan();}}
 finally{if(epoch===S.epoch){S.busyPlan=false;updateButtons();scheduleSave();}}
}
async function choosePlan(id){
 const plan=S.result?.plans.find(p=>p.id===id);if(!plan||plan.id===S.plan?.id)return;
 const result=S.result;invalidate('');S.result=result;S.plan=plan;renderPlan();await startReview(S.epoch);
}
async function decide(action){
 if(!S.review||!S.plan||S.busyReview)return;
 const epoch=S.epoch,sessionId=S.review.sessionId,planId=S.plan.id,actorId=S.actor;
 const body={sessionId,project:copy(S.project),plan:copy(S.plan),actorId,action};
 S.busyReview=true;renderPlan();clearError();
 try{
  const review=await api('/api/review',body);
  if(epoch!==S.epoch||S.review?.sessionId!==sessionId||S.plan?.id!==planId)return;
  S.review=review;
 }catch(error){
  if(epoch!==S.epoch)return;
  if(error.status===409){S.review=null;retirePending.add(sessionId);}
  fail(error);
 }finally{if(epoch===S.epoch){S.busyReview=false;renderPlan();}}
}

function renderIntake(){
 const select=$('#intake-person');select.replaceChildren();
 if(!S.project)return;
 if(!person(S.intake))S.intake=S.project.members.find(m=>m.id==='mara')?.id||S.project.members[0]?.id||null;
 for(const member of S.project.members)select.append(option(member.id,member.name));
 select.value=S.intake||'';select.disabled=!S.intake;
 $('#intake-text').value=person(S.intake)?.notes||'';$('#intake-text').disabled=!S.intake;
}
function draftValue(field,value){
 if(value===null)return'Needs your answer';
 if(field==='offer'||field==='need')return skill(value);
 if(field==='durationMinutes')return value+' minutes of giving';
 if(field==='windows')return value.map(w=>time(w.start)+'–'+time(w.end)).join(' · ');
 if(field==='afterReceive')return value?'Receive help before giving':'Can give before receiving';
 return value?'Materials or setup ready':'Materials or setup not ready';
}
function renderDraft(){
 const root=$('#draft-preview');root.replaceChildren();if(!S.draft)return;
 const draft=S.draft,box=node('div','draft-preview');
 add(box,node('h3','','A draft for '+name(draft.personId)),node('p','muted','Check every interpretation against the quoted note. Nothing here approves a shared plan.'));
 const labels={offer:'Can give',need:'Would welcome',durationMinutes:'Time to give',windows:'Availability',afterReceive:'When I can give',materialsReady:'Materials or setup'};
 for(const[field,label]of Object.entries(labels)){
  const row=node('div','draft-row');add(row,node('strong','',label),node('p','',draftValue(field,draft.response.proposal[field])));
  for(const evidence of draft.response.evidence.filter(e=>e.field===field))row.append(node('blockquote','',evidence.quote));
  box.append(row);
 }
 if(draft.response.questions.length){const list=node('ul');for(const question of draft.response.questions)list.append(node('li','',question));box.append(list);}
 box.append(button('Apply as unreviewed details','primary',()=>{
  if(S.epoch!==draft.epoch||S.intake!==draft.personId||person(draft.personId)?.notes!==draft.sourceText)return;
  const member=person(draft.personId),proposal=draft.response.proposal;
  for(const field of['offer','need','durationMinutes','afterReceive','materialsReady'])member[field]=proposal[field];
  member.windows=proposal.windows===null?[]:copy(proposal.windows);member.confirmed=false;S.open.add(member.id);
  invalidate('A note draft was applied. Complete and check its details before finding a plan.',{refreshPeople:true});
  info('The draft is now in '+member.name+'’s card. Unanswered fields still need your input, and the details remain unreviewed.');
  document.querySelector('[data-member="'+member.id+'"]')?.scrollIntoView({behavior:'smooth',block:'center'});
 }));
 root.append(box);
}
async function interpret(){
 if(S.busyInterpret||!S.provider?.configured||!S.intake)return;
 const epoch=S.epoch,personId=S.intake,sourceText=person(personId).notes;
 const input={text:sourceText,skills:copy(S.project.skills),date:S.project.date,utcOffset:S.project.utcOffset};
 S.busyInterpret=true;S.draft=null;clearError();renderDraft();updateButtons();
 try{
  const response=await api('/api/interpret',input,{timeout:55000});
  if(epoch!==S.epoch||S.intake!==personId||person(personId)?.notes!==sourceText)return;
  S.draft={response,personId,sourceText,epoch};renderDraft();
 }catch(error){if(epoch===S.epoch&&S.intake===personId)fail(error);}
 finally{if(epoch===S.epoch){S.busyInterpret=false;updateButtons();}}
}
let loadIntent=0;
async function adopt(data,message){
 invalidate('');S.project=data.project;S.plan=data.selectedPlan||null;S.result=null;S.review=null;S.actor=null;S.intake=null;S.open.clear();
 renderProject();info(message);scheduleSave();
 if(S.plan)await startReview(S.epoch);
}
async function openExample(scenario){
 const intent=++loadIntent,epoch=S.epoch;clearError();
 try{
  const project=await api('/api/example?scenario='+encodeURIComponent(scenario));
  if(intent!==loadIntent||epoch!==S.epoch)return;
  await adopt({project,selectedPlan:null},'Example opened. Any earlier proposal and simulated approvals are cleared.');
 }catch(error){if(intent===loadIntent&&epoch===S.epoch)fail(error);}
}
async function openFile(file){
 if(!file)return;
 const intent=++loadIntent,epoch=S.epoch;clearError();
 try{
  if(file.size>128*1024)throw new Error('Choose a LOOPKIND JSON project smaller than 128 KiB.');
  let raw;try{raw=JSON.parse(await file.text());}catch{throw new Error('This file is not valid JSON. Your current project is unchanged.');}
  if(intent!==loadIntent||epoch!==S.epoch)return;
  const safe=await api('/api/import',raw);
  if(intent!==loadIntent||epoch!==S.epoch)return;
  await adopt(safe,'Project opened and checked. Imported approvals were cleared; this is a fresh demo review.');
 }catch(error){if(intent===loadIntent&&epoch===S.epoch)fail(error);}
 finally{$('#import-file').value='';}
}
async function exportProject(){
 if(!S.project)return;
 const epoch=S.epoch;$('#export-btn').disabled=true;clearError();
 try{
  const safe=await api('/api/import',envelope());if(epoch!==S.epoch)return;
  const data={format:safe.format,version:safe.version,mode:safe.mode,project:safe.project,selectedPlan:safe.selectedPlan,approvals:[],history:[]};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),link=node('a');link.href=url;link.download='loopkind-'+S.project.date+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  info('Project exported. It includes the reviewed schedule, when present. Reopening it starts with no approvals.');
 }catch(error){if(epoch===S.epoch)fail(error);}
 finally{$('#export-btn').disabled=false;}
}
$('#find-plan-btn').addEventListener('click',findPlan);
$('#scenario').addEventListener('change',e=>openExample(e.target.value));
$('#project-title').addEventListener('input',e=>{if(!S.project)return;S.project.title=e.target.value;invalidate('The project changed. Find a new plan for a fresh review.');});
for(const[id,field]of[['project-date','date'],['project-offset','utcOffset']]){
 $('#'+id).addEventListener('change',e=>{
  if(!S.project)return;S.project[field]=e.target.value;
  for(const member of S.project.members)member.confirmed=false;
  invalidate('The day or UTC offset changed. Everyone must check their time and requirements again.',{refreshPeople:true});
  info('Please review each person’s availability for the new date and fixed UTC offset.');
 });
}
$('#add-person-btn').addEventListener('click',()=>{
 if(!S.project||S.project.members.length>=12)return;
 const id='p_'+crypto.randomUUID().slice(0,8);
 S.project.members.push({id,name:'New neighbour',active:true,offer:null,need:null,durationMinutes:null,windows:[],afterReceive:null,materialsReady:null,confirmed:false,notes:''});
 S.open.add(id);invalidate('A person was added. Complete their details and find a new plan.',{refreshPeople:true});renderIntake();
});
$('#skill-form').addEventListener('submit',event=>{
 event.preventDefault();if(!S.project)return;
 const label=$('#new-skill').value.trim();if(!label)return;
 if(S.project.skills.length>=24){fail(new Error('This prototype supports up to 24 skill categories.'));return;}
 if(S.project.skills.some(s=>s.label.toLowerCase()===label.toLowerCase())){fail(new Error('That skill is already in the list.'));return;}
 S.project.skills.push({id:'skill_'+crypto.randomUUID().slice(0,8),label});$('#new-skill').value='';
 invalidate('A skill category was added. Find a fresh plan.',{refreshPeople:true});
});
$('#intake-person').addEventListener('change',e=>{S.intake=e.target.value;S.draft=null;renderIntake();renderDraft();updateButtons();});
$('#intake-text').addEventListener('input',e=>{
 const member=person(S.intake);if(!member)return;
 member.notes=e.target.value;member.confirmed=false;
 invalidate('A note changed. Check that person’s details before finding a new plan.',{refreshPeople:true});
});
$('#interpret-btn').addEventListener('click',interpret);
$('#export-btn').addEventListener('click',exportProject);
$('#import-btn').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',e=>openFile(e.target.files[0]));
async function initialize(){
 updateButtons();
 const providerTask=api('/api/status',undefined,{cancellable:false}).then(data=>{
  S.provider=data.provider;
  $('#provider-status').textContent=data.provider.configured?'Optional NVIDIA interpretation on Nebius is configured. Every suggestion still needs your review.':'Optional note interpretation is not configured on this server. You can enter and review every field manually.';
  updateButtons();
 }).catch(()=>{$('#provider-status').textContent='Optional note interpretation is unavailable. You can use the manual fields.';});
 try{
  let saved=null,restored=false;
  try{saved=localStorage.getItem(STORAGE);}catch{}
  if(saved){
   try{const safe=await api('/api/import',JSON.parse(saved));S.project=safe.project;S.plan=safe.selectedPlan;restored=true;info('Your saved project is open. All simulated approvals have been reset.');}
   catch(error){if(error.name==='AbortError')throw error;info('The previous saved project could not be opened. An example is shown; check the fields before saving new work.');}
  }
  if(!S.project)S.project=await api('/api/example?scenario=three');
  renderProject();$('#save-status').textContent=restored?'Saved project reopened · fresh review':'Example open · changes save in this browser';
  if(S.plan)await startReview(S.epoch);
 }catch(error){fail(error);$('#save-status').textContent='Unable to open the local workbench';}
 await providerTask;
}
initialize();
