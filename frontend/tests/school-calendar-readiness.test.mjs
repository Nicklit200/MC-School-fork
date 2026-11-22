import test from "node:test";
import assert from "node:assert/strict";
import {calculateMonthReadiness} from "../public/skills-board/school-calendar-readiness.js";

const board={nodes:[
{id:"t",kind:"topic",title:"Ganze Zahlen"},
{id:"a",kind:"skill",title:"A"},
{id:"b",kind:"skill",title:"B"},
{id:"c",kind:"skill",title:"Gym only",schoolTypes:["GYMNASIUM"]},
{id:"d",kind:"skill",title:"Archived",archived:true},
{id:"second",kind:"topic",title:"Other"}
],edges:[
{kind:"contains",source:"t",target:"a"},
{kind:"contains",source:"t",target:"b"},
{kind:"contains",source:"t",target:"c"},
{kind:"contains",source:"t",target:"d"}
]};
const month={month:11,topics:[{name:"Integers",boardTopicId:"t"},{name:"Practice",boardTopicId:"t"}]};

test("counts distinct relevant skills, not repeated topics or archived/other-school skills",()=>{
 const res=calculateMonthReadiness(board,month,{a:70,b:100,c:0},"WIRTSCHAFTSSCHULE");
 assert.equal(res.percent,85);assert.equal(res.totalCount,2);assert.equal(res.assessedCount,2);
 assert.equal(res.status,"ESTIMATED");assert.equal(res.mappedTopicCount,2);
});
test("unassessed skills are unknown, explicitly assessed zero remains 0",()=>{
 const res=calculateMonthReadiness(board,month,{a:0},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"INSUFFICIENT_DATA");assert.equal(res.percent,null);
 assert.equal(res.assessedCount,1);assert.equal(res.observedPercent,0);
 assert.equal(res.coveragePercent,50);assert.equal(res.unassessedSkills.length,1);
 assert.equal(res.weakSkills[0].value,0);
});
test("no mastery does not produce 0% readiness",()=>{
 const res=calculateMonthReadiness(board,month,{},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"NO_DATA");assert.equal(res.percent,null);
 assert.equal(res.coveragePercent,0);
});
test("unlinked calendar topics suppress apparent readiness, even if some topics assessed",()=>{
 const mixed={topics:[...month.topics,{name:"Unlinked",boardTopicId:null}]};
 const res=calculateMonthReadiness(board,mixed,{a:90,b:90},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"INSUFFICIENT_DATA");assert.equal(res.percent,null);
 assert.deepEqual(res.unmappedTopics,["Unlinked"]);
});
test("updates reflect fresh mastery, without persisting duplicate monthly percentages",()=>{
 const previous=calculateMonthReadiness(board,month,{a:30,b:50},"WIRTSCHAFTSSCHULE");
 const updated=calculateMonthReadiness(board,month,{a:90,b:90},"WIRTSCHAFTSSCHULE");
 assert.equal(previous.percent,40);assert.equal(updated.percent,90);
});
test("no plan and invalid topic references are not invented",()=>{
 assert.equal(calculateMonthReadiness(board,null,{a:90},"WIRTSCHAFTSSCHULE").status,"NO_PLAN");
 assert.equal(calculateMonthReadiness(board,{topics:[{name:"Missing",boardTopicId:"bad"}]},{a:90},"WIRTSCHAFTSSCHULE").status,"UNMAPPED");
});
test("non-finite and invalid mastery values are not assessed",()=>{
 const res=calculateMonthReadiness(board,month,{a:"error",b:150},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"NO_DATA");assert.equal(res.assessedCount,0);
});
