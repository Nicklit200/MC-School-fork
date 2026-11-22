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
test("unassessed skills lower readiness but retain unknown mastery, explicitly assessed zero remains 0",()=>{
 const res=calculateMonthReadiness(board,month,{a:0},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"ESTIMATED");assert.equal(res.percent,0);
 assert.equal(res.assessedCount,1);assert.equal(res.observedPercent,0);
 assert.equal(res.coveragePercent,50);assert.equal(res.unassessedSkills.length,1);
 assert.equal(res.weakSkills[0].value,0);
});
test("no mastery produces zero readiness while all skills remain unassessed",()=>{
 const res=calculateMonthReadiness(board,month,{},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"ESTIMATED");assert.equal(res.percent,0);
 assert.equal(res.observedPercent,null);assert.equal(res.unassessedSkills.length,2);
 assert.equal(res.coveragePercent,0);
});
test("unlinked calendar topics suppress apparent readiness, even if some topics assessed",()=>{
 const mixed={topics:[...month.topics,{name:"Unlinked",boardTopicId:null}]};
 const res=calculateMonthReadiness(board,mixed,{a:90,b:90},"WIRTSCHAFTSSCHULE");
 assert.equal(res.status,"ESTIMATED");assert.equal(res.percent,90);
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
 assert.equal(res.status,"ESTIMATED");assert.equal(res.percent,0);assert.equal(res.assessedCount,0);
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
test("individual plan retains unassessed mastery as unknown, counting 0 in readiness, and updates dynamically",()=>{
 const board={nodes:[{id:"a",kind:"skill",title:"a"},{id:"b",kind:"skill",title:"b"}],edges:[]};
 const plan={skillIds:["a","b"],topics:["Algebra"],unmappedTopics:[]};
 const before=calculateIndividualMonthReadiness(board,plan,{a:0},"REALSCHULE");
 assert.equal(before.percent,0);
 assert.equal(before.observedPercent,0);
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
 assert.equal(result.status,"UNMAPPED");
 assert.equal(calculateIndividualMonthReadiness(board,{skillIds:[]},{a:90}),null);
});

test("calendar uses exact monthly skill IDs from its persisted note, not entire topic subtrees",()=>{
 const board={nodes:[
  {id:"t",kind:"topic",title:"Terme"},
  ...["a","b","c","future"].map(id=>({id,kind:"skill",title:id}))
 ],edges:["a","b","c","future"].map(id=>({source:"t",target:id,kind:"contains"}))};
 const first={month:10,topics:[{name:"Terme",boardTopicId:"t"}],skillIds:["a","b"]};
 const second={month:11,topics:[{name:"Terme",boardTopicId:"t"}],skillIds:["a","b","c"]};
 const mastery={a:30,b:70,c:100,future:0};
 const october=calculateMonthReadiness(board,first,mastery,"REALSCHULE");
 const november=calculateMonthReadiness(board,second,mastery,"REALSCHULE");
 assert.equal(october.percent,50);
 assert.equal(october.totalCount,2);
 assert.equal(october.source,"CALENDAR_SKILL_MAP");
 assert.equal(november.percent,67);
 assert.equal(november.totalCount,3);
 assert.equal(november.source,"CALENDAR_SKILL_MAP");
});
test("Vitalina calendar month note uses the exact assessed skills, not unrelated topic descendants",()=>{
 const board={nodes:[
  {id:"mc8-t1",kind:"topic"},
  {id:"mc8-t2",kind:"topic"},
  ...["mc8-1-1","mc8-1-2","mc8-1-3","mc8-1-4","mc8-2-1","mc8-2-2","mc8-1-5","mc8-2-5"]
    .map(id=>({id,kind:"skill",title:id,schoolTypes:["REALSCHULE"]}))
 ],edges:[
  ...["mc8-1-1","mc8-1-2","mc8-1-3","mc8-1-4","mc8-1-5"].map(id=>({source:"mc8-t1",target:id,kind:"contains"})),
  ...["mc8-2-1","mc8-2-2","mc8-2-5"].map(id=>({source:"mc8-t2",target:id,kind:"contains"}))
 ]};
 const month={month:11,skillIds:["mc8-1-1","mc8-1-2","mc8-1-3","mc8-1-4","mc8-2-1","mc8-2-2"],
 topics:[{name:"Terme",boardTopicId:"mc8-t1"},{name:"Gleichungen",boardTopicId:"mc8-t2"},{name:"Brüche",boardTopicId:null}]};
 const scores={"mc8-1-1":65,"mc8-1-2":55,"mc8-1-3":40,"mc8-1-4":70,"mc8-2-1":55,"mc8-2-2":30,"mc8-1-5":20,"mc8-2-5":90};
 const res=calculateMonthReadiness(board,month,scores,"REALSCHULE");
 assert.equal(res.percent,53);
 assert.equal(res.assessedCount,6);
 assert.equal(res.totalCount,6);
 assert.equal(res.unmappedTopics.length,1);
});

test("Sofia November counts the two unassessed skills as zero without changing mastery",()=>{
 const board={nodes:[
   {id:"negative",kind:"skill",title:"Отрицательные числа"},
   {id:"absolute",kind:"skill",title:"Модуль и противоположное число"},
   {id:"compare",kind:"skill",title:"Сравнение целых"},
   {id:"add",kind:"skill",title:"Сложение и вычитание целых"},
   {id:"multiply",kind:"skill",title:"Умножение и деление целых"},
   {id:"signs",kind:"skill",title:"Выражения со знаками"}
 ],edges:[]};
 const plan={skillIds:["negative","absolute","compare","add","multiply","signs"],topics:["Ganze Zahlen"]};
 const mastery={negative:65,compare:95,add:75,signs:30};
 const result=calculateIndividualMonthReadiness(board,plan,mastery,"WIRTSCHAFTSSCHULE");
 assert.equal(result.percent,44); // (65+95+75+30+0+0) / 6
 assert.equal(result.observedPercent,66); // (65+95+75+30) / 4
 assert.equal(result.coveragePercent,67);
 assert.equal(result.assessedCount,4);
 assert.equal(result.totalCount,6);
 assert.equal(result.unassessedSkills.length,2);
 assert.equal(result.unassessedSkills[0].value,null);
 assert.deepEqual(mastery,{negative:65,compare:95,add:75,signs:30});
});
test("an unseen skill depresses individual readiness even if all observed skills are strong",()=>{
 const b={nodes:[{id:"a",kind:"skill"},{id:"b",kind:"skill"},{id:"c",kind:"skill"}],edges:[]};
 const r=calculateIndividualMonthReadiness(b,{skillIds:["a","b","c"]},{a:90,b:90},"WIRTSCHAFTSSCHULE");
 assert.equal(r.percent,60);
 assert.equal(r.observedPercent,90);
 assert.equal(r.unassessedSkills.length,1);
});
