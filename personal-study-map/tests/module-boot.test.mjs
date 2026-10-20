import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Fast no-network startup regression included in the production Docker build.
// Browser behavior is separately tested in Chromium and WebKit by CI.
class Classes {
  constructor(...names){this.values=new Set(names);}
  add(...names){names.forEach(x=>this.values.add(x));}
  remove(...names){names.forEach(x=>this.values.delete(x));}
  contains(name){return this.values.has(name);}
  toggle(name,value){const enabled=value===undefined?!this.contains(name):value; enabled?this.add(name):this.remove(name);return enabled;}
}
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{id,innerHTML:'',textContent:'',classList:new Classes(),
    addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},
    click(){this.onclick?.({target:this});}});
  return elements.get(id);
}
element('flashcard-panel').classList.add('closed');
const storage=new Map();
const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
const requests=[];
const exam={id:'boot-exam',title:'Boot check',skills:[{id:'boot-skill',title:'Skill',topicId:'all',flashcards:[{id:'boot-card',question:'Two plus two?',answer:'4'}]}]};
const window={location:{hash:''},addEventListener(){},dispatchEvent(){},
  studyBoardCards:{context:()=>({exam,semesterId:'boot',topicId:'all'}),allExams:()=>[exam],learningSessions:()=>[]}};
const context={window,document:{getElementById:element,hidden:false,body:element('body'),addEventListener(){}},localStorage,
  navigator:{onLine:true},crypto:webcrypto,Date,Intl,Event,AbortController,console,
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
  fetch:async(url,options)=>{requests.push(options.method);return {ok:true,json:async()=>({snapshot:{progress:{},invalid:{},deleted:{},overrides:{},custom:[]},sessions:[]})};}};
vm.createContext(context);
for(const name of ['flashcard-engine.js','flashcards.js']){
  new vm.Script(readFileSync('personal-study-map/'+name,'utf8'),{filename:name}).runInContext(context);
}
await new Promise(resolve=>setImmediate(resolve));
assert.equal(typeof element('flashcard-toggle').onclick,'function','Card button must be bound at startup');
element('flashcard-toggle').click();
assert.equal(element('flashcard-panel').classList.contains('closed'),false);
assert.match(element('flashcard-app').innerHTML,/data-action="new-cards"/);
assert.match(element('flashcard-app').innerHTML,/data-action="sync-now"/);
assert.equal(element('flashcard-count').textContent,'0','New cards are not falsely classified as due');
assert.deepEqual(requests,['GET'],'Read-only startup must not trigger upload feedback loops');
element('close-flashcards').click();
assert.equal(element('flashcard-panel').classList.contains('closed'),true);
console.log('PASS full module startup, actual open/close handlers, zero-due panel, read-only sync');
