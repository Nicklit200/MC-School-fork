import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const sandbox={window:{}};
vm.runInNewContext(readFileSync("personal-study-map/flashcard-engine.js","utf8"),sandbox);
const engine=sandbox.window.CardQuizEngine;
assert.ok(engine,"Card quiz engine should load");

const first=engine.afterReview(undefined,true,"2026-10-17");
assert.equal(first.dueDate,"2026-10-19","First correct answer should reappear after 2 days");
assert.equal(first.repetitionNumber,1);
const second=engine.afterReview(first,true,"2026-10-19");
assert.equal(second.dueDate,"2026-10-22","Second success adds 3 days");
const third=engine.afterReview(second,true,"2026-10-22");
assert.equal(third.dueDate,"2026-10-29","Third success adds 7 days");
const fourth=engine.afterReview(third,true,"2026-10-29");
assert.equal(fourth.dueDate,"2026-11-12","Fourth success adds 14 days");
const fifth=engine.afterReview(fourth,true,"2026-11-12");
assert.equal(fifth.dueDate,"2026-12-12","Fifth success adds 30 days");

const mistake=engine.afterReview(fifth,false,"2026-10-17");
assert.equal(mistake.dueDate,"2026-10-18","Mistakes must return tomorrow");
assert.equal(mistake.repetitionNumber,0);
const restart=engine.afterReview(mistake,true,"2026-10-18");
assert.equal(restart.dueDate,"2026-10-20","Successful restart should return after 2 days");

const states=Object.fromEntries(Array.from({length:106},(_,i)=>[
 "card-"+i,engine.afterReview(undefined,i<75,"2026-10-17")
]));
const due=Object.values(states).filter(x=>x.dueDate<="2026-10-18");
assert.equal(due.length,31,"Only yesterday's 31 mistakes should be due today");
assert.equal(Object.values(states).filter(x=>x.dueDate==="2026-10-19").length,75,
 "Yesterday's 75 successes should not be repeated today");

const card={id:"single",skillId:"skill",question:"One plus one?",answer:"2"};
const initial=engine.afterReview(undefined,true,"2026-10-17");
const session=engine.startSession("PRACTICE",[card],{},new Date("2026-10-17T10:00:00Z"));
engine.recordAnswer(session,card,"2");
const practice=engine.finishSession(session,[card],{single:initial},"2026-10-17");
assert.equal(practice.states.single.dueDate,initial.dueDate,
 "Free practice must not advance the schedule");

console.log("PASS: 106 cards -> 31 tomorrow, 75 later; intervals and practice correct");
