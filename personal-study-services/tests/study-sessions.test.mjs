import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {
  createStudySessionStore,legacyStudySessions,studySessionResume,
  validateStudySession,studySessionDay,StudySessionError
} from '../study-sessions.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const current=new Date('2026-11-06T12:00:00.000Z');
const subject={semesterId:'ws-2026-27',examId:'exam-computergrafik',examTitle:'Computergrafik'};
const catalog={semesters:[{id:subject.semesterId,title:'Wintersemester',exams:[{id:subject.examId,title:subject.examTitle},{id:'other',title:'Other subject'}]}],sessions:[]};
const input=(key,extra={})=>({...subject,date:'2026-11-06',idempotencyKey:key,topics:['Rendering'],...extra});
// The save contract accepts IDs, not the output-only subject title.
delete subject.examTitle;

// Model a relational store: unique owner/key, independent owner predicates,
// transactional rollback, tuple ordering, filtering and bounded SELECT pages.
// Bun binds a bare JS string to JSONB as a JSON string. The explicit json()
// wrapper is required here too, so JSON.stringify can no longer mask the bug.
// This intentionally does not emulate the application's merge/resume logic.
class MemoryPostgres {
  records=[];
  nextRecordedOrder=1n;
  now=()=>current;
  calls=[];
  json(value){return {__jsonParameter:true,value:structuredClone(value)};}
  jsonValue(value){return structuredClone(value?.__jsonParameter===true?value.value:value);}
  async begin(action){
    const snapshot=structuredClone(this.records);
    const tx={unsafe:(query,params)=>this.execute(query,params,true),json:value=>this.json(value)};
    try{
      const result=await action(tx);
      this.calls.push({query:'COMMIT',params:[],transaction:true});
      await this.afterCommit?.();
      return result;
    }catch(error){this.records=snapshot;throw error;}
  }
  async unsafe(query,params=[]){
    return this.execute(query,params,false);
  }
  async execute(query,params=[],transaction=false){
    this.calls.push({query,params,transaction});
    if(/^CREATE (TABLE|INDEX) /.test(query))return [];
    if(query.startsWith('INSERT INTO personal_study_sessions(')){
      const [owner_hash,session_id,idempotency_key,request_fingerprint,semester_id,exam_id,material_id,session_date,occurred_at,payload]=params;
      if(this.records.some(row=>row.owner_hash===owner_hash&&row.idempotency_key===idempotency_key))return [];
      assert.equal(this.records.some(row=>row.owner_hash===owner_hash&&row.session_id===session_id),false,'session primary key');
      const row={owner_hash,session_id,idempotency_key,request_fingerprint,semester_id,exam_id,material_id,session_date,occurred_at,createdAt:this.now().toISOString(),recordedOrder:String(this.nextRecordedOrder++),payload:this.jsonValue(payload)};
      this.beforeInsert?.(row);
      this.records.push(row);
      return [{session_id}];
    }
    if(query.startsWith('UPDATE personal_study_sessions SET payload=')){
      const payload=query.match(/SET payload=\$(\d+)/);
      assert.ok(payload,'Repair supplies a bound JSON value');
      let selected=this.records.slice();
      for(const match of query.matchAll(/\b(owner_hash|session_id|request_fingerprint)=\$(\d+)/g))
        selected=selected.filter(row=>row[match[1]]===params[Number(match[2])-1]);
      assert.match(query,/owner_hash=\$\d+/,'Repair must be owner-scoped');
      assert.match(query,/session_id=\$\d+/,'Repair must target the original session');
      if(query.includes("jsonb_typeof(payload)='string'"))selected=selected.filter(row=>typeof row.payload==='string');
      for(const row of selected)row.payload=this.jsonValue(params[Number(payload[1])-1]);
      return selected.map(row=>({session_id:row.session_id,sessionId:row.session_id}));
    }
    if(/^SELECT\s/.test(query)&&query.includes('FROM personal_study_sessions')){
      let selected=this.records.slice();
      for(const match of query.matchAll(/\b(owner_hash|session_id|idempotency_key|semester_id|exam_id|material_id|session_date)=\$(\d+)/g)){
        selected=selected.filter(row=>row[match[1]]===params[Number(match[2])-1]);
      }
      const tuple=query.match(/\(occurred_at,created_at,recorded_order,session_id\)<\(\$(\d+)::timestamptz,\$(\d+)::timestamptz,\$(\d+)::bigint,\$(\d+)\)/);
      const compare=(a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at)||Date.parse(a.createdAt)-Date.parse(b.createdAt)||(BigInt(a.recordedOrder)<BigInt(b.recordedOrder)?-1:BigInt(a.recordedOrder)>BigInt(b.recordedOrder)?1:0)||(a.session_id<b.session_id?-1:a.session_id>b.session_id?1:0);
      if(tuple){
        const boundary={occurred_at:params[Number(tuple[1])-1],createdAt:params[Number(tuple[2])-1],recordedOrder:params[Number(tuple[3])-1],session_id:params[Number(tuple[4])-1]};
        selected=selected.filter(row=>compare(row,boundary)<0);
      }
      if(query.includes('ORDER BY'))selected.sort((a,b)=>compare(b,a));
      const limit=query.match(/LIMIT \$(\d+)/);
      if(limit)selected=selected.slice(0,params[Number(limit[1])-1]);
      return structuredClone(selected.map(row=>({payload:row.payload,createdAt:row.createdAt,recordedOrder:row.recordedOrder,request_fingerprint:row.request_fingerprint,
        sessionId:row.session_id,semesterId:row.semester_id,examId:row.exam_id,materialId:row.material_id,sessionDate:row.session_date,occurredAt:row.occurred_at})));
    }
    throw Error('Unsupported test SQL: '+query);
  }
}
function fixture(data=catalog){
  const sql=new MemoryPostgres();
  return {sql,store:createStudySessionStore({sql,loadCatalog:async()=>structuredClone(data),now:()=>current})};
}
const rejectSession=(action,pattern)=>assert.rejects(action,error=>error instanceof StudySessionError&&pattern.test(error.message));

test('validates exact slide arithmetic, terminal positions, Berlin dates and actual input types',()=>{
  assert.equal(validateStudySession(input('sixty',{lastCompletedSlide:60,nextSlide:61}),current).lastCompletedSlide,60);
  assert.throws(()=>validateStudySession(input('wrong',{lastCompletedSlide:60,nextSlide:62}),current),/nextSlide/);
  assert.equal(validateStudySession(input('end',{lastCompletedSlide:60,totalSlides:60,nextSlide:null}),current).nextSlide,null);
  assert.throws(()=>validateStudySession(input('past-end',{lastCompletedSlide:61,totalSlides:60}),current),/exceeds totalSlides/);
  assert.throws(()=>validateStudySession(input('no-last',{nextSlide:61}),current),/lastCompletedSlide required/);
  for(const value of [-1,1.5,'60',null,Infinity])assert.throws(()=>validateStudySession(input('bad-slide',{lastCompletedSlide:value}),current),/lastCompletedSlide/);
  assert.throws(()=>validateStudySession(input('future',{date:'2026-11-07'}),current),/Invalid date/);
  assert.throws(()=>validateStudySession(input('bad-day',{date:'2026-02-30'}),current),/Invalid date/);
  assert.throws(()=>validateStudySession(input('bad-list',{topics:['']}),current),/topic/);
  assert.throws(()=>validateStudySession(input('unexpected',{mastery:100}),current),/Invalid field/);
  assert.equal(studySessionDay('2026-11-05T23:30:00.000Z'),'2026-11-06');
  assert.equal(validateStudySession(input('berlin',{occurredAt:'2026-11-05T23:30:00Z'}),current).date,'2026-11-06');
  assert.throws(()=>validateStudySession(input('wrong-date',{occurredAt:'2026-11-05T20:00:00Z'}),current),/must match date/);
});

test('legacy opened page is not a completed slide, and checkpoint notes remain intact',()=>{
  const data={...catalog,sessions:[
    {...subject,id:'opened',date:'2026-10-12',checkpoint:{document:'UML.pdf',page:50,lastExplainedPage:48,totalPages:163,note:'49–50 ещё не разобраны'}},
    {...subject,id:'only-opened',date:'2026-10-11',checkpoint:{document:'Other.pdf',page:99}}
  ]};
  const rows=legacyStudySessions(data);
  assert.equal(rows[0].lastCompletedSlide,48);
  assert.equal(rows[0].nextSlide,49);
  assert.equal(rows[0].positionNote,'49–50 ещё не разобраны');
  assert.equal(rows[1].lastCompletedSlide,null);
  assert.equal(rows[1].nextSlide,null);
});

test('real saved Computergrafik history resumes 1Pipeline.pdf at 80 after 79, dated 25 October',async()=>{
  const actual=JSON.parse(readFileSync(new URL('../../personal-study-map/data/study.json',import.meta.url),'utf8'));
  const {store}=fixture(actual);
  const resumed=await store.resume('owner-a',subject);
  assert.equal(resumed.latestSession.id,'session-2026-10-25-computergrafik-to-79');
  assert.equal(resumed.latestSession.date,'2026-10-25');
  assert.equal(resumed.materialId,'1Pipeline.pdf');
  assert.equal(resumed.lastCompletedSlide,79);
  assert.equal(resumed.nextSlide,80);
  assert.equal(resumed.totalSlides,107);
  assert.equal(resumed.needsMaterialSelection,false);
});

test('topics-only session preserves the last confirmed position and does not write mastery',async()=>{
  const {store,sql}=fixture();
  const first=await store.save('owner-a',input('first',{materialId:'pdf-a',lastCompletedSlide:60,totalSlides:107,occurredAt:'2026-11-06T09:00:00Z'}));
  assert.equal(first.session.type,'study_session');
  assert.equal(first.resume.nextSlide,61);
  const next=await store.save('owner-a',input('topics-only',{materialId:'pdf-a',topics:['Quaternionen'],summary:'Повторили определение',occurredAt:'2026-11-06T10:00:00Z'}));
  assert.equal(next.session.lastCompletedSlide,null);
  assert.equal(next.resume.latestSession.id,next.session.id);
  assert.equal(next.resume.positionSession.id,first.session.id);
  assert.equal(next.resume.lastCompletedSlide,60);
  assert.equal(next.resume.nextSlide,61);
  assert.equal(sql.records.length,2);
  assert.equal(sql.calls.some(({query})=>/\b(?:INSERT INTO|UPDATE) (?:study_progress|personal_quiz_)/.test(query)),false);
  await rejectSession(()=>store.save('owner-a',input('unknown',{examId:'unknown'})),/Unknown subject/);
  assert.equal(sql.records.length,2);
});

test('multiple PDFs require selection and never borrow each other’s slide positions',async()=>{
  const {store}=fixture();
  await store.save('owner-a',input('pdf-a',{materialId:'a.pdf',materialTitle:'First deck',lastCompletedSlide:60}));
  await store.save('owner-a',input('pdf-b',{materialId:'b.pdf',materialTitle:'Second deck',lastCompletedSlide:12}));
  const ambiguous=await store.resume('owner-a',subject);
  assert.equal(ambiguous.needsMaterialSelection,true);
  assert.equal(ambiguous.nextSlide,null);
  assert.equal(ambiguous.lastCompletedSlide,null);
  const exact=await store.resume('owner-a',{...subject,materialId:'a.pdf'});
  assert.equal(exact.lastCompletedSlide,60);
  assert.equal(exact.nextSlide,61);
  assert.equal(exact.materialTitle,'First deck');
  await rejectSession(()=>store.save('owner-a',input('unspecified',{lastCompletedSlide:20})),/Select materialId/);
});

test('same idempotency key retries one event, changed payload conflicts, concurrent retries deduplicate',async()=>{
  const {store,sql}=fixture();
  const request=input('same',{lastCompletedSlide:60});
  const saved=await store.save('owner-a',request);
  const retry=await store.save('owner-a',request);
  assert.equal(saved.created,true);
  assert.equal(retry.created,false);
  assert.equal(retry.session.id,saved.session.id);
  await rejectSession(()=>store.save('owner-a',{...request,lastCompletedSlide:61}),/Idempotency key already used/);
  assert.equal(sql.records.length,1);
  const concurrent=input('parallel',{lastCompletedSlide:62});
  const results=await Promise.all([store.save('owner-a',concurrent),store.save('owner-a',concurrent)]);
  assert.equal(results.filter(row=>row.created).length,1);
  assert.equal(results[0].session.id,results[1].session.id);
  assert.equal(sql.records.length,2);
});

test('persistent sessions, idempotency and resume are isolated by owner',async()=>{
  const {store}=fixture();
  await store.save('owner-a',input('shared-key',{lastCompletedSlide:60,materialId:'a'}));
  await store.save('owner-b',input('shared-key',{lastCompletedSlide:7,materialId:'b'}));
  const a=await store.history('owner-a'),b=await store.history('owner-b');
  assert.equal(a.sessions.length,1);
  assert.equal(b.sessions.length,1);
  assert.notEqual(a.sessions[0].id,b.sessions[0].id);
  assert.equal((await store.resume('owner-a',subject)).nextSlide,61);
  assert.equal((await store.resume('owner-b',subject)).nextSlide,8);
  await rejectSession(()=>store.history(''),/Unauthorized/);
});

test('backfilled historical sessions sort by study date and do not move a newer checkpoint backwards',async()=>{
  const {store}=fixture();
  const recent=await store.save('owner-a',input('recent',{lastCompletedSlide:60}));
  const old=await store.save('owner-a',input('old',{date:'2026-10-02',lastCompletedSlide:10}));
  assert.equal(old.resume.lastCompletedSlide,60);
  assert.equal(old.resume.positionSession.id,recent.session.id);
  const history=await store.history('owner-a');
  assert.deepEqual(history.sessions.map(row=>row.id),[recent.session.id,old.session.id]);
});

test('pagination exhausts more than 100 events with timestamp ties without losses, duplicates or owner leakage',async()=>{
  const legacy=Array.from({length:115},(_,i)=>({...subject,id:'legacy-page-'+String(i).padStart(3,'0'),date:'2026-11-06',occurredAt:'2026-11-06T10:00:00.000Z',createdAt:current.toISOString(),title:'Legacy study event '+i}));
  const {store}=fixture({...catalog,sessions:legacy});
  const expected=new Set(legacy.map(row=>row.id));
  for(let i=0;i<137;i++){
    const saved=await store.save('owner-a',input('page-'+i,{lastCompletedSlide:i,occurredAt:'2026-11-06T10:00:00Z'}));
    expected.add(saved.session.id);
  }
  await store.save('owner-b',input('outside-owner',{lastCompletedSlide:999,occurredAt:'2026-11-06T10:00:00Z'}));
  await store.save('owner-a',input('outside-subject',{examId:'other',lastCompletedSlide:3}));
  await store.save('owner-a',input('outside-date',{date:'2026-10-01',lastCompletedSlide:2}));
  const found=[],cursors=new Set();
  let cursor;
  do{
    const page=await store.history('owner-a',{...subject,date:'2026-11-06',limit:100,...(cursor?{cursor}:{})});
    assert.ok(page.sessions.length<=100);
    found.push(...page.sessions.map(row=>row.id));
    cursor=page.nextCursor;
    if(cursor){assert.equal(cursors.has(cursor),false,'pagination must advance');cursors.add(cursor);}
  }while(cursor);
  assert.equal(found.length,252);
  assert.equal(new Set(found).size,252);
  assert.deepEqual(new Set(found),expected);
  assert.equal(cursors.size,2);
  await rejectSession(()=>store.history('owner-a',{limit:101}),/Invalid limit/);
  await rejectSession(()=>store.history('owner-a',{cursor:'not-a-cursor'}),/Invalid cursor/);
});

test('terminal confirmation may use an already saved totalSlides',async()=>{
  const {store}=fixture();
  await store.save('owner-a',input('nearly-done',{lastCompletedSlide:59,totalSlides:60}));
  const final=await store.save('owner-a',input('all-done',{lastCompletedSlide:60,nextSlide:null}));
  assert.equal(final.session.totalSlides,60);
  assert.equal(final.session.nextSlide,null);
  assert.equal(final.resume.completed,true);
});

test('sequential saves with identical timestamps keep the later checkpoint and latest session',async()=>{
  const {store}=fixture();
  let previous;
  for(let i=40;i<=60;i++){
    const saved=await store.save('owner-a',input('same-millisecond-'+i,{lastCompletedSlide:i,totalSlides:60}));
    if(previous){
      assert.equal(saved.session.occurredAt,previous.session.occurredAt,'frozen event clock');
      assert.equal(saved.session.createdAt,previous.session.createdAt,'frozen database clock');
      assert.ok(BigInt(saved.session.recordedOrder)>BigInt(previous.session.recordedOrder));
    }
    assert.equal(saved.resume.lastCompletedSlide,i);
    assert.equal(saved.resume.latestSession.id,saved.session.id);
    assert.equal(saved.resume.positionSession.id,saved.session.id);
    previous=saved;
  }
  assert.equal(previous.resume.completed,true);
  assert.equal(previous.resume.nextSlide,null);
  const history=await store.history('owner-a');
  assert.deepEqual(history.sessions.map(row=>row.lastCompletedSlide),Array.from({length:21},(_,i)=>60-i));
});

test('a general knowledge update does not invent another presentation next to one real PDF',()=>{
  const data={...catalog,sessions:[
    {...subject,id:'general',date:'2026-10-10',title:'Updated skill mastery'},
    {...subject,id:'pdf',date:'2026-10-12',checkpoint:{document:'a.pdf',lastExplainedPage:60}}
  ]};
  const result=studySessionResume({...subject,examTitle:'Computergrafik'},legacyStudySessions(data));
  assert.equal(result.needsMaterialSelection,false);
  assert.equal(result.materials.length,1);
  assert.equal(result.nextSlide,61);
});

test('Bun JSON binding keeps a bare string scalar and the store writes an explicit JSON object',async()=>{
  const {sql,store}=fixture();
  const encoded=JSON.stringify({id:'example'});
  assert.equal(sql.jsonValue(encoded),encoded,'A driver-bound JSON string is not JSON.parse input');
  assert.deepEqual(sql.jsonValue(sql.json({id:'example'})),{id:'example'});
  const saved=await store.save('owner-a',input('object-binding',{materialId:'1Pipeline.pdf',lastCompletedSlide:90,nextSlide:91}));
  assert.equal(typeof sql.records[0].payload,'object');
  assert.equal(sql.records[0].payload.id,saved.session.id);
  assert.equal(saved.saved,true);
  assert.equal((await store.history('owner-a',{...subject,materialId:'1Pipeline.pdf'})).sessions[0].id,saved.session.id);
});

test('a previously encoded JSON string is repaired in place without another session or owner/history changes',async()=>{
  const data={...catalog,sessions:[{...subject,id:'old-79',date:'2026-10-25',checkpoint:{document:'1Pipeline.pdf',lastExplainedPage:79,nextPage:80,totalPages:107}}]};
  const originalCatalog=structuredClone(data);
  const {sql,store}=fixture(data);
  const request=input('already-saved',{materialId:'1Pipeline.pdf',lastCompletedSlide:90,nextSlide:91,totalSlides:107,title:'Already saved lecture',summary:'Confirmed checkpoint',topics:['Projektionen']});
  const saved=await store.save('owner-a',request);
  await store.save('owner-b',input('other-owner',{materialId:'1Pipeline.pdf',lastCompletedSlide:12}));
  const row=sql.records.find(row=>row.owner_hash==='owner-a'),other=sql.records.find(row=>row.owner_hash==='owner-b');
  const originalPayload=structuredClone(row.payload);
  row.payload=JSON.stringify(row.payload);
  other.payload=JSON.stringify(other.payload);
  const otherBefore=structuredClone(other);
  const inserts=sql.calls.filter(call=>call.query.startsWith('INSERT INTO personal_study_sessions')).length;
  const page=await store.history('owner-a',{...subject,date:'2026-11-06',materialId:'1Pipeline.pdf'});
  assert.equal(page.sessions.length,1);
  assert.equal(page.sessions[0].id,saved.session.id);
  assert.equal(page.sessions[0].lastCompletedSlide,90);
  assert.equal(page.sessions[0].nextSlide,91);
  assert.deepEqual(row.payload,originalPayload,'Only representation changes; the original session content and ID remain');
  assert.deepEqual(other,otherBefore,'Repair never touches another owner');
  assert.equal(sql.records.length,2);
  assert.equal(sql.calls.filter(call=>call.query.startsWith('INSERT INTO personal_study_sessions')).length,inserts);
  const resumed=await store.resume('owner-a',{...subject,materialId:'1Pipeline.pdf'});
  assert.equal(resumed.positionSession.id,saved.session.id);
  assert.equal(resumed.lastCompletedSlide,90);
  assert.equal(resumed.nextSlide,91);
  const retried=await store.save('owner-a',request);
  assert.equal(retried.saved,true);
  assert.equal(retried.created,false);
  assert.equal(retried.session.id,saved.session.id);
  assert.deepEqual(data,originalCatalog);
  assert.equal(sql.calls.some(({query})=>/\b(?:INSERT INTO|UPDATE) (?:study_progress|personal_quiz_)/.test(query)),false);
});

test('malformed or mismatched stored payloads never produce a successful save acknowledgement',async()=>{
  for(const corrupt of [row=>{row.payload='not JSON';},row=>{row.payload={...row.payload,id:'wrong-id'};}]){
    const {sql,store}=fixture();
    sql.beforeInsert=corrupt;
    await assert.rejects(()=>store.save('owner-a',input('corrupted-write',{lastCompletedSlide:90})),/session|payload|verif|stored/i);
  }
});

test('saved true requires a committed row that can be read back outside the write transaction',async()=>{
  const {sql,store}=fixture();
  sql.afterCommit=()=>{sql.records=[];};
  await assert.rejects(()=>store.save('owner-a',input('commit-not-visible',{lastCompletedSlide:90})),/session|payload|verif|stored/i);
  const committed=sql.calls.findIndex(call=>call.query==='COMMIT');
  assert.ok(committed>=0,'The transaction completed before verification');
  assert.ok(sql.calls.slice(committed+1).some(call=>!call.transaction&&/^SELECT\s/.test(call.query)&&call.query.includes('FROM personal_study_sessions')),
    'Save must independently read committed storage');
});
