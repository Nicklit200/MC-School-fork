import test from "node:test";
import assert from "node:assert/strict";
import {
  schoolCalendarNodeId, defaultSchoolProfile, savedSchoolCalendar,
  emptySchoolCalendar, validateSchoolCalendar
} from "../public/skills-board/school-calendar.js";

const board = {
  grade:6, nodes:[
    {id:"topic-4",kind:"topic",title:"Ganze Zahlen"},
    {id:"skill-4-1",kind:"skill",title:"Negative Zahlen"}
  ]
};
function sample() {
  const plan = emptySchoolCalendar("WIRTSCHAFTSSCHULE",6,"vierstufig");
  plan.status="EXAMPLE_NOT_SCHOOL_CONFIRMED";
  plan.sourceLabel="Example 2019/20";
  plan.months=[{month:11,weeks:"KW 45–48",note:"Illustrative",
    topics:[{name:"Ganze Zahlen",boardTopicId:"topic-4"}]}];
  return plan;
}
test("calendar IDs are stable and school-profile specific",()=>{
  assert.equal(defaultSchoolProfile("WIRTSCHAFTSSCHULE"),"vierstufig");
  assert.equal(schoolCalendarNodeId("WIRTSCHAFTSSCHULE",6,"vierstufig"),
    "school_calendar_wirtschaftsschule_6_vierstufig");
  assert.notEqual(schoolCalendarNodeId("WIRTSCHAFTSSCHULE",6,"zweistufig"),
    schoolCalendarNodeId("WIRTSCHAFTSSCHULE",6,"vierstufig"));
});
test("valid example references existing skill topics, not mastery",()=>{
  assert.equal(validateSchoolCalendar(sample(),board),true);
  const plan=sample();
  const withNote={...board,nodes:[
    ...board.nodes,{id:schoolCalendarNodeId(plan.schoolType,plan.grade,plan.profile),
      kind:"note",description:JSON.stringify(plan)}]};
  assert.deepEqual(savedSchoolCalendar(withNote,"WIRTSCHAFTSSCHULE","vierstufig"),plan);
  assert.equal(savedSchoolCalendar(withNote,"REALSCHULE","allgemein"),null);
  assert.equal(withNote.nodes[0].id,"topic-4");
});
test("reject invalid month, unknown skill and missing school confirmation",()=>{
  const duplicate=sample();duplicate.months.push({...duplicate.months[0]});
  assert.throws(()=>validateSchoolCalendar(duplicate,board),/месяц/i);
  const unknown=sample();unknown.months[0].topics[0].boardTopicId="not-real";
  assert.throws(()=>validateSchoolCalendar(unknown,board),/раздел/i);
  const fake=sample();fake.status="SCHOOL_CONFIRMED";fake.sourceLabel="";
  assert.throws(()=>validateSchoolCalendar(fake,board),/подтверждённого/i);
});
test("corrupt notes never break skills map",()=>{
  const corrupt={...board,nodes:[...board.nodes,
    {id:"school_calendar_wirtschaftsschule_6_vierstufig",
      kind:"note",description:"{broken"}]};
  assert.equal(savedSchoolCalendar(corrupt,"WIRTSCHAFTSSCHULE","vierstufig"),null);
});
