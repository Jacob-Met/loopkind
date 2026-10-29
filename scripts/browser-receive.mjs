import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from '../server.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LOOPKIND_PLAYWRIGHT||'playwright');
const out=new URL('../artifacts/browser/',import.meta.url);await mkdir(out,{recursive:true});
const server=await createServer({port:0}),base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.LOOPKIND_CHROME||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
const checks=[],errors=[],external=[];
async function waitUntil(predicate){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await predicate())return;await new Promise(r=>setTimeout(r,60));}throw new Error('Browser condition timed out');}
const contexts=[];
function record(page){page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base))external.push(r.url());});}
async function context(options){const c=await browser.newContext(options);contexts.push(c);const p=await c.newPage();record(p);await p.goto(base,{waitUntil:'networkidle'});await p.locator('[data-member="mara"]').waitFor();return p;}
async function plan(page){
 await page.locator('#find-plan-btn').click();
 await page.locator('#review-status').waitFor({timeout:15000});
 assert.match(await page.locator('#review-status').innerText(),/Waiting for \d of \d demo approvals/);
}
async function scenario(page,value){
 await page.locator('#scenario').selectOption(value);
 if(value==='four')await waitUntil(async()=>await page.locator('[data-member]').count()===4);
 else if(value==='circular')await waitUntil(async()=>await page.locator('[data-member]').count()===3&&(await Promise.all(['mara','theo','jules'].map(id=>page.locator('#'+id+'-after').inputValue()))).every(v=>v==='true'));
 else if(value==='tight')await waitUntil(async()=>await page.locator('#mara-end-0').inputValue()==='10:00');
 else await waitUntil(async()=>await page.locator('[data-member]').count()===3&&await page.locator('#theo-after').inputValue()==='false'&&await page.locator('#mara-end-0').inputValue()==='11:00');
}
async function receiveSaveOrdering(){
 const page=await context(),key='loopkind.local-demo.v1',failures=[];
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
 const planDelivery=deferred(),oldDelivery=deferred(),oldReady=deferred();
 const bounded=async(promise,label)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),15000);})]);}finally{clearTimeout(timer);}};
 const savedPlan=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null')?.selectedPlan??null,key);
 let planStarted=false,oldCaptured=false,oldEnvelope;
 await page.evaluate(()=>{
  window.__oldSaveConsumed=false;const originalFetch=window.fetch;
  window.fetch=async function(...args){
   const response=await originalFetch.apply(this,args);
   if(response.headers.get('x-loopkind-regression-old')==='1'){
    const originalJson=response.json.bind(response);
    response.json=async()=>{const value=await originalJson();setTimeout(()=>{window.__oldSaveConsumed=true;},0);return value;};
   }
   return response;
  };
 });
 try{
  await page.route('**/api/plan',async route=>{
   if(planStarted)return route.continue();planStarted=true;
   try{const response=await route.fetch();assert.ok(response.ok());await planDelivery.promise;await route.fulfill({response});}
   catch(error){failures.push(String(error));await route.abort().catch(()=>{});}
  });
  await page.route('**/api/import',async route=>{
   const request=route.request();let body;try{body=request.postDataJSON();}catch{return route.continue();}
   if(!planStarted||oldCaptured||request.method()!=='POST'||body?.selectedPlan!=null)return route.continue();
   oldCaptured=true;
   try{
    const response=await route.fetch();assert.ok(response.ok());oldEnvelope=await response.json();assert.equal(oldEnvelope.selectedPlan,null);
    oldReady.resolve();await oldDelivery.promise;
    await route.fulfill({response,headers:{...response.headers(),'x-loopkind-regression-old':'1'}});
   }catch(error){failures.push(String(error));oldReady.resolve();await route.abort().catch(()=>{});}
  });
  await page.locator('#find-plan-btn').click();
  await bounded(oldReady.promise,'Project-only save was not captured while plan delivery was held');
  assert.deepEqual(failures,[]);assert.ok(oldCaptured&&oldEnvelope);
  planDelivery.resolve();
  await page.waitForFunction(key=>{try{return!!JSON.parse(localStorage.getItem(key))?.selectedPlan;}catch{return false;}},key,{timeout:15000});
  const expected=await savedPlan(),rows=await page.locator('.timeline-row').count();assert.ok(expected&&rows>0);
  oldDelivery.resolve();
  await page.waitForFunction(()=>window.__oldSaveConsumed===true,null,{timeout:15000});
  assert.deepEqual(failures,[]);
  assert.deepEqual(await savedPlan(),expected,'Consumed older save must not replace the newer saved plan');
  assert.equal(await page.locator('.timeline-row').count(),rows);
  assert.match(await page.locator('#save-status').innerText(),/^Saved here/);
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-member="mara"]').waitFor();
  assert.deepEqual(await savedPlan(),expected,'Exact selected plan must survive reopening after reordered saves');
  assert.equal(await page.locator('.timeline-row').count(),rows);
  checks.push('same-epoch autosave: consumed old response cannot erase the saved and reopened plan');
 }finally{planDelivery.resolve();oldDelivery.resolve();}
}

async function receiveEndOfDay(){
 const page=await context({viewport:{width:1280,height:900}});
 const project=await(await fetch(base+'/api/example')).json();
 for(const member of project.members){member.windows=[{start:1380,end:1440}];member.durationMinutes=15;member.afterReceive=false;}
 const envelope={format:'loopkind-demo',version:1,mode:'local-demo',project,selectedPlan:null};
 const importProject=async(data,start)=>{
  await page.locator('#import-file').setInputFiles({name:'boundary-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.waitForFunction(start=>document.querySelector('#mara-start-0')?.value===start,start);
 };
 const expand=async()=>{
  const card=page.locator('[data-member="mara"]');
  if(await card.evaluate(card=>card.open))return;
  await card.evaluate(card=>{window.__boundaryOpened=false;card.addEventListener('toggle',()=>{if(card.open)window.__boundaryOpened=true;},{once:true});});
  await card.locator('summary').click();
  await page.waitForFunction(()=>window.__boundaryOpened===true&&document.querySelector('[data-member="mara"]').open);
 };
 const exported=async filename=>{
  const pending=page.waitForEvent('download');await page.locator('#export-btn').click();const download=await pending;
  await download.saveAs(new URL(filename,out).pathname);return JSON.parse(await readFile(new URL(filename,out),'utf8'));
 };
 await importProject(envelope,'23:00');
 for(const member of project.members){
  const end=page.getByLabel(member.name+' available until 1',{exact:true});
  assert.equal(await end.inputValue(),'24:00');
  assert.equal(await end.locator('option:checked').textContent(),'24:00');
  const hintId=await end.getAttribute('aria-describedby');assert.ok(hintId);
  assert.match(await page.locator('#'+hintId).textContent(),/24:00 means the end of this day\./);
 }
 const response=page.waitForResponse(r=>r.url()===base+'/api/plan');await plan(page);
 const result=await(await response).json();
 assert.equal(await page.locator('.timeline-row').count(),3);
 assert.ok(result.plans[0].tasks.every(task=>task.start>=1380&&task.end<=1440));
 await expand();
 await page.locator('[data-member="mara"]').screenshot({path:new URL('end-of-day-desktop.png',out).pathname});
 await page.getByLabel('Mara available until 1',{exact:true}).selectOption('23:45');
 assert.equal(await page.locator('#review-status').count(),0);
 assert.ok(await page.locator('[data-member="mara"]').evaluate(card=>card.open),'Editing an expanded card must preserve it');
 assert.doesNotMatch(await page.locator('#mara-window-hint').textContent(),/24:00 means/);
 await page.getByLabel('Mara available until 1',{exact:true}).selectOption('24:00');
 assert.match(await page.locator('#mara-window-hint').textContent(),/24:00 means the end of this day\./);
 const edited=await exported('end-of-day-edit-export.json'),mara=edited.project.members.find(member=>member.id==='mara');
 assert.equal(mara.windows[0].end,1440);assert.equal(mara.confirmed,false);assert.equal(edited.selectedPlan,null);
 for(const member of project.members)member.windows=[{start:0,end:1440}];
 await importProject(envelope,'00:00');
 assert.equal(await page.locator('#mara-end-0').inputValue(),'24:00');
 const allDay=await exported('all-day-export.json');
 assert.deepEqual(allDay.project.members.find(member=>member.id==='mara').windows,[{start:0,end:1440}]);
 await page.setViewportSize({width:390,height:844});await expand();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'End-of-day controls must fit on mobile');
 assert.ok(await page.locator('#mara-window-hint').isVisible());
 const control=await page.locator('#mara-end-0').boundingBox(),card=await page.locator('[data-member="mara"]').boundingBox();
 assert.ok(control.x>=card.x&&control.x+control.width<=card.x+card.width);
 await page.locator('[data-member="mara"]').screenshot({path:new URL('end-of-day-mobile.png',out).pathname});
 checks.push('end-of-day availability: visible 24:00, edited export 1440, distinct all-day bounds, and 390px layout');
}

try{
 const page=await context({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await plan(page);
 assert.equal(await page.locator('.timeline-row').count(),3);
 const timeline=await page.locator('#timeline').innerText();
 for(const text of['09:00–09:30','09:30–10:15','10:15–10:45','45 min'])assert.ok(timeline.includes(text),text);
 for(const[id,index]of[['jules',0],['theo',1],['mara',2]]){
  await page.locator('#review-person').selectOption(id);await page.locator('#approve-btn').click();
  await waitUntil(async()=>await page.locator('.roster-item.approved').count()===index+1);
 }
 assert.equal(await page.locator('#review-status').innerText(),'All 3 approved this demo proposal.');
 checks.push('three-person timeline and all named simulated approvals');
 await page.screenshot({path:new URL('desktop-full.png',out).pathname,fullPage:true});
 await page.locator('#workbench').screenshot({path:new URL('desktop-workbench.png',out).pathname});
 const downloadPromise=page.waitForEvent('download');await page.locator('#export-btn').click();const download=await downloadPromise;
 await download.saveAs(new URL('export.json',out).pathname);
 const exported=JSON.parse(await readFile(new URL('export.json',out),'utf8'));
 assert.equal(exported.format,'loopkind-demo');assert.deepEqual(exported.approvals,[]);assert.equal(exported.selectedPlan.tasks.length,3);
 const fresh=await context({viewport:{width:1280,height:900}});
 const poisoned=structuredClone(exported);poisoned.approvals=poisoned.selectedPlan.members.map(memberId=>({memberId,approved:true}));poisoned.history=[{actualConsent:true}];poisoned.ready=true;poisoned.sessionId='forged-session';
 await fresh.locator('#import-file').setInputFiles({name:'shared-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(poisoned))});
 await fresh.locator('#review-status').waitFor();assert.equal(await fresh.locator('.roster-item.approved').count(),0);
 assert.match(await fresh.locator('#review-status').innerText(),/Waiting for 3 of 3/);
 checks.push('actual export and fresh-browser import with forged approvals reset');
 const title=await fresh.locator('#project-title').inputValue();
 await fresh.locator('#review-person').selectOption('mara');await fresh.locator('#approve-btn').click();
 await waitUntil(async()=>await fresh.locator('.roster-item.approved').count()===1);
 await fresh.locator('#project-title').fill('Changed briefly');assert.equal(await fresh.locator('#review-status').count(),0);
 await fresh.locator('#project-title').fill(title);await plan(fresh);
 assert.equal(await fresh.locator('.roster-item.approved').count(),0);
 checks.push('edit then exact reversion does not resurrect approvals');
 await fresh.locator('#review-person').selectOption('mara');await fresh.locator('#withdraw-btn').click();
 assert.equal(await fresh.locator('#review-status').count(),0);
 await fresh.locator('#find-plan-btn').click();await fresh.locator('.explanation').waitFor();
 assert.match(await fresh.locator('.explanation').innerText(),/Mara: withdrawn/);
 checks.push('withdrawal immediately clears proposal and blocks the old circle');
 for(const value of['circular','tight']){
  await scenario(fresh,value);await fresh.locator('#find-plan-btn').click();await fresh.locator('.explanation').waitFor();
  const text=await fresh.locator('.explanation').innerText();
  assert.ok(value==='circular'?text.includes('Nobody can start'):text.includes('45 uninterrupted minutes')&&text.includes('30 minutes'));
 }
 checks.push('browser explains circular prerequisites and insufficient shared time');
 await scenario(page,'four');await plan(page);assert.equal(await page.locator('.timeline-row').count(),4);
 await page.locator('#workbench').screenshot({path:new URL('four-person-workbench.png',out).pathname});
 checks.push('four-person parallel plan is displayed');
 const mobile=await context({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await plan(mobile);
 assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile page must not overflow horizontally');
 assert.equal(await mobile.locator('.timeline-row').count(),3);
 await mobile.screenshot({path:new URL('mobile-full.png',out).pathname,fullPage:true});
 checks.push('390px mobile layout fits and displays all commitments');
 const race=await context({viewport:{width:1280,height:900}});
 let releaseStart,seenStart;
 const startGate=new Promise(r=>{releaseStart=r;}),startSeen=new Promise(r=>{seenStart=r;});
 let staleSession;
 await race.route('**/api/review-start',async route=>{
  const response=await route.fetch();staleSession=(await response.json()).sessionId;seenStart();
  await startGate;await route.fulfill({response}).catch(()=>{});
 });
 await race.locator('#find-plan-btn').click();await startSeen;
 await race.locator('#project-title').fill('Edited while review opens');
 const retired=race.waitForResponse(r=>r.url()===base+'/api/review-retire'&&r.request().postDataJSON()?.sessionId===staleSession);
 releaseStart();await retired;
 assert.equal(await race.locator('#review-status').count(),0);
 await race.unroute('**/api/review-start');
 checks.push('late review-start response retires its own stale session');
 await plan(race);
 let releaseDecision,seenDecision;
 const decisionGate=new Promise(r=>{releaseDecision=r;}),decisionSeen=new Promise(r=>{seenDecision=r;});
 await race.route('**/api/review',async route=>{const response=await route.fetch();seenDecision();await decisionGate;await route.fulfill({response}).catch(()=>{});});
 await race.locator('#approve-btn').click();await decisionSeen;
 const raceTitle=await race.locator('#project-title').inputValue();
 await race.locator('#project-title').fill('Edited while approval returns');
 await race.locator('#project-title').fill(raceTitle);releaseDecision();
 await race.unroute('**/api/review',{behavior:'wait'});
 assert.equal(await race.locator('#review-status').count(),0);
 await plan(race);assert.equal(await race.locator('.roster-item.approved').count(),0);
 checks.push('late approval response cannot restore readiness after edit and revert');
 await receiveSaveOrdering();
 await receiveEndOfDay();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={ok:true,mode:'local-demo',checks,jsErrors:errors,externalRequests:external,providerCalled:false,artifacts:['desktop-full.png','desktop-workbench.png','four-person-workbench.png','mobile-full.png','export.json','end-of-day-desktop.png','end-of-day-mobile.png','end-of-day-edit-export.json','all-day-export.json']};
 await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{for(const c of contexts)await c.close();await browser.close();await new Promise(r=>server.close(r));}
