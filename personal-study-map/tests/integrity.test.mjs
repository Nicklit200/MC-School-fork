import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import vm from 'node:vm';
const root='personal-study-map/';
for(const name of readdirSync(root).filter(n=>n.endsWith('.js')&&n!=='app.js')){
  new vm.Script(readFileSync(root+name,'utf8'),{filename:name});
}
const sandbox={window:{},Date,Intl};
vm.runInNewContext(readFileSync(root+'flashcard-engine.js','utf8'),sandbox);
const e=sandbox.window.CardQuizEngine;
assert.equal(e.isoDay('2026-10-20T22:05:00Z'),'2026-10-21');
assert.equal(e.isoDay('2026-10-24T22:05:00Z'),'2026-10-25');
assert.equal(e.plusDays('2026-10-24',2),'2026-10-26');
assert.equal(e.plusDays('2026-12-31',1),'2027-01-01');
const first=e.afterReview(undefined,true,'2026-10-20');
const wrong=e.afterReview(undefined,false,'2026-10-20');
assert.equal(first.dueDate,'2026-10-22');
assert.equal(wrong.dueDate,'2026-10-21');
assert.equal(e.afterReview(first,true,'2026-10-22').dueDate,'2026-10-25');
assert.equal(e.afterReview(first,false,'2026-10-22').dueDate,'2026-10-23');
const card={id:'stable-id',question:'2+2?',answer:'4'};
const session=e.startSession('SCHEDULED',[card],{},new Date('2026-10-20T10:00:00Z'));
e.recordAnswer(session,card,'3');e.recordAnswer(session,card,'4');
const done=e.finishSession(session,[card],{},'2026-10-20');
assert.equal(done.result.correctFirstTry,0);
assert.equal(done.states['stable-id'].dueDate,'2026-10-21');
assert.equal(done.result.review[0].cardId,'stable-id');
const ids=[];
function walk(value){if(!value||typeof value!=='object')return;if(Array.isArray(value.flashcards))for(const c of value.flashcards){assert.equal(typeof c.id,'string');assert.ok(c.id.length);ids.push(c.id);}for(const [k,v] of Object.entries(value))if(k!=='flashcards')walk(v);}
walk(JSON.parse(readFileSync(root+'data/study.json','utf8')));
assert.ok(ids.length>0);
assert.equal(new Set(ids).size,ids.length,'Card IDs must be globally unique');
console.log('PASS syntax, Berlin midnight, DST, year rollover, first-attempt scoring, stable unique IDs: '+ids.length);
