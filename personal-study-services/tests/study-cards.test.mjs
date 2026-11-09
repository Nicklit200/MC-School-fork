import assert from 'node:assert/strict';
import {cardStoreScenarios} from './card-store-scenarios.mjs';
import {createStudyCardStore} from '../study-cards.js';

function fakeDatabase() {
  let snapshots=new Map(), operations=new Map(), tail=Promise.resolve();
  const db={json:structuredClone,async unsafe(q,p=[]) {
    const [owner,key]=p;
    if(q.startsWith('CREATE ')||q.startsWith('SELECT pg_advisory'))return [];
    if(q.startsWith('SELECT payload'))return snapshots.has(owner)?[{payload:structuredClone(snapshots.get(owner))}]:[];
    if(q.startsWith('INSERT INTO personal_quiz_snapshots')){if(!snapshots.has(owner))snapshots.set(owner,typeof key==='object'?structuredClone(key):{});return [];}
    if(q.startsWith('SELECT request,result'))return operations.has(owner+'|'+key)?[structuredClone(operations.get(owner+'|'+key))]:[];
    if(q.startsWith('INSERT INTO personal_study_card_operations')){operations.set(owner+'|'+key,{request:structuredClone(p[2]),result:structuredClone(p[3])});return [];}
    if(q.startsWith('UPDATE personal_quiz_snapshots')){snapshots.set(owner,{...snapshots.get(owner),custom:structuredClone(p[1]),overrides:structuredClone(p[2]),deleted:structuredClone(p[3]),cardContentRevision:p[4]});return [];}
    if(q.startsWith('DELETE FROM personal_quiz_snapshots')){snapshots.delete(owner);return [];}
    if(q.startsWith('DELETE FROM personal_study_card_operations')){for(const k of operations.keys())if(k.startsWith(owner+'|'))operations.delete(k);return [];}
    throw Error('Unexpected SQL '+q);
  },async begin(fn){
    const previous=tail;let release;tail=new Promise(resolve=>release=resolve);await previous;
    const before=[structuredClone(snapshots),structuredClone(operations)];
    try{return await fn(db);}catch(error){[snapshots,operations]=before;throw error;}finally{release();}
  }};
  return db;
}
await cardStoreScenarios(fakeDatabase());
const db=fakeDatabase();const unsafe=db.unsafe.bind(db);let committed=false;
const begin=db.begin;db.begin=async fn=>{const result=await begin(fn);committed=true;return result;};
db.unsafe=async(q,p)=>committed&&q.startsWith('SELECT payload')?[]:unsafe(q,p);
const store=createStudyCardStore({sql:db,loadCatalog:async()=>({semesters:[{id:'s',exams:[{id:'e',skills:[{id:'k'}]}]}]})});
await assert.rejects(store.add('owner',{semesterId:'s',examId:'e',idempotencyKey:'key',cards:[{skillId:'k',question:'Q',answer:'A',wrongAnswer1:'B',wrongAnswer2:'C',wrongAnswer3:'D',explanation:'E'}]}),/readback/);
console.log('PASS no success when committed readback fails');

const duplicateDb=fakeDatabase();let duplicateCommitted=false;const duplicateUnsafe=duplicateDb.unsafe.bind(duplicateDb);const duplicateBegin=duplicateDb.begin;
duplicateDb.begin=async fn=>{const result=await duplicateBegin(fn);duplicateCommitted=true;return result;};
duplicateDb.unsafe=async(q,p)=>duplicateCommitted&&q.startsWith('SELECT payload')?[]:duplicateUnsafe(q,p);
const duplicateStore=createStudyCardStore({sql:duplicateDb,loadCatalog:async()=>({semesters:[{id:'s',exams:[{id:'e',skills:[{id:'k',flashcards:[{id:'existing',question:'Q',answer:'A'}]}]}]}]})});
await assert.rejects(duplicateStore.add('owner',{semesterId:'s',examId:'e',idempotencyKey:'duplicates-only',cards:[{skillId:'k',question:'Q',answer:'A',wrongAnswer1:'B',wrongAnswer2:'C',wrongAnswer3:'D',explanation:'E'}]}),/readback/);
