import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

// Exercise the actual history loader/render functions with an isolated API and DOM.
class Element {
  constructor(tag = "div") {
    this.tagName = tag; this.children = []; this.dataset = {}; this.className = "";
    this.classList = {add:name => {this.className += " " + name;}};
  }
  set innerHTML(value) {
    this.html = value; this.children = []; this.selectors = {};
    for (const name of ["session-top", "session-summary", "session-changes"])
      if (value.includes('class="' + name + '"')) {
        const child = new Element(); child.className = name;
        this.selectors["." + name] = child; this.append(child);
      }
  }
  get innerHTML() {return this.html || "";}
  set textContent(value) {this.text = String(value);}
  get textContent() {return (this.text || "") + (this.html || "") + this.children.map(c => c.textContent).join("\n");}
  get childNodes() {return this.children;}
  append(...items) {for (const child of items) {child.parent = this; this.children.push(child);}}
  prepend(child) {child.parent = this; this.children.unshift(child);}
  after(child) {child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child);}
  before(child) {child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, child);}
  replaceChildren() {this.children = []; this.html = ""; this.text = "";}
  querySelector(selector) {return this.selectors?.[selector] || null;}
  setAttribute(name, value) {this[name] = value;}
}
const elements = new Map();
const element = id => {if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id);};
const storage = new Map(), requests = [], responses = [];
const context = {
  window:{matchMedia:()=>({matches:false})},
  document:{getElementById:element, createElement:tag=>new Element(tag)},
  localStorage:{getItem:key=>storage.get(key) || null},
  Date, Intl, URLSearchParams, AbortController, console, setTimeout, clearTimeout,
  quizHistoryForMap:()=>[], renderCalendar(){},
  fetch:async(url, options)=>{requests.push({url, options}); return responses.shift()();}
};
vm.createContext(context);
const source = readFileSync("personal-study-map/app.js", "utf8");
vm.runInContext(source.slice(0, source.indexOf("async function loadLectureTasks()")) +
  source.slice(source.indexOf("function studySessionPosition("), source.indexOf("function applyTransform()")) +
  ";globalThis.historyTest={state,loadStudySessions,learningSessionsForMap,studySessionPosition,renderHistory,syncStudySessionAccount,compareLearningSessions};", context);
const ui = context.historyTest, host = element("session-history");
ui.state.semesterId = "semester"; ui.state.examId = "exam";
ui.state.data = {sessions:[{id:"legacy",semesterId:"semester",examId:"exam",date:"2026-10-25",title:"Legacy",checkpoint:{document:"1Pipeline.pdf",lastExplainedPage:79,nextPage:80}}]};
ui.renderHistory();
assert.equal(requests.length, 0, "Anonymous history must never send an account request");
assert.match(host.textContent, /Последний подробно разобранный слайд: 79/);
assert.match(host.textContent, /Продолжить со слайда: 80/);
assert.doesNotMatch(host.textContent, /Последний завершённый слайд: 79/);

const accountKey = "personal-study-map:account-session:v2";
storage.set(accountKey, "a".repeat(64));
const response = payload => async()=>({ok:true,json:async()=>payload});
responses.push(response({sessions:[{id:"legacy",semesterId:"semester",examId:"exam",date:"2026-11-01",title:"Imported"},
  {id:"new",semesterId:"semester",examId:"exam",type:"study_session",date:"2026-11-06",occurredAt:"2026-11-06T12:00:00Z",title:"Session",topics:["<script>topic</script>"],materialTitle:"Pipeline",lastCompletedSlide:61,nextSlide:62,totalSlides:107}],nextCursor:"cursor + /"}));
await ui.loadStudySessions();
assert.equal(requests[0].options.headers.Authorization, "Bearer " + "a".repeat(64));
assert.equal(ui.learningSessionsForMap().length, 2, "Server-imported legacy IDs must be deduplicated");
assert.equal(ui.learningSessionsForMap().find(x=>x.id==="legacy").title, "Imported");
assert.deepEqual(host.children.filter(x=>x.tagName==="article").map(x=>x.dataset.sessionId), ["new","legacy"]);
assert.match(host.textContent, /Последний завершённый слайд: 61 из 107/);
assert.match(host.textContent, /Продолжить со слайда: 62/);
assert.match(host.textContent, /Материал: Pipeline/);
const topicRow = host.children.find(x=>x.dataset.sessionId==="new").children
  .find(x=>x.className==="session-topics").children[1].children[0];
assert.equal(topicRow.textContent,"<script>topic</script>");
assert.equal(topicRow.innerHTML,"", "Topic text must never become executable HTML");

responses.push(response({sessions:[{id:"older",semesterId:"semester",examId:"exam",date:"2026-10-01",title:"Older"}],nextCursor:null}));
await ui.loadStudySessions({more:true});
assert.equal(new URL(requests[1].url).searchParams.get("cursor"), "cursor + /");
assert.equal(ui.learningSessionsForMap().length, 3, "Pagination keeps previously loaded rows");
assert.ok(!host.children.some(x=>x.className==="study-history-more"));

responses.push(async()=>({ok:false,status:503}));
await ui.loadStudySessions();
assert.match(host.textContent,/Не удалось обновить историю занятий/);
assert.equal(ui.learningSessionsForMap().length, 3, "A temporary error preserves confirmed rows");
assert.ok(host.children[0].children.some(x=>x.tagName==="button" && x.textContent==="Повторить загрузку"));

let release;
responses.push(()=>new Promise(resolve=>{release=resolve;}));
const pending = ui.loadStudySessions();
storage.set(accountKey,"b".repeat(64));
ui.syncStudySessionAccount();
assert.equal(ui.learningSessionsForMap().length, 1, "Account switch clears protected rows immediately");
release({ok:true,json:async()=>({sessions:[{id:"secret",date:"2026-11-06",title:"Old account"}],nextCursor:null})});
await pending;
assert.equal(ui.learningSessionsForMap().length,1,"A late response from the previous account must be discarded");
storage.delete(accountKey);
ui.renderHistory();
assert.doesNotMatch(host.textContent,/Imported|Session|Old account/);
assert.match(host.textContent,/Legacy/);
assert.deepEqual(Array.from(ui.studySessionPosition({checkpoint:{document:"Old",page:85,lastExplainedPage:79,nextPage:80}})),
  ["Материал: Old","Где остановились: стр. 85","Последний подробно разобранный слайд: 79","Продолжить со слайда: 80"]);
const tied = {occurredAt:"2026-11-06T17:00:00.000Z",createdAt:"2026-11-06T17:00:00.001Z"};
const sequential = [{...tied,id:"z",recordedOrder:"9"},{...tied,id:"a",recordedOrder:"10"}];
assert.equal(sequential.sort(ui.compareLearningSessions)[0].recordedOrder,"10",
  "The latest recorded event wins even when both timestamps are identical");
const large = [{...tied,id:"z",recordedOrder:"9007199254740992"},
  {...tied,id:"a",recordedOrder:"9007199254740993"}];
assert.equal(large.sort(ui.compareLearningSessions)[0].recordedOrder,"9007199254740993",
  "Database BIGSERIAL ordering must not lose precision through Number coercion");
console.log("PASS history auth, pagination, server deduplication, ordering, retry, account isolation and legacy checkpoints");
