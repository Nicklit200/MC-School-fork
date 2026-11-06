import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Exercise the actual MCP descriptors, authorization gates and dispatcher without
// starting Hono, connecting to production or replacing the shared store's tests.
const source=readFileSync(new URL('../my-skills-mcp.ts',import.meta.url),'utf8');
let owner='owner-primary',ownerQueries=0,oauthScopes='personal:read personal:write';
const storeCalls=[];
const store={
  async save(...args){storeCalls.push(['save',...args]);return {saved:true,created:true,session:{id:'session-1'},resume:{nextSlide:61}};},
  async history(...args){storeCalls.push(['history',...args]);return {sessions:[{id:'session-1',lastCompletedSlide:60}],nextCursor:null};},
  async resume(...args){storeCalls.push(['resume',...args]);return {lastCompletedSlide:60,nextSlide:61,needsMaterialSelection:false};},
  async listResume(...args){storeCalls.push(['listResume',...args]);return {subjects:[{examId:'cg',nextSlide:61}]};}
};
const database={async unsafe(query){
  if(query.startsWith('SELECT owner_hash FROM oauth_personal_owner_lock')){ownerQueries++;return owner?[{owner_hash:owner}]:[];}
  if(query.startsWith('SELECT owner,scopes FROM oauth_tokens'))return [{owner:'owner-primary',scopes:oauthScopes}];
  if(/^(CREATE|ALTER) /.test(query))return [];
  throw Error('Unexpected database query: '+query);
}};
class FakeHono {
  routes=new Map();
  get(path,handler){this.routes.set('GET '+path,handler);return this;}
  post(path,handler){this.routes.set('POST '+path,handler);return this;}
  options(path,handler){this.routes.set('OPTIONS '+path,handler);return this;}
  all(path,handler){this.routes.set('ALL '+path,handler);return this;}
}
const context={Hono:FakeHono,SQL:function(){return database;},Bun:{env:{}},
  createStudySessionStore:()=>store,loadStudySessionCatalog:async()=>({semesters:[]}),
  crypto:webcrypto,TextEncoder,URL,btoa,AbortSignal,console,fetch:()=>{throw Error('Unexpected network request');}};
vm.createContext(context);
new vm.Script(source.replace(/^import .*;\r?\n/gm,'').replace('export default app;','')+
  '\nglobalThis.testApi={personalTools,runPersonalTool,app,studyProgressTools};',
  {filename:'my-skills-mcp.ts'}).runInContext(context);
const {personalTools,runPersonalTool,app,studyProgressTools}=context.testApi;
const identity=scopes=>({owner:'owner-primary',scopes:new Set(scopes)});
const read=identity(['personal:read']),write=identity(['personal:write']);
const tool=name=>personalTools.find(t=>t.name===name);

for(const name of ['save_study_session','get_study_sessions','get_study_resume']){
  assert.ok(tool(name),name+' is discoverable');
  assert.equal(tool(name).inputSchema.additionalProperties,false);
  assert.equal(tool(name).annotations.destructiveHint,false);
  assert.equal(tool(name).annotations.idempotentHint,true);
}
assert.equal(tool('save_study_session').securitySchemes[0].scopes[0],'personal:write');
assert.equal(tool('save_study_session').annotations.readOnlyHint,false);
assert.equal(tool('get_study_sessions').securitySchemes[0].scopes[0],'personal:read');
assert.equal(tool('get_study_resume').annotations.readOnlyHint,true);
assert.deepEqual(Array.from(tool('save_study_session').inputSchema.required),['semesterId','examId','date','idempotencyKey']);
assert.equal(tool('save_study_session').inputSchema.properties.lastCompletedSlide.type,'integer');
assert.equal(tool('get_study_sessions').inputSchema.properties.limit.maximum,100);
assert.match(tool('save_study_session').description,/explicit request/);
assert.match(tool('save_study_session').description,/never treat examples as facts/);

const beforeOwnerQuery=ownerQueries;
assert.match((await runPersonalTool('save_study_session',{},read)).error,/Missing personal:write/);
assert.match((await runPersonalTool('get_study_resume',{},write)).error,/Missing personal:read/);
assert.equal(ownerQueries,beforeOwnerQuery,'missing scopes must fail before touching owner data');
assert.equal(storeCalls.length,0);
owner='another-owner';
assert.match((await runPersonalTool('get_study_sessions',{},read)).error,/another account/);
assert.match((await runPersonalTool('save_study_session',{},write)).error,/another account/);
owner=null;
assert.match((await runPersonalTool('get_study_resume',{},read)).error,/another account/);
assert.equal(storeCalls.length,0,'wrong or missing owner must never reach the shared store');
owner='owner-primary';

const args={semesterId:'ws',examId:'cg',date:'2026-11-06',lastCompletedSlide:60,idempotencyKey:'test-only-session'};
const saved=await runPersonalTool('save_study_session',args,write);
assert.equal(saved.data.saved,true);
assert.equal(saved.data.resume.nextSlide,61);
assert.equal(storeCalls.at(-1)[0],'save');
assert.equal(storeCalls.at(-1)[1],'owner-primary');
assert.equal(storeCalls.at(-1)[2],args,'forward original inputs for shared validation');
const historyArgs={examId:'cg',limit:1,cursor:'opaque'};
const history=await runPersonalTool('get_study_sessions',historyArgs,read);
assert.equal(history.data.sessions[0].lastCompletedSlide,60);
assert.equal(storeCalls.at(-1)[0],'history');
assert.equal(storeCalls.at(-1)[2],historyArgs);
const resumed=await runPersonalTool('get_study_resume',{semesterId:'ws',examId:'cg'},read);
assert.equal(resumed.data.nextSlide,61);
assert.equal(storeCalls.at(-1)[0],'resume');

const originalSave=store.save;
store.save=async()=>{const error=Error('Invalid lastCompletedSlide');error.name='StudySessionError';error.status=400;throw error;};
assert.equal((await runPersonalTool('save_study_session',args,write)).error,'Invalid lastCompletedSlide');
store.save=async()=>{throw Error('postgres://secret@example.invalid');};
const unavailable=await runPersonalTool('save_study_session',args,write);
assert.match(unavailable.error,/same idempotencyKey/);
assert.doesNotMatch(unavailable.error,/postgres|secret/,'database details must not leak');
store.save=originalSave;

studyProgressTools.read=async()=>({count:1,progress:[{skillId:'skill-1',mastery:20}],connectorVersion:'1.3.1'});
const progress=await runPersonalTool('get_study_progress',{},read);
assert.equal(progress.data.progress[0].mastery,20);
assert.equal(progress.data.subjectProgress.subjects[0].nextSlide,61);
assert.equal(storeCalls.at(-1)[0],'listResume');
let forwardedPatch;
studyProgressTools.update=async(patch,who)=>{forwardedPatch=[patch,who];return {saved:true,changed:false};};
const patch={skillId:'skill-1',mastery:30};
assert.equal((await runPersonalTool('update_study_progress',patch,write)).data.saved,true);
assert.deepEqual(forwardedPatch,[patch,'owner-primary'],'existing mastery updates remain independent');

const health=app.routes.get('GET /health')({json:value=>value});
assert.equal(health.version,'1.3.1');
const rpc=(method,name,args={})=>({req:{method:'POST',header:()=> 'Bearer '+'a'.repeat(64),
  json:async()=>({jsonrpc:'2.0',id:7,method,params:{name,arguments:args}})},
  json:(value,status=200)=>({value,status}),body:(value,status)=>({value,status})});
const initialize=await app.routes.get('ALL /mcp')(rpc('initialize'));
assert.equal(initialize.value.result.serverInfo.version,'1.3.1');
const listed=await app.routes.get('ALL /mcp')(rpc('tools/list'));
assert.ok(listed.value.result.tools.some(t=>t.name==='get_study_resume'));
const called=await app.routes.get('ALL /mcp')(rpc('tools/call','get_study_resume',{semesterId:'ws',examId:'cg'}));
assert.equal(called.value.result.structuredContent.nextSlide,61);
assert.equal(JSON.parse(called.value.result.content[0].text).nextSlide,61);
oauthScopes='personal:read';
const denied=await app.routes.get('ALL /mcp')(rpc('tools/call','save_study_session',args));
assert.equal(denied.value.error.code,-32602);
assert.match(denied.value.error.message,/Missing personal:write/);
console.log('MCP study-session discovery, dispatch, scope and owner isolation checks passed');
