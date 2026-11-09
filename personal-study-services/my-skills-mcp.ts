import { createStudyCardStore } from "./study-cards.js";
import { Hono } from "hono@4";
import { SQL } from "bun";
import { createStudySessionStore, loadStudySessionCatalog } from "./study-sessions.js";
const app = new Hono();
const sql = new SQL(Bun.env.DATABASE_URL || "");
function reply(id,result){return {jsonrpc:"2.0",id,result};}

const ISSUER="https://my-skills-mcp-production.up.railway.app";
const SITE="https://study-map-production-ae7a.up.railway.app";
const supportedScopes=["quiz:read","personal:read","personal:write"];
const scope=supportedScopes.join(" ");
const rnd=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,"0")).join("");
async function digest(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,"0")).join("");}
let ready=false;
async function setup(){
 if(ready)return;
 await sql.unsafe("CREATE TABLE IF NOT EXISTS oauth_clients(id TEXT PRIMARY KEY, redirects JSONB NOT NULL)");
 await sql.unsafe("CREATE TABLE IF NOT EXISTS oauth_pending(id TEXT PRIMARY KEY, client TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, state TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL)");
 await sql.unsafe("CREATE TABLE IF NOT EXISTS oauth_codes(hash TEXT PRIMARY KEY, owner TEXT NOT NULL, client TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL)");
 await sql.unsafe("CREATE TABLE IF NOT EXISTS oauth_tokens(hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL)");
 await sql.unsafe("ALTER TABLE oauth_pending ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT 'quiz:read'");
 await sql.unsafe("ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT 'quiz:read'");
 await sql.unsafe("ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT 'quiz:read'");
 await sql.unsafe("CREATE TABLE IF NOT EXISTS oauth_refresh_tokens(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,client TEXT NOT NULL,scopes TEXT NOT NULL,expires TIMESTAMPTZ NOT NULL)");
 await sql.unsafe("CREATE TABLE IF NOT EXISTS oauth_personal_owner_lock(name TEXT PRIMARY KEY,owner_hash TEXT NOT NULL)");
 ready=true;
}
function redirectAllowed(s){
 try{const u=new URL(s);return u.protocol==="https:"&&(u.hostname==="chatgpt.com"||u.hostname.endsWith(".chatgpt.com")||u.hostname==="openai.com"||u.hostname.endsWith(".openai.com"));}catch{return false;}
}
async function authorized(ctx){
 const auth=ctx.req.header("authorization")||"";
 const token=auth.startsWith("Bearer ")?auth.slice(7):"";
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 await setup();
 const rows=await sql.unsafe("SELECT owner,scopes FROM oauth_tokens WHERE hash=$1 AND expires>now()",[await digest(token)]);
 if(!rows.length)return null;
 return {owner:rows[0].owner,scopes:new Set(String(rows[0].scopes||"quiz:read").split(/\s+/))};
}
app.get("/.well-known/oauth-protected-resource",ctx=>ctx.json({resource:ISSUER,authorization_servers:[ISSUER],scopes_supported:supportedScopes}));
app.get("/.well-known/oauth-protected-resource/mcp",ctx=>ctx.json({resource:ISSUER,authorization_servers:[ISSUER],scopes_supported:supportedScopes}));
app.get("/.well-known/oauth-authorization-server",ctx=>ctx.json({issuer:ISSUER,authorization_endpoint:ISSUER+"/oauth/authorize",token_endpoint:ISSUER+"/oauth/token",registration_endpoint:ISSUER+"/oauth/register",grant_types_supported:["authorization_code","refresh_token"],response_types_supported:["code"],code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"],scopes_supported:supportedScopes,authorization_response_iss_parameter_supported:true}));
app.post("/oauth/register",async ctx=>{
 const b=await ctx.req.json().catch(()=>({}));const uris=b.redirect_uris;
 if(!Array.isArray(uris)||!uris.length||uris.length>5||!uris.every(redirectAllowed))return ctx.json({error:"invalid_redirect_uri"},400);
 await setup();const id="my-skills-"+rnd();
 await sql.unsafe("INSERT INTO oauth_clients(id,redirects) VALUES($1,$2::jsonb)",[id,JSON.stringify(uris)]);
 return ctx.json({client_id:id,redirect_uris:uris,grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"none"},201);
});
app.get("/oauth/authorize",async ctx=>{
 const q=ctx.req.query();
 if(q.response_type!=="code"||q.code_challenge_method!=="S256"||!/^[a-zA-Z0-9_-]{43,128}$/.test(q.code_challenge||"")||!q.state||q.state.length>512||q.resource!==ISSUER||!redirectAllowed(q.redirect_uri||""))return ctx.text("Invalid OAuth request",400);
 await setup();
 const rows=await sql.unsafe("SELECT redirects FROM oauth_clients WHERE id=$1",[q.client_id||""]);
 if(!rows.length||!rows[0].redirects.includes(q.redirect_uri))return ctx.text("Unknown client",400);
 const requested=[...new Set(String(q.scope||scope).trim().split(/\s+/).filter(Boolean))];
 if(!requested.length||requested.some(x=>!supportedScopes.includes(x)))return ctx.text("Unsupported OAuth scope",400);
 const requestedScopes=requested.join(" ");
 const id=rnd();await sql.unsafe("INSERT INTO oauth_pending(id,client,redirect,challenge,state,scopes,expires) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",[id,q.client_id,q.redirect_uri,q.code_challenge,q.state,requestedScopes]);
 const manage=requested.includes("personal:write")||requested.includes("personal:read");
 const link=SITE+"/#oauth-approve="+id+(manage?"&mode=manage":"");
 const headline=manage?"Разрешить ChatGPT управлять личными разделами сайта «Мои навыки»?":"Разрешить ChatGPT читать результаты карточек?";
 const message=manage?"ChatGPT сможет читать и изменять записи питания, тренировок, учебных задач и слов. Доступ предоставляется только после подтверждения на сайте.":"Доступ только для чтения карточек.";
 return ctx.html('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Мои навыки</title><body style="font:18px system-ui;max-width:500px;margin:60px auto;padding:20px"><h2>'+headline+'</h2><p>'+message+'</p><a href="'+link+'">Подтвердить на сайте «Мои навыки»</a></body></html>');
});
app.options("/oauth/approve",ctx=>ctx.body(null,204,{"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization"}));
app.post("/oauth/approve",async ctx=>{
 const headers={"Access-Control-Allow-Origin":SITE};
 const token=(ctx.req.header("authorization")||"").replace(/^Bearer /,"");
 if(!/^[a-f0-9]{64}$/.test(token))return ctx.json({error:"Unauthorized"},401,headers);
 const b=await ctx.req.json().catch(()=>({}));
 await setup();
 const rows=await sql.unsafe("DELETE FROM oauth_pending WHERE id=$1 AND expires>now() RETURNING *",[b.id||""]);
 if(!rows.length)return ctx.json({error:"Expired request"},400,headers);
 const p=rows[0],code=rnd(),ownerHash=await digest(token);
 if(String(p.scopes).includes("personal:")){
   await sql.unsafe("INSERT INTO oauth_personal_owner_lock(name,owner_hash) VALUES('primary',$1) ON CONFLICT(name) DO NOTHING",[ownerHash]);
   const lock=await sql.unsafe("SELECT owner_hash FROM oauth_personal_owner_lock WHERE name='primary'");
   if(lock[0]?.owner_hash!==ownerHash)return ctx.json({error:"personal_data_already_linked_to_another_owner"},403,headers);
 }
 await sql.unsafe("INSERT INTO oauth_codes(hash,owner,client,redirect,challenge,scopes,expires) VALUES($1,$2,$3,$4,$5,$6,now()+interval '5 minutes')",[await digest(code),ownerHash,p.client,p.redirect,p.challenge,p.scopes]);
 const dest=new URL(p.redirect);dest.searchParams.set("code",code);dest.searchParams.set("state",p.state);dest.searchParams.set("iss",ISSUER);
 return ctx.json({redirect:dest.href},200,headers);
});
async function issueTokens(owner,client,permissions){
 const token=rnd(),refresh=rnd();
 await sql.unsafe("INSERT INTO oauth_tokens(hash,owner,scopes,expires) VALUES($1,$2,$3,now()+interval '24 hours')",[await digest(token),owner,permissions]);
 await sql.unsafe("INSERT INTO oauth_refresh_tokens(hash,owner,client,scopes,expires) VALUES($1,$2,$3,$4,now()+interval '60 days')",[await digest(refresh),owner,client,permissions]);
 return {access_token:token,refresh_token:refresh,token_type:"Bearer",expires_in:86400,scope:permissions};
}
app.post("/oauth/token",async ctx=>{
 const b=await ctx.req.parseBody().catch(()=>({}));
 if(typeof b.client_id!=="string")return ctx.json({error:"invalid_request"},400);
 await setup();
 if(b.grant_type==="refresh_token"){
   if(typeof b.refresh_token!=="string")return ctx.json({error:"invalid_request"},400);
   const rows=await sql.unsafe("DELETE FROM oauth_refresh_tokens WHERE hash=$1 AND client=$2 AND expires>now() RETURNING owner,client,scopes",[await digest(b.refresh_token),b.client_id]);
   if(!rows.length)return ctx.json({error:"invalid_grant"},400);
   const p=rows[0];return ctx.json(await issueTokens(p.owner,p.client,p.scopes));
 }
 if(b.grant_type!=="authorization_code"||typeof b.code!=="string"||typeof b.code_verifier!=="string"||typeof b.redirect_uri!=="string")return ctx.json({error:"invalid_request"},400);
 const rows=await sql.unsafe("DELETE FROM oauth_codes WHERE hash=$1 AND expires>now() RETURNING *",[await digest(b.code)]);
 if(!rows.length)return ctx.json({error:"invalid_grant"},400);
 const p=rows[0],hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(b.code_verifier));
 const check=btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
 if(check!==p.challenge||b.client_id!==p.client||b.redirect_uri!==p.redirect||(b.resource&&b.resource!==ISSUER))return ctx.json({error:"invalid_grant"},400);
 return ctx.json(await issueTokens(p.owner,p.client,p.scopes));
});

app.get("/health",c=>c.json({ok:true,service:"my-skills-mcp",version:"1.4.0"}));
app.all("/mcp",async c=>{
  const identity=await authorized(c);
  if(!identity)return c.json({error:"Unauthorized"},401,{"WWW-Authenticate":'Bearer resource_metadata="https://my-skills-mcp-production.up.railway.app/.well-known/oauth-protected-resource", scope="quiz:read personal:read personal:write"'});
  const owner=identity.owner;
  if(c.req.method!=="POST")return c.body(null,405);
  const message=await c.req.json().catch(()=>null);
  if(!message||message.jsonrpc!=="2.0")return c.json({error:"Invalid JSON-RPC"},400);
  const id=message.id??null;
  if(message.method==="initialize")return c.json(reply(id,{protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"my-skills-mcp",version:"1.4.0"}}));
  if(message.method==="notifications/initialized")return c.body(null,202);
  if(message.method==="ping")return c.json(reply(id,{}));
  const tools=personalTools;
  if(message.method==="tools/list")return c.json(reply(id,{tools}));
  if(message.method!=="tools/call")return c.json({jsonrpc:"2.0",id,error:{code:-32601,message:"Unknown method"}});
  const toolName=message.params?.name;
  if(toolName!=="get_quiz_results"){
    const response=await runPersonalTool(toolName,message.params?.arguments||{},identity);
    if(response.error)return c.json({jsonrpc:"2.0",id,error:{code:-32602,message:response.error}});
    return c.json(reply(id,{content:[{type:"text",text:JSON.stringify(response.data)}],structuredContent:response.data}));
  }
  if(!identity.scopes.has("quiz:read"))return c.json({jsonrpc:"2.0",id,error:{code:-32602,message:"Missing quiz:read permission"}});
  const date=message.params?.arguments?.date;
  if(date && !/^\d{4}-\d{2}-\d{2}$/.test(date))return c.json({jsonrpc:"2.0",id,error:{code:-32602,message:"Invalid date"}},400);
  const records=await sql.unsafe("SELECT payload FROM personal_quiz_sessions WHERE owner_hash=$1 ORDER BY session_date DESC LIMIT 100",[owner]);
  const flags=await sql.unsafe("SELECT payload FROM personal_quiz_snapshots WHERE owner_hash=$1",[owner]);
  const state=flags[0]?.payload||{};
  const invalid=state.invalid||{},deleted=state.deleted||{},overrides=state.overrides||{};
  const sessions=records.map(x=>x.payload).filter(x=>!date||x.date===date).map(s=>{
    const review=(s.review||[]).filter(x=>!Object.prototype.hasOwnProperty.call(invalid,x.cardId)&&!Object.prototype.hasOwnProperty.call(deleted,x.cardId)&&!overrides[x.cardId]?.deleted);
    return {id:s.id,date:s.date,examId:s.examId,mode:s.type,totalCards:review.length,correctFirstTry:review.filter(x=>x.correct).length,review};
  });
  const cardProgress=Object.entries(state.progress||{}).filter(([cardId])=>
    !Object.prototype.hasOwnProperty.call(invalid,cardId)&&
    !Object.prototype.hasOwnProperty.call(deleted,cardId)&&!overrides[cardId]?.deleted
  ).map(([cardId,p])=>({cardId,...p,known:typeof p.lastCorrect==="boolean"?p.lastCorrect:null}));
  const result={sessions,cardProgress,cardCount:cardProgress.length,
    summary:{completedSessions:sessions.length,reviewedQuestions:sessions.reduce((n,x)=>n+x.totalCards,0),
      correctFirstTry:sessions.reduce((n,x)=>n+x.correctFirstTry,0)}};
  return c.json(reply(id,{content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result}));
});

const descriptor=(name,description,properties,required,write=false,destructive=false)=>({
 name,description,
 securitySchemes:[{type:"oauth2",scopes:[write?"personal:write":"personal:read"]}],
 annotations:{readOnlyHint:!write,destructiveHint:destructive,idempotentHint:true,openWorldHint:false},
 inputSchema:{type:"object",properties,required,additionalProperties:false}
});
const field=(description,type="string")=>({type,description});
const cardInputProperties = Object.fromEntries(['question','answer','wrongAnswer1','wrongAnswer2','wrongAnswer3','explanation'].map(key => [key,{type:'string',minLength:1,maxLength:10000}]));
const personalTools=[
 descriptor("add_study_cards","Create 1–100 cards in the existing study map. Resolve semesterId/examId/skillId using get_study_progress first. Reuse idempotencyKey only for an identical retry. Duplicate normalized questions within the subject are skipped, including deleted cards. Never claim success without saved and verified. Does not change review progress.",{semesterId:field("Existing semester ID"),examId:field("Existing subject ID"),idempotencyKey:field("Unique operation key"),cards:{type:"array",minItems:1,maxItems:100,items:{type:"object",properties:{skillId:field("Existing skill in this subject"),...cardInputProperties},required:['skillId',...Object.keys(cardInputProperties)],additionalProperties:false}}},['semesterId','examId','cards','idempotencyKey'],true),
 descriptor("get_study_cards","Read existing active cards, stable cardId, content and subject/skill binding.",{semesterId:field("Existing semester ID"),examId:field("Existing subject ID"),skillId:field("Optional skill ID")},['semesterId','examId']),
 descriptor("update_study_card","Edit card content by stable cardId; omitted fields and all review progress are preserved.",{cardId:field("Stable card ID"),...cardInputProperties},['cardId'],true),
 descriptor("delete_study_card","Hide a card only after explicit user confirmation. Requires confirm=true; preserves content, review events, progress and test history.",{cardId:field("Stable card ID"),confirm:{type:"boolean",const:true}},['cardId','confirm'],true,true),
 {name:"get_quiz_results",description:"Get owner's completed quiz sessions and first-try correctness, excluding invalid questions.",securitySchemes:[{type:"oauth2",scopes:["quiz:read"]}],annotations:{readOnlyHint:true},inputSchema:{type:"object",properties:{date:field("Optional YYYY-MM-DD")},additionalProperties:false}},
 descriptor("get_nutrition_entries","Read the personal site's saved nutrition entries and calorie total for a selected day.",{date:field("YYYY-MM-DD date in Europe/Berlin")},["date"]),
 descriptor("add_nutrition_entry","Save food and calories DIRECTLY in the owner's personal My Skills diary. For photo-based estimates write uncertainty in notes. Use a unique stable idempotencyKey per eating occasion so retries do not duplicate.",{date:field("YYYY-MM-DD in Europe/Berlin"),name:field("Food description"),kcal:field("Estimated kcal for entire serving","number"),meal:field("Breakfast, lunch, dinner or snack"),quantity:field("Number of pieces, or numeric weight","number"),unit:field("Unit, e.g. шт. or г"),protein:field("Protein grams, if known","number"),carbs:field("Carbohydrate grams, if known","number"),fat:field("Fat grams, if known","number"),notes:field("Additional ingredients and uncertainty"),idempotencyKey:field("Stable unique key for this eating occasion, reused only for a retry")},["date","name","kcal","idempotencyKey"],true),
 descriptor("delete_nutrition_entry","Delete a specific saved nutrition entry by ID only when the user explicitly requests deletion.",{entryId:field("ID returned by get_nutrition_entries"),confirm:field("Must be true after explicit request","boolean")},["entryId","confirm"],true,true),
 descriptor("list_study_tasks","List all school/university study tasks saved on the personal site, including completion state.",{},[]),
 descriptor("add_study_task","Create a study task in My Skills.",{title:field("Task name"),dueDate:field("Optional YYYY-MM-DD due date"),semesterId:field("Optional semester ID"),examId:field("Optional exam ID"),targetDay:field("Optional day of week as integer","integer"),idempotencyKey:field("Stable unique key for this task")},["title","idempotencyKey"],true),
 descriptor("update_study_task","Update an existing task: title, completion or due date.",{id:field("Existing task ID"),title:field("Optional new title"),done:field("Optional true when complete","boolean"),dueDate:field("Optional new due date YYYY-MM-DD")},["id"],true),
 descriptor("list_workouts","List saved workouts for a selected date.",{date:field("YYYY-MM-DD")},["date"]),
 descriptor("add_workout","Record a workout in My Skills, including optional active calories burned in notes.",{date:field("YYYY-MM-DD"),title:field("Workout name"),durationMinutes:field("Duration in minutes","number"),notes:field("Optional note; include active calories if user supplies"),exercises:{type:"array",items:{type:"string"},description:"Optional exercise descriptions"},idempotencyKey:field("Stable unique key for this workout")},["date","title","idempotencyKey"],true),
 descriptor("update_workout","Update workout title, duration, notes or exercise list.",{id:field("Existing workout ID"),title:field("Optional new title"),durationMinutes:field("Optional duration minutes","number"),notes:field("Optional notes"),exercises:{type:"array",items:{type:"string"}}},["id"],true),
 descriptor("list_german_words","Read vocabulary cards saved in the German words section.",{},[]),
 descriptor("add_german_word","Save a German vocabulary word and its Russian translation.",{word:field("German word"),translation:field("Russian translation"),context:field("Optional context sentence"),sourceUrl:field("Optional public source URL")},["word"],true),
 descriptor("update_german_word","Update translation, spaced repetition state or due date for a German vocabulary card.",{id:field("Existing word ID"),translation:field("Optional translation"),repetition:field("Optional repetition step 0-9","integer"),dueDate:field("Optional YYYY-MM-DD")},["id"],true),
 descriptor("get_study_progress","Read the study map's stable semesterId, examId and skillId, skill mastery, review dates, flashcard progress, and subjectProgress with saved study-session resume positions. Read this to resolve exact course IDs before saving a session. Includes catalog skills without saved progress rows.",{},[]),
 descriptor("save_study_session","Save one study session to the existing Обновления знаний journal only after an explicit request such as «Сохрани, что мы сегодня изучили», «Обнови карту навыков», «Запиши прогресс по Computergrafik» or «Мы закончили на 60-м слайде». Read get_study_progress/get_study_resume first for exact semesterId, examId and materialId. Save only topics and slide numbers confirmed in the conversation; never treat examples as facts. The date uses Europe/Berlin. A completed slide is distinct from a merely opened slide; the next slide is derived from it. Reuse the same idempotencyKey only when retrying this session. Returns the verified saved session and resume position; does not change skill mastery or flashcard answers.",{
   semesterId:field("Exact semesterId returned by get_study_progress"),
   examId:field("Exact examId returned by get_study_progress"),
   materialId:field("Exact existing materialId from get_study_resume, or a stable ID for a new presentation; omit only when the material is unambiguous"),
   materialTitle:field("Optional presentation/document title, as supplied by the user"),
   date:field("Study date YYYY-MM-DD in Europe/Berlin"),
   occurredAt:field("Optional actual session timestamp in ISO 8601 with timezone; omit when unknown"),
   title:field("Optional concise session title"),
   summary:field("Optional account of what was studied, questions and remaining difficulties"),
   topics:{type:"array",items:{type:"string"},description:"Confirmed topics studied during this session; omit when unknown"},
   lastCompletedSlide:{type:"integer",minimum:0,description:"Last fully completed slide; zero only when no slide is complete; omit when unknown"},
   nextSlide:{type:["integer","null"],minimum:1,description:"Optional confirmation of lastCompletedSlide + 1, or null when the confirmed total is complete; requires lastCompletedSlide; normally omit so the server derives it"},
   totalSlides:{type:"integer",minimum:1,description:"Optional confirmed number of slides in this material"},
   slideFrom:{type:"integer",minimum:1,description:"Optional first slide studied in this session, at most lastCompletedSlide"},
   idempotencyKey:field("Stable unique key for this learning session, reused unchanged for a retry")
 },["semesterId","examId","date","idempotencyKey"],true),
 descriptor("get_study_sessions","Read saved study history from the existing Обновления знаний journal, newest first, including older catalog sessions. Use for «Что мы проходили в прошлый раз?». Filter by exact course IDs or material. Continue with nextCursor until the requested history is found; do not infer learning from mastery percentages.",{
   semesterId:field("Optional exact semesterId"),examId:field("Optional exact examId"),
   materialId:field("Optional exact materialId returned by get_study_resume"),
   date:field("Optional study date YYYY-MM-DD in Europe/Berlin"),
   limit:{type:"integer",minimum:1,maximum:100,description:"Number of sessions per page, 1–100; default 50"},
   cursor:field("Opaque nextCursor from the preceding response; preserve filters while paging")
 },[]),
 descriptor("get_study_resume","Read the exact saved position and latest session for «На каком слайде мы остановились?» or «С какого места продолжать Computergrafik?». Use exact semesterId/examId from get_study_progress. Returns completed and next slides per material plus topics from the latest session. If needsMaterialSelection is true, use the returned materialId for the intended presentation; never mix slide numbers from different PDFs or invent unknown positions.",{
   semesterId:field("Exact semesterId returned by get_study_progress"),
   examId:field("Exact examId returned by get_study_progress"),
   materialId:field("Optional exact materialId to select one presentation/document")
 },["semesterId","examId"]),
 descriptor("get_card_progress","Read individual flashcard knowledge, repetition stages and next due dates.",{},[]),
 descriptor("update_study_progress","Update an existing study-map skill after explicit user request. Read get_study_progress first and use its skillId. Omitted repetition, dueDate and lastResult are preserved. Returns verified saved progress and effective displayed mastery; does not modify flashcard answers.",{skillId:field("Existing map skillId returned by get_study_progress"),mastery:field("Mastery as an integer 0-100 percent","number"),repetition:field("Optional repetition number; omitted preserves current value","integer"),dueDate:field("Optional YYYY-MM-DD due date; omitted preserves current value"),lastResult:field("Optional result note, at most 500 characters; omitted preserves current value")},["skillId","mastery"],true),
 descriptor("get_daily_overview","Daily overview: calories eaten, saved workouts, open and completed study tasks.",{date:field("YYYY-MM-DD")},["date"])
];
function isDate(s){return typeof s==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function textField(v,max){return typeof v==="string"?v.trim().slice(0,max):"";}
function validNumber(v,max=10000){return typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=max;}
async function runPersonalTool(name,args,identity){
 const tool=personalTools.find(t=>t.name===name);
 if(!tool)return {error:"Unknown tool: "+name};
 const requiredScope=tool.securitySchemes[0].scopes[0];
 if(!identity.scopes.has(requiredScope))return {error:"Missing "+requiredScope+" permission. Reconnect the existing My Skills app and approve personal data access."};
 const owners=await sql.unsafe("SELECT owner_hash FROM oauth_personal_owner_lock WHERE name='primary'");
 if(owners[0]?.owner_hash!==identity.owner)return {error:"This personal diary is linked to another account."};
 if(['add_study_cards','get_study_cards','update_study_card','delete_study_card'].includes(name)){
   try {
     const method={add_study_cards:'add',get_study_cards:'get',update_study_card:'update',delete_study_card:'delete'}[name];
     return {data:await studyCardStore[method](identity.owner,args)};
   } catch(error) { return {error:error?.name==='StudyCardError'?error.message:'Study cards unavailable. No successful write confirmed; retry creation with the same idempotencyKey.'}; }
 }
 if(name==="save_study_session"||name==="get_study_sessions"||name==="get_study_resume"){
   try{
     const method=name==="save_study_session"?"save":name==="get_study_sessions"?"history":"resume";
     return {data:await studySessionStore[method](identity.owner,args)};
   }catch(error){
     const safe=error?.name==="StudySessionError"||(Number.isInteger(error?.status)&&error.status>=400&&error.status<500);
     return {error:safe?error.message:"Study sessions unavailable. No successful save was confirmed; retry with the same idempotencyKey."};
   }
 }
 if(name==="get_study_progress"||name==="update_study_progress"){
   try{
     let data;
     if(name==="get_study_progress"){
       const [progress,resume]=await Promise.all([studyProgressTools.read(identity.owner),studySessionStore.listResume(identity.owner)]);
       data={...progress,subjectProgress:resume};
     }else data=await studyProgressTools.update(args,identity.owner);
     return {data};
   }catch(error){
     const message=error instanceof Error?error.message:"";
     const safe=/^(Invalid |Unknown skillId|mastery must |Study catalog |Duplicate skill ID|Study progress write )/.test(message);
     return {error:safe?message:"Study data unavailable. No successful update was confirmed; retry the request."};
   }
 }
 if(name==="get_nutrition_entries"){
   if(!isDate(args.date))return {error:"Invalid date; use YYYY-MM-DD"};
   const entries=await sql.unsafe('SELECT id,entry_date::text AS date,meal,name,quantity,unit,kcal,protein,carbs,fat,notes,created_at AS "createdAt" FROM nutrition_entries WHERE entry_date=$1 ORDER BY created_at ASC',[args.date]);
   return {data:{date:args.date,entries,totalKcal:entries.reduce((n,e)=>n+Number(e.kcal||0),0),count:entries.length}};
 }
 if(name==="add_nutrition_entry"){
   if(!isDate(args.date))return {error:"Invalid date; use YYYY-MM-DD"};
   if(!textField(args.name,200))return {error:"Food name required"};
   if(!validNumber(args.kcal,8000))return {error:"Invalid kcal; supply number 0-8000"};
   if(!textField(args.idempotencyKey,120))return {error:"Unique idempotencyKey required"};
   for(const n of ["quantity","protein","carbs","fat"])if(args[n]!=null&&!validNumber(args[n],10000))return {error:"Invalid "+n};
   const entryId="food-chatgpt-"+await digest(identity.owner+"|"+args.date+"|"+args.idempotencyKey);
   const rows=await sql.unsafe("INSERT INTO nutrition_entries(id,entry_date,meal,name,quantity,unit,kcal,protein,carbs,fat,notes) VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING RETURNING id",[entryId,args.date,textField(args.meal,60)||null,textField(args.name,200),args.quantity??null,textField(args.unit,32)||null,args.kcal,args.protein??null,args.carbs??null,args.fat??null,textField(args.notes,1000)||null]);
   const saved=await sql.unsafe('SELECT id,entry_date::text AS date,meal,name,quantity,unit,kcal,protein,carbs,fat,notes FROM nutrition_entries WHERE id=$1',[entryId]);
   return {data:{saved:saved.length===1,created:rows.length===1,alreadyExisted:rows.length===0,entry:saved[0]||null}};
 }
 if(name==="delete_nutrition_entry"){
   if(args.confirm!==true)return {error:"Explicit confirm=true required"};
   const id=textField(args.entryId,160);
   if(!id)return {error:"entryId required"};
   const deleted=await sql.unsafe("DELETE FROM nutrition_entries WHERE id=$1 RETURNING id",[id]);
   return {data:{deleted:deleted.length===1,id}};
 }
 if(name==="list_study_tasks"){
   const tasks=await sql.unsafe('SELECT id,semester_id AS "semesterId",exam_id AS "examId",title,target_day AS "targetDay",due_date::text AS "dueDate",done,completed_at AS "completedAt" FROM study_tasks ORDER BY done,due_date NULLS LAST,created_at DESC LIMIT 300');
   return {data:{tasks,count:tasks.length}};
 }
 if(name==="add_study_task"){
   const title=textField(args.title,250),key=textField(args.idempotencyKey,150);
   if(!title||!key||args.dueDate&&!isDate(args.dueDate))return {error:"Valid title, idempotencyKey and optional dueDate required"};
   const id="task-chatgpt-"+await digest(identity.owner+"|"+key);
   const saved=await sql.unsafe('INSERT INTO study_tasks(id,semester_id,exam_id,title,target_day,due_date,done) VALUES($1,$2,$3,$4,$5,$6::date,FALSE) ON CONFLICT(id) DO NOTHING RETURNING id',[id,textField(args.semesterId,160)||null,textField(args.examId,160)||null,title,Number.isInteger(args.targetDay)?args.targetDay:null,args.dueDate||null]);
   const records=await sql.unsafe("SELECT id,title,done,due_date::text AS dueDate FROM study_tasks WHERE id=$1",[id]);
   return {data:{saved:records.length===1,created:saved.length===1,task:records[0]||null}};
 }
 if(name==="update_study_task"){
   const id=textField(args.id,200);if(!id)return {error:"id required"};
   if(args.dueDate!==undefined&&!isDate(args.dueDate))return {error:"Invalid dueDate"};
   const records=await sql.unsafe('UPDATE study_tasks SET title=COALESCE($2,title),done=COALESCE($3,done),due_date=COALESCE($4::date,due_date),completed_at=CASE WHEN COALESCE($3,done) THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$1 RETURNING id,title,done,due_date::text AS "dueDate"',[id,textField(args.title,250)||null,typeof args.done==="boolean"?args.done:null,args.dueDate??null]);
   return {data:{updated:records.length===1,task:records[0]||null}};
 }
 if(name==="list_workouts"){
   if(!isDate(args.date))return {error:"Invalid date"};
   const workouts=await sql.unsafe('SELECT id,workout_date::text AS date,title,duration_minutes AS "durationMinutes",notes,exercises FROM workout_entries WHERE workout_date=$1::date ORDER BY created_at DESC',[args.date]);
   return {data:{date:args.date,workouts,count:workouts.length}};
 }
 if(name==="add_workout"){
   const title=textField(args.title,200),key=textField(args.idempotencyKey,150);
   if(!isDate(args.date)||!title||!key||args.durationMinutes!=null&&!validNumber(args.durationMinutes,1440))return {error:"Valid date, title, idempotencyKey and optional durationMinutes required"};
   if(args.exercises!=null&&(!Array.isArray(args.exercises)||!args.exercises.every(x=>typeof x==="string")||args.exercises.length>100))return {error:"Invalid exercises list"};
   const id="workout-chatgpt-"+await digest(identity.owner+"|"+args.date+"|"+key);
   const created=await sql.unsafe('INSERT INTO workout_entries(id,workout_date,title,duration_minutes,notes,exercises) VALUES($1,$2::date,$3,$4,$5,$6::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',[id,args.date,title,args.durationMinutes??null,textField(args.notes,1000)||null,JSON.stringify(args.exercises||[])]);
   const records=await sql.unsafe('SELECT id,workout_date::text AS date,title,duration_minutes AS "durationMinutes",notes,exercises FROM workout_entries WHERE id=$1',[id]);
   return {data:{saved:records.length===1,created:created.length===1,workout:records[0]||null}};
 }
 if(name==="update_workout"){
   const id=textField(args.id,200);if(!id)return {error:"id required"};
   if(args.durationMinutes!=null&&!validNumber(args.durationMinutes,1440))return {error:"Invalid duration"};
   if(args.exercises!=null&&(!Array.isArray(args.exercises)||!args.exercises.every(x=>typeof x==="string")))return {error:"Invalid exercises"};
   const rows=await sql.unsafe('UPDATE workout_entries SET title=COALESCE($2,title),duration_minutes=COALESCE($3,duration_minutes),notes=COALESCE($4,notes),exercises=COALESCE($5::jsonb,exercises),updated_at=now() WHERE id=$1 RETURNING id,title,duration_minutes AS "durationMinutes",notes,exercises',[id,textField(args.title,200)||null,args.durationMinutes??null,args.notes==null?null:textField(args.notes,1000),args.exercises==null?null:JSON.stringify(args.exercises)]);
   return {data:{updated:rows.length===1,workout:rows[0]||null}};
 }
 if(name==="list_german_words"){
   const words=await sql.unsafe('SELECT id,word,translation,context,source_url AS "sourceUrl",repetition,due_date::text AS "dueDate" FROM german_words ORDER BY created_at DESC LIMIT 1000');
   return {data:{words,count:words.length}};
 }
 if(name==="add_german_word"){
   const word=textField(args.word,160);if(!word)return {error:"word required"};
   const id="word-"+rnd();
   const rows=await sql.unsafe('INSERT INTO german_words(id,word,translation,context,source_url) VALUES($1,$2,$3,$4,$5) RETURNING id,word,translation,context,source_url AS "sourceUrl"',[id,word,textField(args.translation,500),textField(args.context,1000),textField(args.sourceUrl,1000)]);
   return {data:{saved:rows.length===1,word:rows[0]||null}};
 }
 if(name==="update_german_word"){
   const id=textField(args.id,200);if(!id||args.dueDate!=null&&!isDate(args.dueDate))return {error:"Invalid id or dueDate"};
   if(args.repetition!=null&&(!Number.isInteger(args.repetition)||args.repetition<0||args.repetition>9))return {error:"Invalid repetition"};
   const rows=await sql.unsafe('UPDATE german_words SET translation=COALESCE($2,translation),repetition=COALESCE($3,repetition),due_date=COALESCE($4::date,due_date),updated_at=now() WHERE id=$1 RETURNING id,word,translation,repetition,due_date::text AS "dueDate"',[id,args.translation==null?null:textField(args.translation,500),args.repetition??null,args.dueDate??null]);
   return {data:{updated:rows.length===1,word:rows[0]||null}};
 }
 if(name==="get_card_progress"){
   const rows=await sql.unsafe("SELECT payload,updated_at FROM personal_quiz_snapshots WHERE owner_hash=$1",[identity.owner]);
   const state=rows[0]?.payload||{};
   const invalid=state.invalid||{},deleted=state.deleted||{},overrides=state.overrides||{};
   const cards=Object.entries(state.progress||{}).filter(([id])=>
     !Object.prototype.hasOwnProperty.call(invalid,id)&&
     !Object.prototype.hasOwnProperty.call(deleted,id)&&!overrides[id]?.deleted
   ).map(([cardId,p])=>({cardId,...p,known:typeof p.lastCorrect==="boolean"?p.lastCorrect:null}));
   return {data:{cards,count:cards.length,updatedAt:rows[0]?.updated_at||null}};
 }
 if(name==="get_daily_overview"){
   if(!isDate(args.date))return {error:"Invalid date; use YYYY-MM-DD"};
   const food=await sql.unsafe("SELECT id,name,kcal FROM nutrition_entries WHERE entry_date=$1::date",[args.date]);
   const workout=await sql.unsafe("SELECT id,title,duration_minutes AS durationMinutes,notes FROM workout_entries WHERE workout_date=$1::date",[args.date]);
   const tasks=await sql.unsafe("SELECT id,title,done FROM study_tasks WHERE due_date=$1::date",[args.date]);
   return {data:{date:args.date,caloriesEaten:food.reduce((sum,x)=>sum+Number(x.kcal||0),0),foods:food,workouts:workout,tasks}};
 }
 return {error:"Unknown personal tool"};
}

// Match the website catalog and its saved-progress/flashcard merge order.
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const iso = value => value instanceof Date ? value.toISOString() : String(value || '');
const percent = value => Math.max(0, Math.min(100, Number(value) || 0));
function flattenStudyCatalog(data) {
  if (!obj(data) || !Array.isArray(data.semesters)) throw new Error('Invalid study catalog');
  const entries = [], ids = new Set();
  for (const semester of data.semesters) {
    for (const exam of Array.isArray(semester.exams) ? semester.exams : []) {
      const topics = new Map((Array.isArray(exam.topics) ? exam.topics : []).map(t => [t.id, t.title]));
      for (const skill of Array.isArray(exam.skills) ? exam.skills : []) {
        if (!obj(skill) || typeof skill.id !== 'string' || !skill.id || skill.id.length > 200) {
          throw new Error('Invalid skill ID in study catalog');
        }
        if (ids.has(skill.id)) throw new Error('Duplicate skill ID in study catalog');
        ids.add(skill.id);
        entries.push({skill, semesterId:semester.id, semesterTitle:semester.title,
          examId:exam.id, examTitle:exam.title, topicId:skill.topicId || null,
          topicTitle:topics.get(skill.topicId) || null});
      }
    }
  }
  if (!entries.length) throw new Error('Study catalog has no skills');
  return entries;
}
function resolveStudyProgress(data, records = [], snapshot = {}) {
  const catalog = flattenStudyCatalog(data);
  const saved = new Map(records.map(r => [r.skillId, r]));
  const cardProgress = obj(snapshot.progress) ? snapshot.progress : {};
  const ids = new Set(catalog.map(x => x.skill.id));
  const progress = catalog.map(entry => {
    const {skill, ...context} = entry;
    const baselineDate = iso(skill.lastUpdated).slice(0, 10) || '1900-01-01';
    const baselineMastery = percent(skill.mastery);
    let mastery = baselineMastery;
    let repetition = Math.max(0, Number(skill.review?.repetition) || 0);
    let dueDate = skill.review?.dueDate || null;
    let lastResult = skill.review?.lastResult || null;
    let updatedAt = iso(skill.lastUpdated) || null;
    let lastUpdated = iso(skill.lastUpdated).slice(0, 10) || null;
    let savedMastery = null, source = 'catalog';
    const record = saved.get(skill.id);
    const savedDate = iso(record?.updatedAt).slice(0, 10);
    if (record && (!savedDate || savedDate >= baselineDate) && Number.isFinite(Number(record.mastery))) {
      mastery = percent(record.mastery);
      savedMastery = mastery;
      repetition = Math.max(0, Number(record.repetition) || 0);
      dueDate = record.dueDate || null;
      lastResult = record.lastResult || null;
      updatedAt = iso(record.updatedAt) || updatedAt;
      if (savedDate) lastUpdated = savedDate;
      source = 'saved';
    }
    const cards = Array.isArray(skill.flashcards) ? skill.flashcards : [];
    let quizMastery = null;
    if (cards.length && cards.some(card => obj(cardProgress[card.id]))) {
      const known = cards.filter(card => Number(cardProgress[card.id]?.repetitionNumber || 0) >= 1).length;
      quizMastery = Math.round(known / cards.length * 100);
      if (quizMastery > mastery) { mastery = quizMastery; source += '+quiz'; }
      const dates = cards.map(card => iso(cardProgress[card.id]?.updatedAt)).filter(Boolean).sort();
      if (dates.length) lastUpdated = dates[dates.length - 1].slice(0, 10);
    }
    return {skillId:skill.id, title:skill.title || skill.id, section:'study', ...context,
      subtitle:skill.subtitle || null, mastery, baselineMastery, savedMastery, quizMastery,
      repetition, dueDate, lastResult, updatedAt, lastUpdated, source};
  });
  return {progress, unmatchedSavedSkillIds:records.filter(r => !ids.has(r.skillId)).map(r => r.skillId)};
}
function validateStudyPatch(args) {
  if (!obj(args) || typeof args.skillId !== 'string' || !args.skillId.trim() ||
      args.skillId.trim() !== args.skillId || args.skillId.length > 200) throw new Error('Invalid skillId');
  if (!Number.isInteger(args.mastery) || args.mastery < 0 || args.mastery > 100) {
    throw new Error('mastery must be an integer from 0 to 100');
  }
  const patch = {skillId:args.skillId, mastery:args.mastery};
  if (own(args, 'repetition')) {
    if (!Number.isInteger(args.repetition) || args.repetition < 0 || args.repetition > 1000) {
      throw new Error('Invalid repetition');
    }
    patch.repetition = args.repetition;
  }
  if (own(args, 'dueDate')) {
    if (typeof args.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate) ||
        !Number.isFinite(Date.parse(args.dueDate)) || new Date(args.dueDate).toISOString().slice(0,10) !== args.dueDate) {
      throw new Error('Invalid dueDate; use YYYY-MM-DD');
    }
    patch.dueDate = args.dueDate;
  }
  if (own(args, 'lastResult')) {
    if (typeof args.lastResult !== 'string' || args.lastResult.length > 500) throw new Error('Invalid lastResult');
    patch.lastResult = args.lastResult.trim() || null;
  }
  return patch;
}
function mergeStudyPatch(current, patch) {
  return {skillId:patch.skillId, mastery:patch.mastery,
    repetition:own(patch, 'repetition') ? patch.repetition : current.repetition,
    dueDate:own(patch, 'dueDate') ? patch.dueDate : current.dueDate,
    lastResult:own(patch, 'lastResult') ? patch.lastResult : current.lastResult};
}
function createStudyProgressTools({sql, site, fetcher = fetch, now = () => Date.now()}) {
  let cached = null, cachedAt = 0, pending = null;
  const columns = 'skill_id AS "skillId",mastery,repetition,due_date::text AS "dueDate",last_result AS "lastResult",updated_at AS "updatedAt"';
  async function catalog() {
    if (cached && now() - cachedAt < 60000) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(site + '/data/study.json', {
        signal:AbortSignal.timeout(8000), headers:{'Cache-Control':'no-cache'}
      });
      if (!response.ok) throw new Error('Study catalog unavailable (HTTP ' + response.status + ')');
      const data = await response.json();
      flattenStudyCatalog(data);
      cached = data; cachedAt = now();
      return data;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function snapshot(owner) {
    const rows = await sql.unsafe('SELECT payload,updated_at FROM personal_quiz_snapshots WHERE owner_hash=$1', [owner]);
    return {state:rows[0]?.payload || {}, updatedAt:rows[0]?.updated_at || null};
  }
  function cardRows(state) {
    const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
    return Object.entries(state.progress || {}).filter(([id, p]) => p && typeof p === 'object' &&
      !has(state.invalid, id) && !has(state.deleted, id) && !state.overrides?.[id]?.deleted
    ).map(([cardId, p]) => ({cardId, ...p, known:typeof p.lastCorrect === 'boolean' ? p.lastCorrect : null}));
  }
  async function read(owner) {
    const [data, saved, quiz] = await Promise.all([
      catalog(), sql.unsafe('SELECT ' + columns + ' FROM study_progress ORDER BY skill_id'), snapshot(owner)
    ]);
    const resolved = resolveStudyProgress(data, saved, quiz.state), cards = cardRows(quiz.state);
    return {...resolved, count:resolved.progress.length, cards, cardCount:cards.length,
      cardProgressUpdatedAt:quiz.updatedAt, catalogUpdatedAt:data.updatedAt || null,
      catalogUrl:site + '/data/study.json', connectorVersion:'1.4.0'};
  }
  async function update(args, owner) {
    const patch = validateStudyPatch(args);
    const data = await catalog();
    if (!flattenStudyCatalog(data).some(entry => entry.skill.id === patch.skillId)) {
      throw new Error('Unknown skillId. Read get_study_progress and use an existing map skill ID.');
    }
    const quiz = await snapshot(owner);
    const result = await sql.begin(async tx => {
      await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))', ['study-progress:' + patch.skillId]);
      const rows = await tx.unsafe('SELECT ' + columns + ' FROM study_progress WHERE skill_id=$1 FOR UPDATE', [patch.skillId]);
      const current = resolveStudyProgress(data, rows, {}).progress.find(row => row.skillId === patch.skillId);
      const next = mergeStudyPatch(current, patch), old = rows[0];
      if (old && current.savedMastery !== null && Number(old.mastery) === next.mastery && Number(old.repetition) === next.repetition &&
          (old.dueDate || null) === next.dueDate && (old.lastResult || null) === next.lastResult) {
        return {row:old, changed:false};
      }
      const saved = await tx.unsafe(
        'INSERT INTO study_progress(skill_id,mastery,repetition,due_date,last_result,updated_at) VALUES($1,$2,$3,$4::date,$5,now()) ' +
        'ON CONFLICT(skill_id) DO UPDATE SET mastery=excluded.mastery,repetition=excluded.repetition,due_date=excluded.due_date,last_result=excluded.last_result,updated_at=now() RETURNING ' + columns,
        [next.skillId,next.mastery,next.repetition,next.dueDate,next.lastResult]
      );
      if (saved.length !== 1) throw new Error('Study progress write could not be verified');
      return {row:saved[0], changed:true};
    });
    const progress = resolveStudyProgress(data, [result.row], quiz.state).progress.find(row => row.skillId === patch.skillId);
    return {saved:true, changed:result.changed, progress, connectorVersion:'1.4.0'};
  }
  return {read, update};
}
const studyProgressTools = createStudyProgressTools({sql, site:SITE});
const studySessionStore = createStudySessionStore({sql, loadCatalog:() => loadStudySessionCatalog(SITE)});

export default app;

const studyCardStore = createStudyCardStore({sql,loadCatalog:() => loadStudySessionCatalog(SITE)});
