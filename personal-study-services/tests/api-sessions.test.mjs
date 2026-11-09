import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

// Load the real API route registration and real v2Owner gate, with an isolated
// account/session database and store. Never contact Railway or personal data.
const source=readFileSync(new URL('../personal-life-api.ts',import.meta.url),'utf8');
const validToken='a'.repeat(64),expiredToken='b'.repeat(64),foreignToken='c'.repeat(64);
const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const sessions=new Map([
  [await digest(validToken),{owner_hash:'primary-owner',expires:Date.now()+60000}],
  [await digest(expiredToken),{owner_hash:'primary-owner',expires:Date.now()-60000}],
  [await digest(foreignToken),{owner_hash:'foreign-owner',expires:Date.now()+60000}]
]);
let failAuth=false,lookupCount=0;
const database=async()=>[];
database.unsafe=async(query,args)=>{
  if(/^CREATE /.test(query))return [];
  if(query.startsWith('SELECT owner_hash FROM personal_quiz_login_sessions')){
    lookupCount++;
    if(failAuth)throw Error('postgres://private-credential@database.invalid');
    const row=sessions.get(args[0]);
    return row&&row.expires>Date.now()?[{owner_hash:row.owner_hash}]:[];
  }
  if(query.startsWith('SELECT owner_hash FROM oauth_personal_owner_lock'))return [{owner_hash:'primary-owner'}];
  throw Error('Unexpected query in API test: '+query);
};
const calls=[];
const store={};
const handlers={
  history:async()=>({sessions:[{id:'fixture',lastCompletedSlide:60,nextSlide:61}],nextCursor:'opaque+/='}),
  resume:async()=>({lastCompletedSlide:60,nextSlide:61}),
  save:async()=>({saved:true,created:true,session:{id:'fixture'}})
};
for(const method of Object.keys(handlers))store[method]=async(owner,args)=>{
  calls.push({method,owner,args});return handlers[method](owner,args);
};
class FakeHono {
  routes=new Map();
  use(){return this;}
}
for(const verb of ['get','post','put','patch','delete','options','all'])
  FakeHono.prototype[verb]=function(path,handler){this.routes.set(verb.toUpperCase()+' '+path,handler);return this;};
const context={Hono:FakeHono,SQL:function(){return database;},Bun:{env:{}},
  cors:()=>()=>{},webpush:{},createStudyCardStore:()=>({}),createStudySessionStore:()=>store,loadStudySessionCatalog:()=>{throw Error('Unexpected catalog fetch');},
  crypto:webcrypto,TextEncoder,URL,Date,Intl,AbortSignal,Response,
  console:{info(){},error(){},log(){}},fetch:()=>{throw Error('Unexpected network request');}};
vm.createContext(context);
await new vm.Script('(async()=>{'+source.replace(/^import .*;\r?\n/gm,'').replace('export default app;','')+
  '\nglobalThis.apiTest={app};})()', {filename:'personal-life-api.ts'}).runInContext(context);
const app=context.apiTest.app;

async function request(verb,path,{token=validToken,body,malformed=false}={}){
  const url=new URL(path,'https://test.invalid');
  const route=app.routes.get(verb+' '+url.pathname);
  assert.equal(typeof route,'function','real endpoint registered: '+verb+' '+url.pathname);
  return route({req:{
    header:name=>name==='Authorization'&&token?'Bearer '+token:undefined,
    query:()=>Object.fromEntries(url.searchParams),
    json:async()=>{if(malformed)throw SyntaxError('Malformed JSON');return body;}
  },json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers})});
}
function noStore(response){assert.equal(response.headers.get('cache-control'),'no-store');}
const json=async response=>{noStore(response);return response.json();};

for(const token of ['', 'bad-token',expiredToken,foreignToken]){
  for(const [verb,path] of [['GET','/api/study-sessions'],['GET','/api/study-resume'],['POST','/api/study-sessions']]){
    const before=calls.length;
    const response=await request(verb,path,{token});
    assert.equal(response.status,401);
    assert.deepEqual(await json(response),{error:'Требуется вход'});
    assert.equal(calls.length,before,'unauthenticated or foreign sessions never reach study data');
  }
}
assert.ok(lookupCount>0,'real login-session lookup used');
const filter='/api/study-sessions?semesterId=ws&examId=cg&materialId=1Pipeline.pdf&date=2026-11-06&limit=100&cursor=opaque%2B%2F%3D';
let response=await request('GET',filter);
assert.equal(response.status,200);
assert.equal((await json(response)).sessions[0].nextSlide,61);
assert.equal(calls.at(-1).method,'history');
assert.equal(calls.at(-1).owner,'primary-owner');
assert.deepEqual(calls.at(-1).args,{semesterId:'ws',examId:'cg',materialId:'1Pipeline.pdf',date:'2026-11-06',limit:100,cursor:'opaque+/='});
await request('GET','/api/study-sessions');
assert.equal(calls.at(-1).args.limit,undefined,'omitted pagination limit stays omitted for the shared default');
for(const limit of ['-1','1.1','abc','1e2','Infinity','']){
  await request('GET','/api/study-sessions?limit='+encodeURIComponent(limit));
  assert.ok(Number.isNaN(calls.at(-1).args.limit),'non-decimal pagination input reaches validation as NaN: '+limit);
}
await request('GET','/api/study-resume?semesterId=ws&examId=cg&materialId=1Pipeline.pdf');
assert.equal(calls.at(-1).method,'resume');
assert.deepEqual(calls.at(-1).args,{semesterId:'ws',examId:'cg',materialId:'1Pipeline.pdf'});

const session={semesterId:'ws',examId:'cg',date:'2026-11-06',topics:['Pipeline'],lastCompletedSlide:60,idempotencyKey:'fixture-only'};
response=await request('POST','/api/study-sessions',{body:session});
assert.equal(response.status,200);
assert.equal((await json(response)).saved,true);
assert.equal(calls.at(-1).method,'save');
assert.equal(calls.at(-1).args,session,'forward the complete original JSON body to shared validation');
const originalSave=handlers.save;
handlers.save=async(owner,args)=>{assert.equal(args,null);const error=Error('Invalid study session');error.name='StudySessionError';error.status=400;throw error;};
response=await request('POST','/api/study-sessions',{malformed:true});
assert.equal(response.status,400);
assert.equal((await json(response)).error,'Invalid study session');
handlers.save=originalSave;

const originalHistory=handlers.history;
handlers.history=async()=>{const error=Error('Invalid date');error.name='StudySessionError';error.status=400;throw error;};
response=await request('GET','/api/study-sessions?date=invalid');
assert.equal(response.status,400);
assert.equal((await json(response)).error,'Invalid date');
handlers.history=async()=>{throw Error('postgres://private-credential@database.invalid');};
response=await request('GET','/api/study-sessions');
assert.equal(response.status,503);
assert.doesNotMatch(JSON.stringify(await json(response)),/postgres|credential|database\.invalid/);
handlers.history=originalHistory;

// Authentication database failures must use the same safe error/no-cache path.
failAuth=true;
response=await request('GET','/api/study-sessions');
assert.equal(response.status,503);
assert.doesNotMatch(JSON.stringify(await json(response)),/postgres|credential|database\.invalid/);
failAuth=false;

// Build outputs must be self-contained, include the shared store exactly once,
// and parse after removing Bun-only import/export bindings.
execFileSync(process.execPath,[fileURLToPath(new URL('../build.mjs',import.meta.url))],{stdio:'pipe'});
for(const name of ['personal-life-api','my-skills-mcp']){
  const bundle=readFileSync(new URL('../dist/'+name+'.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(bundle,/from\s*['"]\.\//);
  assert.equal(bundle.split('function createStudySessionStore(').length-1,1);
  new vm.Script('(async()=>{'+bundle.replace(/^import .*;\r?\n/gm,'').replace('export default app;','')+'})');
}
console.log('HTTP study-session owner gate, route parameters, error handling, no-cache and bundled syntax checks passed');
