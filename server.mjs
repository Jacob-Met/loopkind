import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findPlans, InputError } from './src/planner.mjs';
import { createNebiusProvider, ProviderError } from './src/provider.mjs';
import { createReviewBook, importDemo, ReviewError } from './src/review.mjs';
import { exampleProject } from './src/example.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 128 * 1024;
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
function json(res, status, value, extra={}) {
  const data=JSON.stringify(value);
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(data),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra});
  res.end(data);
}
function checkOrigin(req, port) {
  const acceptedHosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);
  if (!acceptedHosts.has(req.headers.host)) throw new HttpError(403,'host_rejected','Open LOOPKIND at the local address printed by the server.');
  if (!req.headers.origin) return;
  try {
    const origin=new URL(req.headers.origin);
    if (origin.protocol!=='http:' || origin.host!==req.headers.host) throw new Error();
  } catch { throw new HttpError(403,'origin_rejected','This request must come from the LOOPKIND page.'); }
}
async function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')) {
    req.resume(); throw new HttpError(415,'json_required','Send this request as application/json.');
  }
  if (req.headers['content-encoding'] && req.headers['content-encoding']!=='identity') {
    req.resume(); throw new HttpError(415,'encoding_unsupported','Compressed request bodies are not supported.');
  }
  const length=Number(req.headers['content-length']);
  if (Number.isFinite(length) && length>MAX_BODY) {
    req.resume(); throw new HttpError(413,'body_too_large','Project data exceeds the 128 KiB limit.');
  }
  const bytes=await new Promise((resolve,reject)=>{
    let size=0,finished=false;const chunks=[];
    const fail=error=>{if(!finished){finished=true;reject(error);}};
    req.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>MAX_BODY){chunks.length=0;fail(new HttpError(413,'body_too_large','Project data exceeds the 128 KiB limit.'));}else chunks.push(chunk);});
    req.on('end',()=>{if(!finished){finished=true;resolve(Buffer.concat(chunks));}});
    req.on('aborted',()=>fail(new HttpError(400,'body_incomplete','The request body was incomplete.')));
    req.on('error',()=>fail(new HttpError(400,'body_incomplete','The request body could not be read.')));
  });
  try {
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    return value;
  } catch { throw new HttpError(400,'invalid_json','Send a valid JSON object.'); }
}
function safeError(error) {
  if(error instanceof HttpError||error instanceof ProviderError||error instanceof ReviewError)
    return{status:error.status,body:{error:{code:error.code,message:error.message}}};
  if(error instanceof InputError)return{status:400,body:{error:{code:'invalid_project',message:error.message}}};
  return{status:500,body:{error:{code:'internal_error',message:'The request could not be completed.'}}};
}
export async function createServer({port=Number(process.env.LOOPKIND_PORT??4173),host='127.0.0.1',provider=createNebiusProvider()}={}) {
  if(host!=='127.0.0.1'||!Number.isInteger(port)||port<0||port>65535)throw new Error('Use a local loopback port.');
  const reviews=createReviewBook();
  const posts=new Map([
    ['/api/plan',body=>findPlans(body)],
    ['/api/review-start',body=>reviews.start(body)],
    ['/api/review',body=>reviews.decide(body)],
    ['/api/review-retire',body=>reviews.retire(body)],
    ['/api/import',body=>importDemo(body)],
    ['/api/interpret',body=>provider.interpret(body)]
  ]);
  const server=http.createServer(async(req,res)=>{
    try {
      checkOrigin(req,server.address().port);
      let url;try{url=new URL(req.url,'http://localhost');}catch{throw new HttpError(400,'invalid_path','The request path is invalid.');}
      const pathname=url.pathname;
      if(pathname==='/api/status'||pathname==='/api/example'){
        if(req.method!=='GET')return json(res,405,{error:{code:'method_not_allowed',message:'Use GET.'}},{Allow:'GET'});
        if(pathname==='/api/status'){
          const status=provider.status();
          return json(res,200,{mode:'local-demo',provider:{configured:Boolean(status.configured),model:status.model||null,verified:false}});
        }
        const scenario=url.searchParams.get('scenario')||'three';
        if(!['three','four','circular','tight'].includes(scenario))throw new HttpError(400,'unknown_example','Choose one of the four example scenarios.');
        return json(res,200,exampleProject(scenario));
      }
      if(posts.has(pathname)){
        if(req.method!=='POST')return json(res,405,{error:{code:'method_not_allowed',message:'Use POST.'}},{Allow:'POST'});
        return json(res,200,await posts.get(pathname)(await readJson(req)));
      }
      const entry=STATIC.get(pathname);
      if(!entry)return json(res,404,{error:{code:'not_found',message:'This page or API does not exist.'}});
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:{code:'method_not_allowed',message:'Use GET or HEAD.'}},{Allow:'GET, HEAD'});
      const data=await readFile(path.join(ROOT,'public',entry[0]));
      res.writeHead(200,{
        'Content-Type':entry[1],'Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      });
      res.end(req.method==='HEAD'?undefined:data);
    }catch(error){if(!res.headersSent){const safe=safeError(error);json(res,safe.status,safe.body);}else res.end();}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve();});});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  createServer().then(server=>{
    const port=server.address().port;
    console.log(JSON.stringify({app:'LOOPKIND',mode:'local-demo',port,url:'http://127.0.0.1:'+port}));
    const close=()=>server.close(()=>process.exit(0));
    process.once('SIGTERM',close);process.once('SIGINT',close);
  }).catch(()=>{console.error('LOOPKIND could not start. Check the loopback port and Node runtime.');process.exitCode=1;});
}
