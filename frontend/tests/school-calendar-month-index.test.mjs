import test from "node:test";
import assert from "node:assert/strict";
import {schoolYearMonthKey,schoolYearStartForDate,indexStudentMonthlyCurricula}
  from "../public/skills-board/school-calendar-month-index.js";
import {calculateIndividualMonthReadiness}
  from "../public/skills-board/school-calendar-readiness.js";

const studentId="vitalina",boardId="grade-8-m8",schoolYearStart=2026;
const skillIds={
 "2026-09":["mc8-2-1","mc8-2-2","mc8-1-1"],
 "2026-10":["mc8-1-1","mc8-1-2","mc8-1-3","mc8-2-1","mc8-2-2"],
 "2026-11":["mc8-1-1","mc8-1-2","mc8-1-3","mc8-1-4","mc8-2-1","mc8-2-2"],
 "2026-12":["mc8-2-1","mc8-2-2","mc8-5-1","mc8-rs-4-2"],
 "2027-01":["mc8-5-1","mc8-rs-4-2"],
 "2027-02":["mc8-3-1","mc8-3-2","mc8-3-3"],
 "2027-07":["mc8-1-4","mc8-2-2","mc8-3-2","mc8-7-2","mc8-9-1"]
};
const scores={
 "mc8-1-1":65,"mc8-1-2":55,"mc8-1-3":40,"mc8-1-4":70,
 "mc8-2-1":55,"mc8-2-2":30,"mc8-5-1":35
};
const board={nodes:[...new Set(Object.values(skillIds).flat())].map(id=>({id,title:id,kind:"skill"})),edges:[]};
const payload={studentId,boardId,schoolYear:"2026/27",
 months:Object.entries(skillIds).map(([month,ids])=>({
 month,skillIds:ids,topics:["Individual month "+month],unmappedTopics:[],
 }))};

test("the strict YYYY-MM index keeps each month and ignores no valid date",()=>{
 const result=indexStudentMonthlyCurricula(payload,{studentId,boardId,schoolYearStart});
 assert.equal(Object.keys(result).length,7);
 assert.equal(result["2026-09"].skillIds.length,3);
 assert.equal(result["2026-10"].skillIds.length,5);
 assert.equal(result["2026-11"].skillIds.length,6);
 assert.equal(result["2027-01"].skillIds.length,2);
 assert.deepEqual(result["2026-10"].skillIds,skillIds["2026-10"]);
});
test("scores for each month use only its own existing assessed map values",()=>{
 const result=indexStudentMonthlyCurricula(payload,{studentId,boardId,schoolYearStart});
 function readiness(month){return calculateIndividualMonthReadiness(board,result[schoolYearMonthKey(2026,month)],scores,"REALSCHULE");}
 assert.deepEqual([9,10,11,12,1,2,7].map(m=>readiness(m).percent),[50,49,53,40,35,null,50]);
 assert.equal(readiness(12).assessedCount,3);
 assert.equal(readiness(12).totalCount,4);
 assert.equal(readiness(1).coveragePercent,50);
 assert.equal(readiness(2).status,"NO_DATA");
 assert.equal(readiness(7).assessedCount,2);
});
test("month key and school year boundaries are exact",()=>{
 assert.equal(schoolYearMonthKey(2026,9),"2026-09");
 assert.equal(schoolYearMonthKey(2026,1),"2027-01");
 assert.equal(schoolYearMonthKey(2026,7),"2027-07");
 assert.equal(schoolYearStartForDate(new Date(2026,10,22)),2026);
 assert.equal(schoolYearStartForDate(new Date(2027,2,3)),2026);
});
test("never mix one pupil, board or academic year with another",()=>{
 assert.deepEqual(indexStudentMonthlyCurricula(payload,{studentId:"other",boardId,schoolYearStart}),{});
 assert.deepEqual(indexStudentMonthlyCurricula(payload,{studentId,boardId:"grade-9",schoolYearStart}),{});
 assert.deepEqual(indexStudentMonthlyCurricula(payload,{studentId,boardId,schoolYearStart:2027}),{});
 const polluted={...payload,months:[...payload.months,{month:"2026-01",skillIds:["mc8-1-1"]},{month:"bad",skillIds:["mc8-2-1"]}]};
 const map=indexStudentMonthlyCurricula(polluted,{studentId,boardId,schoolYearStart});
 assert.equal(map["2026-01"],undefined);
 assert.equal(map.bad,undefined);
});
