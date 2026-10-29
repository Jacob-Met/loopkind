import test from 'node:test';
import assert from 'node:assert/strict';
import {createNebiusProvider,validateInterpretRequest,validateModelProposal,NEBIUS_CHAT_URL,DEFAULT_MODEL} from '../src/provider.mjs';
const KEY='fixture-only-not-a-real-key',ENV={LOOPKIND_NEBIUS_API_KEY:KEY,LOOPKIND_NEBIUS_MODEL:'nvidia/test-fixture'};
const hasCode=code=>error=>error.code===code;
const NOTE='I can mend clothing for 45 minutes. I need help with plant care. On 31 October 2026, I am free from 09:00 to 11:00 at UTC−07:00. I will only start mending after I receive the plant help. My sewing kit and the jacket are ready.';
function fixture(){return{
 request:{text:NOTE,skills:[{id:'mending',label:'Clothing repair'},{id:'plants',label:'Plant care'}],date:'2026-10-31',utcOffset:'-07:00'},
 raw:{offer:'mending',need:'plants',durationMinutes:45,windows:[{start:540,end:660}],afterReceive:true,materialsReady:true,evidence:[
 {field:'offer',quote:'I can mend clothing for 45 minutes.'},{field:'need',quote:'I need help with plant care.'},
 {field:'durationMinutes',quote:'I can mend clothing for 45 minutes.'},{field:'windows',quote:'On 31 October 2026, I am free from 09:00 to 11:00 at UTC−07:00.'},
 {field:'afterReceive',quote:'I will only start mending after I receive the plant help.'},{field:'materialsReady',quote:'My sewing kit and the jacket are ready.'}],questions:[]}
};}
function rewrite(f,from,to){f.request.text=f.request.text.replaceAll(from,to);f.raw.evidence=f.raw.evidence.map(e=>({...e,quote:e.quote.replaceAll(from,to)}));return f;}
function unknownRaw(){return{offer:null,need:null,durationMinutes:null,windows:null,afterReceive:null,materialsReady:null,evidence:[],questions:['What would you like to offer, receive, and arrange?']};}
const receive=f=>validateModelProposal(f.raw,validateInterpretRequest(f.request));
function response(raw=fixture().raw,{finish='stop',id='chatcmpl-fixture-123'}={}){
 return new Response(JSON.stringify({id,choices:[{finish_reason:finish,message:{content:JSON.stringify(raw)}}]}),{status:200,headers:{'content-type':'application/json','x-request-id':'request-fixture-123'}});
}
test('consumer note: exact source evidence, English date, Unicode minus, and draft-only result',()=>{
 const result=receive(fixture());assert.deepEqual(result.proposal,{offer:'mending',need:'plants',durationMinutes:45,windows:[{start:540,end:660}],afterReceive:true,materialsReady:true,confirmed:false});assert.deepEqual(result.evidence,fixture().raw.evidence);assert.deepEqual(result.questions,[]);
});
test('unknown facts remain null and cannot silently become false or ready',()=>{
 const f=fixture();f.request.text='I would like to learn more about this group.';f.raw=unknownRaw();const result=receive(f);
 for(const field of['offer','need','durationMinutes','windows','afterReceive','materialsReady'])assert.equal(result.proposal[field],null);
 assert.equal(result.proposal.confirmed,false);f.raw.questions=[];assert.throws(()=>receive(f),hasCode('provider_invalid_response'));
});
test('explicit false is retained and needs its own quote',()=>{
 const f=fixture();f.request.text='I can give before I receive help. My materials are not ready.';
 f.raw={...unknownRaw(),afterReceive:false,materialsReady:false,evidence:[{field:'afterReceive',quote:'I can give before I receive help.'},{field:'materialsReady',quote:'My materials are not ready.'}]};
 assert.equal(receive(f).proposal.afterReceive,false);assert.equal(receive(f).proposal.materialsReady,false);
 f.raw.evidence=f.raw.evidence.filter(e=>e.field!=='afterReceive');assert.throws(()=>receive(f),hasCode('provider_invalid_response'));
});
test('invented quotes, duplicate evidence, unknown skills, and model-controlled confirmation are rejected',()=>{
 for(const mutate of[f=>{f.raw.evidence[0].quote='I am delighted to provide clothing repair.';},f=>{f.raw.evidence.push({...f.raw.evidence[0]});},f=>{f.raw.offer='not-in-the-skill-catalog';},f=>{f.raw.confirmed=true;},f=>{f.raw.active=true;},f=>{f.raw.name='Invented participant';}]){
  const f=fixture();mutate(f);assert.throws(()=>receive(f),hasCode('provider_invalid_response'));
 }
});
test('20-minute source duration stays unknown; it cannot be accepted or rounded',()=>{
 const f=rewrite(fixture(),'45 minutes','20 minutes');f.raw.durationMinutes=null;f.raw.evidence=f.raw.evidence.filter(e=>e.field!=='durationMinutes');f.raw.questions=['Could your outgoing session use an exact 15-minute increment?'];assert.equal(receive(f).proposal.durationMinutes,null);
 f.raw.evidence.push({field:'durationMinutes',quote:'I can mend clothing for 20 minutes.'});
 for(const duration of[20,15,30]){f.raw.durationMinutes=duration;assert.throws(()=>receive(f),hasCode('provider_invalid_response'));}
});
test('unambiguous spelled duration supports 90 minutes without rounding',()=>{const f=rewrite(fixture(),'45 minutes','one and a half hours');f.raw.durationMinutes=90;assert.equal(receive(f).proposal.durationMinutes,90);});
test('source date and fixed offset cannot be reinterpreted',()=>{
 for(const mutate of[f=>{f.request.date='2026-11-01';},f=>{f.request.utcOffset='-06:00';},f=>rewrite(f,'31 October 2026','1 November 2026'),f=>rewrite(f,'On 31 October 2026','Tomorrow'),f=>rewrite(f,'UTC−07:00','UTC+07:00')]){
  const f=fixture();mutate(f);assert.throws(()=>receive(f),hasCode('provider_invalid_response'));
 }
});
test('separate availability intervals cannot be bridged',()=>{
 const f=rewrite(fixture(),'09:00 to 11:00','09:00 to 09:15 and 09:45 to 10:00');f.raw.windows=[{start:540,end:600}];assert.throws(()=>receive(f),hasCode('provider_invalid_response'));
 f.raw.windows=[{start:540,end:555},{start:585,end:600}];assert.deepEqual(receive(f).proposal.windows,f.raw.windows);
});
test('window boundaries cannot be rounded or cross midnight',()=>{
 const a=rewrite(fixture(),'09:00 to 11:00','09:05 to 11:00');assert.throws(()=>receive(a),hasCode('provider_invalid_response'));
 const b=rewrite(fixture(),'09:00 to 11:00','23:00 to 01:00');b.raw.windows=[{start:1380,end:1440}];assert.throws(()=>receive(b),hasCode('provider_invalid_response'));
});
test('request bounds reject ambiguous offsets, impossible dates, duplicate skills, and oversized notes',()=>{
 for(const changes of[{utcOffset:'-07:10'},{utcOffset:'+14:15'},{utcOffset:0},{date:'2026-02-30'},{text:'x'.repeat(3001)},{skills:[{id:'same',label:'A'},{id:'same',label:'B'}]}])assert.throws(()=>validateInterpretRequest({...fixture().request,...changes}),hasCode('invalid_interpret_request'));
});
// Every transport below is injected. These fixtures make no Nebius request or live-access claim.
test('missing credentials and non-NVIDIA model configurations never dispatch',async()=>{
 for(const env of[{}, {...ENV,LOOPKIND_NEBIUS_MODEL:'other/model'}]){
  let calls=0;const p=createNebiusProvider({env,fetchImpl:async()=>{calls++;return response();}});
  assert.equal(p.status().configured,false);assert.equal(p.status().verified,false);await assert.rejects(p.interpret(fixture().request),e=>e.status===503&&e.code==='provider_unconfigured');assert.equal(calls,0);
 }
 for(const alias of['LOOPKIND_NEBIUS_API_KEY','NEBIUS_API_KEY','NEBIUS_TOKEN_FACTORY_API_KEY']){
  const p=createNebiusProvider({env:{[alias]:KEY},fetchImpl:async()=>response()});assert.equal(p.status().configured,true);assert.equal(p.status().model,DEFAULT_MODEL);assert.ok(!JSON.stringify(p.status()).includes(KEY));
 }
});
test('injected upstream contract sends only source/catalog/date/offset and returns a draft',async()=>{
 let calls=0;const f=fixture(),p=createNebiusProvider({env:ENV,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,NEBIUS_CHAT_URL);assert.equal(url,'https://api.tokenfactory.us-central1.nebius.com/v1/chat/completions');assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+KEY);assert.ok(options.signal instanceof AbortSignal);
  const body=JSON.parse(options.body);assert.equal(body.model,'nvidia/test-fixture');assert.equal(body.stream,false);assert.equal(body.max_tokens,1600);assert.equal(body.response_format,undefined);assert.equal(body.messages.length,2);assert.equal(body.messages[0].role,'system');assert.equal(body.messages[1].role,'user');assert.deepEqual(JSON.parse(body.messages[1].content),f.request);assert.ok(!options.body.includes('private-future-outcome'));return response(f.raw);
 }});
 const result=await p.interpret({...f.request,hiddenFuture:'private-future-outcome',active:true,confirmed:true});assert.equal(calls,1);assert.equal(result.proposal.confirmed,false);assert.deepEqual(result.provider,{model:'nvidia/test-fixture',requestId:'request-fixture-123',verified:true});assert.equal(p.status().verified,false);assert.ok(!JSON.stringify(result).includes(KEY));
});
test('invalid request is rejected before any provider call',async()=>{
 let calls=0;const p=createNebiusProvider({env:ENV,fetchImpl:async()=>{calls++;return response();}});
 await assert.rejects(p.interpret({...fixture().request,text:''}),hasCode('invalid_interpret_request'));assert.equal(calls,0);
});
test('upstream auth, rate limits, and failures stay distinct, safe, and unretried',async()=>{
 for(const[status,expectedStatus,expectedCode]of[[401,502,'provider_auth_failed'],[403,502,'provider_auth_failed'],[429,429,'provider_rate_limited'],[500,502,'provider_failed']]){
  let calls=0;const p=createNebiusProvider({env:ENV,fetchImpl:async()=>{calls++;return new Response('sensitive upstream detail: '+KEY,{status});}});
  await assert.rejects(p.interpret(fixture().request),e=>{assert.equal(e.status,expectedStatus);assert.equal(e.code,expectedCode);assert.ok(!e.message.includes(KEY));assert.ok(!e.message.includes('sensitive upstream'));return true;});assert.equal(calls,1);
 }
});
test('non-JSON HTTP body and malformed model JSON cannot produce a proposal',async()=>{
 for(const makeResponse of[()=>new Response('not JSON: sensitive detail'),()=>new Response(JSON.stringify({choices:[{message:{content:'Here is a draft: not JSON'}}]})),()=>response({...fixture().raw,confirmed:true}),()=>new Response(JSON.stringify({choices:[]}))]){
  const p=createNebiusProvider({env:ENV,fetchImpl:async()=>makeResponse()});await assert.rejects(p.interpret(fixture().request),e=>e.code==='provider_invalid_response'&&!e.message.includes('sensitive detail'));
 }
});
test('token truncation is rejected even if partial content looks like valid JSON',async()=>{
 const p=createNebiusProvider({env:ENV,fetchImpl:async()=>response(fixture().raw,{finish:'length'})});await assert.rejects(p.interpret(fixture().request),hasCode('provider_incomplete'));
});
test('oversized upstream stream is canceled at the bound, not fully buffered',async()=>{
 let canceled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(65536));c.enqueue(new Uint8Array(65536));c.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
 const p=createNebiusProvider({env:ENV,fetchImpl:async()=>new Response(stream)});await assert.rejects(p.interpret(fixture().request),hasCode('provider_invalid_response'));assert.equal(canceled,true);
});
test('timeout aborts once, returns no proposal, and reports uncertain upstream usage',async()=>{
 let calls=0,signal;const p=createNebiusProvider({env:ENV,timeoutMs:5,fetchImpl:async(_url,options)=>{calls++;signal=options.signal;return new Promise((_r,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('fixture timeout')),{once:true}));}});
 await assert.rejects(p.interpret(fixture().request),e=>{assert.equal(e.status,504);assert.equal(e.code,'provider_timeout');assert.match(e.message,/another request may incur provider usage/i);return true;});assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('network errors are safe and not automatically retried',async()=>{
 let calls=0;const p=createNebiusProvider({env:ENV,fetchImpl:async()=>{calls++;throw new Error('private network detail: '+KEY);}});
 await assert.rejects(p.interpret(fixture().request),e=>e.code==='provider_unreachable'&&!e.message.includes(KEY));assert.equal(calls,1);
});
test('unsafe upstream request identifiers are withheld',async()=>{
 const p=createNebiusProvider({env:ENV,fetchImpl:async()=>new Response(JSON.stringify({id:'<unsafe request identifier>',choices:[{finish_reason:'stop',message:{content:JSON.stringify(fixture().raw)}}]}),{headers:{'x-request-id':'unsafe request id with spaces'}})});
 const result=await p.interpret(fixture().request);assert.equal(result.provider.requestId,null);assert.equal(result.proposal.confirmed,false);
});
