import test from "node:test";
import assert from "node:assert/strict";
import {calculateMonthReadiness,calculateIndividualMonthReadiness} from "../public/skills-board/school-calendar-readiness.js";

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

test("Vitalina November individual monthly plan agrees with her existing 53% MCH3 score",()=>{
 const board={nodes:[
  {id:"mc8-1-1",kind:"skill",title:"Terme"},
  {id:"mc8-1-2",kind:"skill",title:"Klammern"},
  {id:"mc8-1-3",kind:"skill",title:"Faktorisieren"},
  {id:"mc8-1-4",kind:"skill",title:"Binomische Formeln"},
  {id:"mc8-2-1",kind:"skill",title:"Gleichungen"},
  {id:"mc8-2-2",kind:"skill",title:"Gleichungen mit Klammern"},
  {id:"extra",kind:"skill",title:"Future content"}
 ],edges:[]};
 const plan={month:"2026-11",skillIds:["mc8-1-1","mc8-1-2","mc8-1-3","mc8-1-4","mc8-2-1","mc8-2-2"],
  topics:["Brüche","Terme","Binomische Formeln"],
  unmappedTopics:["Bruchrechnung needs separate assessment"]};
 const scores={"mc8-1-1":65,"mc8-1-2":55,"mc8-1-3":40,"mc8-1-4":70,"mc8-2-1":55,"mc8-2-2":30,extra:0};
 const result=calculateIndividualMonthReadiness(board,plan,scores,"REALSCHULE");
 assert.equal(result.source,"INDIVIDUAL_PLAN");
 assert.equal(result.status,"ESTIMATED");
 assert.equal(result.percent,53);
 assert.equal(result.assessedCount,6);
 assert.equal(result.totalCount,6);
 assert.equal(result.coveragePercent,100);
 assert.equal(result.unmappedTopics.length,1);
 assert.equal(result.topics[0].skills.length,6);
});
test("individual plan retains unassessed skills as unknown and updates dynamically",()=>{
 const board={nodes:[{id:"a",kind:"skill",title:"a"},{id:"b",kind:"skill",title:"b"}],edges:[]};
 const plan={skillIds:["a","b"],topics:["Algebra"],unmappedTopics:[]};
 const before=calculateIndividualMonthReadiness(board,plan,{a:0},"REALSCHULE");
 assert.equal(before.percent,0);
 assert.equal(before.assessedCount,1);
 assert.equal(before.unassessedSkills.length,1);
 const after=calculateIndividualMonthReadiness(board,plan,{a:90,b:80},"REALSCHULE");
 assert.equal(after.percent,85);
 assert.equal(after.coveragePercent,100);
});
test("individual plan refuses archived or other-school skills, without fabricating readiness",()=>{
 const board={nodes:[
  {id:"a",kind:"skill",title:"a",archived:true},
  {id:"b",kind:"skill",title:"b",schoolTypes:["GYMNASIUM"]}
 ],edges:[]};
 const result=calculateIndividualMonthReadiness(board,{skillIds:["a","b"],topics:[]},{a:95,b:95},"REALSCHULE");
 assert.equal(result.percent,null);
 assert.equal(result.totalCount,0);
 assert.equal(result.unmappedTopics.length,2);
 assert.equal(calculateIndividualMonthReadiness(board,{skillIds:[]},{a:90}),null);
});
