import assert from 'node:assert/strict';
import {createStudyCardStore} from '../study-cards.js';

export async function cardStoreScenarios(sql) {
  const owner='cards-test-'+crypto.randomUUID();
  const original={id:'original',question:'Original question',answer:'Yes',wrongAnswer1:'No',wrongAnswer2:'Maybe',wrongAnswer3:'Never',explanation:'Explanation'};
  const catalog={semesters:[{id:'semester',exams:[{id:'exam',skills:[{id:'skill',title:'Skill',flashcards:[original]}]}]}]};
  const store=createStudyCardStore({sql,loadCatalog:async()=>structuredClone(catalog)});
  const filters={semesterId:'semester',examId:'exam'};
  const card=n=>({skillId:'skill',question:'Question '+n,answer:'Yes',wrongAnswer1:'No',wrongAnswer2:'Maybe',wrongAnswer3:'Never',explanation:'Explanation'});
  const add=(key,cards)=>store.add(owner,{...filters,idempotencyKey:key,cards});
  await store.get(owner,filters);
  const progress={original:{repetitionNumber:4,dueDate:'2026-12-01',lastCorrect:true}};
  const seed={progress,invalid:{},custom:[],overrides:{},deleted:{},otherState:{mastery:75}};
  await sql.unsafe('INSERT INTO personal_quiz_snapshots(owner_hash,payload) VALUES($1,$2::jsonb)',[owner,sql.json(seed)]);
  try {
    const one=await add('one',[card(1)]);
    assert.equal(one.saved,true);assert.equal(one.verified,true);assert.equal(one.createdCount,1);
    assert.deepEqual(await add('one',[card(1)]),one);
    await assert.rejects(add('one',[card(2)]),/Idempotency/);
    const batch=await add('batch',[card(2),card(3),card(3),{...card(1),question:'  QUESTION   1  '}]);
    assert.equal(batch.createdCount,2);assert.equal(batch.skippedDuplicates,2);
    assert.equal((await add('existing',[{...original,skillId:'skill',id:undefined}]).catch(e=>e)).name,'StudyCardError');
    assert.equal((await add('existing-valid',[{...card(99),question:original.question}])).skippedDuplicates,1);
    await assert.rejects(add('invalid',[card(4),{...card(5),skillId:'unknown'}]),/Unknown skillId/);
    await assert.rejects(add('empty',[{...card(4),question:'  '}]),/Invalid question/);
    await assert.rejects(add('answers',[{...card(4),wrongAnswer1:'YES'}]),/answers must differ/);
    await assert.rejects(store.add(owner,{...filters,examId:'unknown',idempotencyKey:'unknown',cards:[card(4)]}),/Unknown semester/);
    await assert.rejects(add('zero',[]),/1–100/);
    await assert.rejects(add('too-many',Array.from({length:101},(_,i)=>card(i))),/1–100/);
    assert.equal((await store.get(owner,filters)).count,4,'invalid batch rolls back completely');
    const concurrent=await Promise.all(Array.from({length:8},()=>add('parallel',[card(10)])));
    for(const result of concurrent)assert.deepEqual(result,concurrent[0]);
    const distinct=await Promise.all([add('distinct-a',[card(11)]),add('distinct-b',[card(11)])]);
    assert.equal(distinct.reduce((n,x)=>n+x.createdCount,0),1,'different keys cannot race duplicate creation');
    const id=one.cardIds[0];
    await store.update(owner,{cardId:id,question:'Edited question',explanation:'Edited explanation'});
    assert.equal((await store.get(owner,filters)).cards.find(x=>x.cardId===id).explanation,'Edited explanation');
    await store.update(owner,{cardId:'original',answer:'Corrected answer'});
    assert.equal((await store.get(owner,filters)).cards.find(x=>x.cardId==='original').answer,'Corrected answer');
    await assert.rejects(store.update(owner,{cardId:id,question:original.question}),/Duplicate/);
    await assert.rejects(store.update(owner,{cardId:id,mastery:0}),/Unknown field/);
    await assert.rejects(store.delete(owner,{cardId:id,confirm:false}),/confirm=true/);
    await store.delete(owner,{cardId:id,confirm:true});
    assert.equal((await store.get(owner,filters)).cards.some(x=>x.cardId===id),false);
    await store.delete(owner,{cardId:id,confirm:true});
    const saved=(await sql.unsafe('SELECT payload FROM personal_quiz_snapshots WHERE owner_hash=$1',[owner]))[0].payload;
    assert.deepEqual(saved.progress,progress);assert.deepEqual(saved.otherState,seed.otherState);
    assert.ok(saved.custom.some(x=>x.id===id),'soft deletion retains content');
    assert.equal((await store.get(owner+'-other',filters)).count,1,'custom content is owner scoped');
    await assert.rejects(store.update(owner+'-other',{cardId:batch.cardIds[0],answer:'Other'}),/Unknown cardId/);
    console.log('PASS card creation, batch, retries, validation, duplicate races, content edits, soft deletion and progress preservation');
  } finally {
    await sql.unsafe('DELETE FROM personal_study_card_operations WHERE owner_hash=$1',[owner]);
    await sql.unsafe('DELETE FROM personal_quiz_snapshots WHERE owner_hash=$1',[owner]);
    await sql.unsafe('DELETE FROM personal_quiz_snapshots WHERE owner_hash=$1',[owner+'-other']);
  }
}
