import {colors,kindLabels,clone,descendants,validateBoard} from "./model.js";
const $=id=>document.getElementById(id);
const svgNS="http://www.w3.org/2000/svg";
let config=null,snapshot=null,data=null,history=[],dirty=false,saving=false,scope="overview",selection=null,connectMode=false,linkSource=null,op=null,space=false,students=[],groups=[],selectedStudentId="",selectedGroupId="",masteryByStudent={},masteryLoading=false,trackFilterState=null;
const boardIdByGrade=new Map([[6,"grade-6"],[8,"grade-8-m8"]]);let boardId="";
const boardIdForStudent=student=>boardIdByGrade.get(Number(student?.grade))||"";
let view={x:40,y:40,z:1},lastPoint={x:0,y:0},showArchived=false,viewMode="free",hierarchyPositions=new Map(),catalogCollapsed=false;
try{
  if(localStorage.getItem("mindcrafti.skills.viewMode")==="hierarchy")viewMode="hierarchy";
  catalogCollapsed=localStorage.getItem("mindcrafti.skills.catalogCollapsed")==="true";
}catch{/* View preferences are optional. */}
const canvas=$("canvas"),world=$("world"),layer=$("node-layer"),edgeLayer=$("edge-layer");
const canEdit=()=>Boolean(config?.canEdit)&&!saving;
const node=id=>data?.nodes.find(n=>n.id===id);
const uid=prefix=>prefix+"_"+crypto.randomUUID();
const draftKey=()=>`mindcrafti.skills.draft.${config.userId}.${boardId}`;
const boardTitle=()=>snapshot?.data?.grade?`${snapshot.data.grade} класс`:"класс не указан";
const boardPath=()=>`/skill-boards/${boardId}`;
const element=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!=null)e.textContent=text;return e;};
function button(text,fn,className=""){const e=element("button",className,text);e.type="button";e.addEventListener("click",fn);return e;}
function notice(text,error=false){$("notice").textContent=text;$("notice").className=error?"error":"";$("notice").hidden=!text;}
function pendingForm(){
  const form=$("node-form");
  return form?.dataset.changed==="true"?{id:form.dataset.id,values:Object.fromEntries(new FormData(form))}:null;
}
function stash(){
  if(!data||!config?.canEdit)return;
  try{const pending=pendingForm();if(dirty||pending)localStorage.setItem(draftKey(),JSON.stringify({revision:snapshot.revision,data,pending}));else localStorage.removeItem(draftKey());}
  catch{/* Server save remains available even if browser storage is full. */}
}
function flushForm(){
  const form=$("node-form");
  return !form||form.dataset.changed!=="true"||applyForm(form);
}
function status(){
  $("save-state").textContent=saving?"Сохраняем…":dirty?"Есть изменения":snapshot?`Сохранено · версия ${snapshot.revision}`:"Подключение…";
  $("save").disabled=!canEdit()||(!dirty&&!pendingForm());
  $("inspector-body").inert=saving;
  for(const id of ["add","add-topic","connect"])$(id).disabled=!data||!canEdit();
  $("undo").disabled=!canEdit()||history.length===0;
  $("export").disabled=!data;$("connect").classList.toggle("active",connectMode);
  canvas.classList.toggle("connecting",connectMode);
}
async function request(method,path,body){
  const response=await fetch(config.apiBase.replace(/\/$/,"")+path,{method,headers:{Authorization:`Bearer ${config.token}`,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  const text=await response.text();let result;
  try{result=text?JSON.parse(text):null;}catch{throw Error("Сервер вернул неожиданный ответ. Попробуйте позже");}
  if(!response.ok){const error=Error(response.status===401?"Вход истёк. Вернитесь в Mindcrafti и войдите заново.":result?.message||`Ошибка сервера ${response.status}`);error.status=response.status;throw error;}
  return result;
}
const schoolLabels={
  GYMNASIUM:"Gymnasium",REALSCHULE:"Realschule",MITTELSCHULE:"Mittelschule",
  WIRTSCHAFTSSCHULE:"Wirtschaftsschule",GESAMTSCHULE:"Gesamtschule",
  WERKREALSCHULE:"Werkrealschule",OTHER:"Andere"
};
const schoolShort={
  GYMNASIUM:"GYM",REALSCHULE:"RS",MITTELSCHULE:"MS",WIRTSCHAFTSSCHULE:"WS",
  GESAMTSCHULE:"GS",WERKREALSCHULE:"WRS",OTHER:"OTHER"
};
const allSchoolTypes=Object.keys(schoolLabels);
const selectedStudent=()=>students.find(student=>student.id===selectedStudentId)||null;
const selectedGroup=()=>groups.find(group=>group.id===selectedGroupId)||null;
const selectedStudents=()=>{
  if(selectedGroupId)return selectedGroup()?.students||[];
  const student=selectedStudent();return student?[student]:[];
};
const selectedTargetLabel=()=>selectedGroupId?(selectedGroup()?.name||"Группа"):(selectedStudent()?.fullName||"Ученик");
const selectedGrades=()=>[...new Set(selectedStudents().map(student=>Number(student.grade)).filter(Number.isInteger))];
const defaultTrackFilterState=()=>({core:true,schools:new Set(selectedStudents().map(student=>student.schoolType).filter(Boolean))});
const trackFilterKey=()=>`mindcrafti.skills.trackFilters.${selectedGroupId?"g:"+selectedGroupId:selectedStudentId?"s:"+selectedStudentId:"none"}`;
function loadTrackFilterState(){
  const fallback=defaultTrackFilterState();
  try{
    const raw=JSON.parse(localStorage.getItem(trackFilterKey())||"null");
    if(raw&&typeof raw==="object"&&typeof raw.core==="boolean"&&Array.isArray(raw.schools)){
      return{core:raw.core,schools:new Set(raw.schools.filter(type=>allSchoolTypes.includes(type)))};
    }
  }catch{/* Optional display preference. */}
  return fallback;
}
function currentTrackFilters(){
  if(!trackFilterState)trackFilterState=loadTrackFilterState();
  return trackFilterState;
}
function saveTrackFilterState(){
  if(!trackFilterState)return;
  try{localStorage.setItem(trackFilterKey(),JSON.stringify({core:trackFilterState.core,schools:[...trackFilterState.schools]}));}catch{/* Optional display preference. */}
}
const activeSchoolTypes=()=>currentTrackFilters().schools;
const boardIdForSelection=()=>{
  const chosen=selectedStudents(),grades=selectedGrades();
  if(!chosen.length||grades.length!==1)return "";
  if(!selectedGroupId&&chosen[0]?.grade==null)return "";
  return boardIdByGrade.get(grades[0])||"";
};
const directTrackDefaults={
  "mc8-1-1":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-1-2":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-1-3":{schools:["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-1-4":{schools:["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-1-5":{schools:["GYMNASIUM","WIRTSCHAFTSSCHULE"]},
  "mc8-1-6":{schools:["GYMNASIUM","WIRTSCHAFTSSCHULE"]},
  "mc8-1-7":{schools:["MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-1-8":{schools:["WIRTSCHAFTSSCHULE"]},
  "mc8-2-1":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-2-2":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-2-3":{schools:["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-2-4":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-2-5":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-1":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-2":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-3":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-4":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-5":{schools:["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-6":{schools:["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-7":{schools:["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-8":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-3-9":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-3-10":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-4-1":{schools:["GYMNASIUM","WIRTSCHAFTSSCHULE"]},
  "mc8-4-2":{schools:["GYMNASIUM","WIRTSCHAFTSSCHULE"]},
  "mc8-4-3":{schools:["GYMNASIUM","WIRTSCHAFTSSCHULE"]},
  "mc8-4-4":{schools:["GYMNASIUM","WIRTSCHAFTSSCHULE"]},
  "mc8-5-1":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-5-2":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-5-3":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-5-4":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-5-5":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-5-6":{schools:["GYMNASIUM"]},
  "mc8-6-1":{schools:["MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-6-2":{schools:["MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-6-3":{schools:["MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-6-4":{schools:["WIRTSCHAFTSSCHULE"]},
  "mc8-6-5":{schools:["WIRTSCHAFTSSCHULE"]},
  "mc8-7-1":{schools:["REALSCHULE"]},
  "mc8-7-2":{schools:["REALSCHULE"]},
  "mc8-7-3":{schools:["REALSCHULE"]},
  "mc8-7-4":{schools:["REALSCHULE"]},
  "mc8-7-5":{schools:["MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-7-6":{schools:["GYMNASIUM","MITTELSCHULE"]},
  "mc8-7-7":{schools:["GYMNASIUM"]},
  "mc8-8-1":{schools:["GYMNASIUM","REALSCHULE"]},
  "mc8-8-2":{schools:["REALSCHULE"]},
  "mc8-8-3":{schools:["GYMNASIUM","MITTELSCHULE"]},
  "mc8-8-4":{schools:["GYMNASIUM","MITTELSCHULE"]},
  "mc8-8-5":{schools:["REALSCHULE"]},
  "mc8-8-6":{schools:["REALSCHULE"]},
  "mc8-8-7":{schools:["REALSCHULE"]},
  "mc8-9-1":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-9-2":{schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE"]},
  "mc8-9-3":{schools:["GYMNASIUM"]},
  "mc8-9-4":{core:true,schools:["GYMNASIUM","REALSCHULE","MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-9-5":{schools:["MITTELSCHULE","WIRTSCHAFTSSCHULE"]},
  "mc8-9-6":{schools:["WIRTSCHAFTSSCHULE"]}
};
function skillTrack(skill){
  const fallback=directTrackDefaults[skill.id]||{},persisted=Array.isArray(skill.schoolTypes);
  return{
    core:persisted?Boolean(skill.core):Boolean(fallback.core),
    schools:persisted?skill.schoolTypes:(fallback.schools||[])
  };
}
function nodeTrackInfo(n){
  if(!n)return{core:false,schools:[],configured:false};
  const skills=n.kind==="skill"?[n]:data.nodes.filter(skill=>skill.kind==="skill"&&!skill.archived&&descendants(data,n.id).has(skill.id));
  const schools=new Set();let core=false,configured=false;
  for(const skill of skills){
    if(Array.isArray(skill.schoolTypes)||directTrackDefaults[skill.id])configured=true;
    const info=skillTrack(skill);if(info.core)core=true;for(const type of info.schools)schools.add(type);
  }
  return{core,schools:[...schools],configured};
}
function renderSchoolFilters(){
  const host=$("school-filters");if(!host)return;host.replaceChildren();
  if(!selectedStudents().length){host.hidden=true;return;}
  host.hidden=false;
  const filters=currentTrackFilters();
  const core=element("label","track-filter core"+(filters.core?" active":""));const coreInput=element("input");
  coreInput.type="checkbox";coreInput.checked=filters.core;
  coreInput.onchange=()=>{
    filters.core=coreInput.checked;saveTrackFilterState();renderSchoolFilters();renderNodes();renderEdges();
  };
  core.append(coreInput,document.createTextNode("CORE"));core.title="Показывать ядро";host.append(core);
  for(const type of ["GYMNASIUM","REALSCHULE","WIRTSCHAFTSSCHULE","MITTELSCHULE","GESAMTSCHULE","WERKREALSCHULE"]){
    const checked=filters.schools.has(type),label=element("label","track-filter"+(checked?" active":"")),input=element("input");
    input.type="checkbox";input.checked=checked;
    input.onchange=()=>{
      if(input.checked)filters.schools.add(type);else filters.schools.delete(type);
      saveTrackFilterState();renderSchoolFilters();renderNodes();renderEdges();
    };
    label.append(input,document.createTextNode(schoolShort[type]));label.title=schoolLabels[type];host.append(label);
  }
}
function renderStudentFilter(){
  const select=$("student-filter");if(!select)return;
  select.replaceChildren();const none=element("option","","Выберите группу или ученика");none.value="";select.append(none);
  if(groups.length){
    const groupOptions=element("optgroup");groupOptions.label="Группы";
    for(const group of groups){
      const grades=[...new Set((group.students||[]).map(student=>student.grade).filter(Boolean))];
      const schools=[...new Set((group.students||[]).map(student=>schoolShort[student.schoolType]).filter(Boolean))];
      const meta=[grades.length===1?`${grades[0]} кл.`:grades.length>1?"разные классы":"класс не указан",schools.join("+")].filter(Boolean).join(" · ");
      const option=element("option","",meta?`${group.name} · ${meta}`:group.name);option.value=`g:${group.id}`;groupOptions.append(option);
    }
    select.append(groupOptions);
  }
  if(students.length){
    const studentOptions=element("optgroup");studentOptions.label="Ученики";
    for(const student of students){
      const meta=[student.grade?`${student.grade} кл.`:"класс не указан",schoolLabels[student.schoolType]||""].filter(Boolean).join(" · ");
      const option=element("option","",meta?`${student.fullName} · ${meta}`:student.fullName);option.value=`s:${student.id}`;studentOptions.append(option);
    }
    select.append(studentOptions);
  }
  select.value=selectedGroupId?`g:${selectedGroupId}`:selectedStudentId?`s:${selectedStudentId}`:"";
  select.disabled=masteryLoading||(!students.length&&!groups.length);
  renderSchoolFilters();
}
async function chooseStudent(value){
  if(!flushForm()){renderStudentFilter();return;}
  const [type,id]=String(value||"").split(":");
  const nextStudentId=type==="s"&&students.some(student=>student.id===id)?id:"";
  const nextGroupId=type==="g"&&groups.some(group=>group.id===id)?id:"";
  if(nextStudentId===selectedStudentId&&nextGroupId===selectedGroupId)return;
  if(dirty&&!confirm("Есть несохранённые изменения карты. Переключить без сохранения?")){renderStudentFilter();return;}
  selectedStudentId=nextStudentId;selectedGroupId=nextGroupId;trackFilterState=null;
  try{
    const target=selectedGroupId?`g:${selectedGroupId}`:selectedStudentId?`s:${selectedStudentId}`:"";
    if(target)localStorage.setItem("mindcrafti.skills.target",target);else localStorage.removeItem("mindcrafti.skills.target");
  }catch{/* Preference is optional. */}
  location.reload();
}
function masteryPercent(n,studentId){
  if(!studentId||!n)return 0;
  const mastery=masteryByStudent[studentId]||{};
  if(n.kind==="skill")return Math.max(0,Math.min(100,Number(mastery[n.id])||0));
  const ids=descendants(data,n.id),skills=data.nodes.filter(x=>ids.has(x.id)&&x.kind==="skill"&&!x.archived);
  if(!skills.length)return 0;
  return Math.round(skills.reduce((sum,x)=>sum+Math.max(0,Math.min(100,Number(mastery[x.id])||0)),0)/skills.length);
}
function masteryClass(value){return value>=80?"high":value>=50?"mid":value>0?"low":"";}
function dependencyHighlights(){
  const beforeEdges=new Set(),afterEdges=new Set(),beforeNodes=new Set(),afterNodes=new Set();
  if(!data||selection?.type!=="node")return{beforeEdges,afterEdges,beforeNodes,afterNodes,active:false};
  const start=selection.id,seenBefore=new Set([start]),seenAfter=new Set([start]);
  const walkBefore=id=>{
    for(const edge of data.edges.filter(e=>e.kind==="prerequisite"&&e.target===id)){
      beforeEdges.add(edge.id);beforeNodes.add(edge.source);
      if(!seenBefore.has(edge.source)){seenBefore.add(edge.source);walkBefore(edge.source);}
    }
  };
  const walkAfter=id=>{
    for(const edge of data.edges.filter(e=>e.kind==="prerequisite"&&e.source===id)){
      afterEdges.add(edge.id);afterNodes.add(edge.target);
      if(!seenAfter.has(edge.target)){seenAfter.add(edge.target);walkAfter(edge.target);}
    }
  };
  walkBefore(start);walkAfter(start);
  return{beforeEdges,afterEdges,beforeNodes,afterNodes,active:true};
}
function directDependencies(id){
  return{
    before:data.edges.filter(e=>e.kind==="prerequisite"&&e.target===id).map(e=>node(e.source)).filter(Boolean),
    after:data.edges.filter(e=>e.kind==="prerequisite"&&e.source===id).map(e=>node(e.target)).filter(Boolean)
  };
}
async function saveSkillMastery(studentId,skillId,value){
  if(!studentId||masteryLoading)return;
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<0||parsed>100){notice("Процент должен быть целым числом от 0 до 100.",true);return;}
  masteryLoading=true;renderStudentFilter();
  try{
    const result=await request("PUT",`${boardPath()}/students/${studentId}/mastery/${skillId}`,{mastery:parsed});
    masteryByStudent[studentId]=result?.mastery&&typeof result.mastery==="object"?result.mastery:{};
    const student=students.find(item=>item.id===studentId)||selectedStudents().find(item=>item.id===studentId);
    notice(`Освоение сохранено: ${student?.fullName||"ученик"} · ${parsed}%`);
  }catch(error){notice(error.message,true);}
  finally{masteryLoading=false;renderStudentFilter();render();showNode(skillId);}
}
window.addEventListener("message",async event=>{
  if(event.origin!==location.origin||event.source!==window.parent||window.parent===window||event.data?.type!=="mindcrafti-skills-config"||config)return;
  const incoming=event.data;
  if(typeof incoming.apiBase!=="string"||!incoming.token){notice("Для открытия карты нужно войти в Mindcrafti.",true);return;}
  config=incoming;
  try{
    [students,groups]=await Promise.all([
      request("GET","/skill-boards/students"),
      request("GET","/skill-boards/groups")
    ]);
    try{
      const remembered=localStorage.getItem("mindcrafti.skills.target")||"";
      if(remembered.startsWith("g:")&&groups.some(group=>group.id===remembered.slice(2)))selectedGroupId=remembered.slice(2);
      else if(remembered.startsWith("s:")&&students.some(student=>student.id===remembered.slice(2)))selectedStudentId=remembered.slice(2);
      else{
        const oldStudent=localStorage.getItem("mindcrafti.skills.student")||"";
        if(students.some(student=>student.id===oldStudent))selectedStudentId=oldStudent;
      }
    }catch{selectedStudentId="";selectedGroupId="";}
    trackFilterState=null;
    renderStudentFilter();

    const chosen=selectedStudents(),grades=selectedGrades();
    boardId=boardIdForSelection();
    if(!chosen.length){
      $("board-grade").textContent="выберите группу или ученика";
      $("source-note").replaceChildren(element("strong","","Класс выбирается автоматически"),document.createElement("br"),document.createTextNode("Выберите группу или ученика сверху."));
      $("empty").hidden=false;
      $("empty").replaceChildren(element("strong","","Выберите группу или ученика"),element("p","","Откроется карта нужного класса с процентами выбранных учеников."));
      status();return;
    }
    if(grades.length!==1){
      $("board-grade").textContent=grades.length>1?"разные классы":"класс не определён";
      $("source-note").replaceChildren(
        element("strong","",grades.length>1?"В группе разные классы":"Класс не указан"),
        document.createElement("br"),
        document.createTextNode(grades.length>1?"Для одной карты у группы должен быть один класс.":"Укажите класс хотя бы одному ученику группы.")
      );
      $("empty").hidden=false;
      $("empty").replaceChildren(
        element("strong","",grades.length>1?"Нельзя выбрать одну карту":"Карта класса не определена"),
        element("p","",grades.length>1?"Проверьте классы учеников в их учебных профилях.":"Укажите класс ученика в учебном профиле.")
      );
      status();return;
    }
    if(!boardId){
      $("board-grade").textContent=`${grades[0]} класс`;
      $("source-note").replaceChildren(element("strong","","Нет карты для выбранного класса"),document.createElement("br"),document.createTextNode("Сейчас доступны карты 6 и 8 класса."));
      $("empty").hidden=false;
      $("empty").replaceChildren(element("strong","",`Для ${grades[0]} класса карта пока не создана`));
      status();return;
    }

    snapshot=await request("GET",boardPath());
    validateBoard(snapshot.data);data=clone(snapshot.data);
    $("board-grade").textContent=boardTitle();
    const sourceNote=$("source-note"),schools=[...activeSchoolTypes()].map(type=>schoolLabels[type]||type),unknownGrade=chosen.filter(student=>student.grade==null);
    sourceNote.replaceChildren(
      element("strong","","Источник программы"),
      document.createElement("br"),
      document.createTextNode(snapshot.data.source||"Источник не указан."),
      document.createElement("br"),document.createElement("br"),
      document.createTextNode(`Выбрано: ${selectedTargetLabel()} · ${grades[0]} класс${schools.length?" · "+schools.join(" + "):""}.`),
      ...(unknownGrade.length?[document.createElement("br"),document.createTextNode(`Без указанного класса: ${unknownGrade.map(student=>student.fullName).join(", ")}. Карта взята по остальным ученикам группы.`)]:[])
    );

    masteryLoading=true;renderStudentFilter();
    try{
      const snapshots=await Promise.all(chosen.map(student=>request("GET",`${boardPath()}/students/${student.id}/mastery`)));
      masteryByStudent={};
      chosen.forEach((student,index)=>{masteryByStudent[student.id]=snapshots[index]?.mastery&&typeof snapshots[index].mastery==="object"?snapshots[index].mastery:{};});
    }finally{masteryLoading=false;renderStudentFilter();}
    let pending=null;
    try{
      const draft=JSON.parse(localStorage.getItem(draftKey())||"null");
      if(config.canEdit&&draft?.data){
        if(draft.revision===snapshot.revision&&confirm("Есть несохранённый черновик карты. Восстановить его?")){
          validateBoard(draft.data);data=draft.data;dirty=true;pending=draft.pending;
        }else if(draft.revision!==snapshot.revision){
          notice("Найдена старая локальная копия. Серверная версия новее; старый черновик не применён.");
        }
      }
    }catch{/* Invalid local drafts must never prevent reading the server. */}
    $("empty").hidden=true;render();showHelp();fit();
    if(pending?.id&&node(pending.id)&&pending.values){
      focusNode(pending.id);showNode(pending.id);
      const form=$("node-form");
      for(const key of ["title","de","kind","description","example","source","parent","color"]){
        const input=form.elements.namedItem(key);
        if(input&&typeof pending.values[key]==="string")input.value=pending.values[key];
      }
      form.dataset.changed="true";status();notice("Черновик восстановлен. Примените правки карточки и сохраните карту.");
    }
  }catch(error){notice(error.message,true);$("empty").replaceChildren(element("strong","", "Не удалось загрузить карту"),element("p","",error.message),button("Повторить",()=>location.reload()));}
});
function mutate(next){
  if(!canEdit())return false;
  try{validateBoard(next);}catch(error){notice(error.message,true);return false;}
  if(JSON.stringify(next)===JSON.stringify(data))return true;
  history.push(clone(data));if(history.length>40)history.shift();
  data=next;dirty=true;stash();notice("");render();return true;
}
async function save(){
  if(!data||!canEdit())return;
  const form=$("node-form");if(form&&form.dataset.changed==="true"&&!applyForm(form))return;
  if(!dirty)return;
  saving=true;status();
  try{snapshot=await request("PUT",boardPath(),{expectedRevision:snapshot.revision,data});data=clone(snapshot.data);dirty=false;history=[];stash();notice("");}
  catch(error){
    notice(error.status===409?"Карта уже изменена в другой вкладке. Ваш черновик сохранён в этом браузере. Выгрузите JSON и обновите страницу; изменения не перезаписаны.":error.message,true);
  }finally{saving=false;render();}
}
const cardMetrics=()=>{const rows=selectedGroupId?Math.min(4,selectedStudents().length):0;return viewMode==="hierarchy"?{w:220,h:112+rows*22}:{w:260,h:148+rows*22};};
function displayPosition(n){return hierarchyPositions.get(n.id)||{x:n.x,y:n.y};}
function storedOrder(a,b){return (a.x-b.x)||(a.y-b.y)||a.title.localeCompare(b.title,"ru");}
function buildHierarchyLayout(items){
  const result=new Map();if(!items.length)return result;
  const byId=new Map(items.map(n=>[n.id,n])),ids=new Set(byId.keys()),children=new Map(items.map(n=>[n.id,[]])),parents=new Map();
  for(const edge of data.edges){
    if(edge.kind!=="contains"||!ids.has(edge.source)||!ids.has(edge.target))continue;
    children.get(edge.source).push(byId.get(edge.target));parents.set(edge.target,edge.source);
  }
  for(const list of children.values())list.sort(storedOrder);
  const root=scope!=="overview"&&byId.has(scope)?byId.get(scope):items.find(n=>n.kind==="root"&&!parents.has(n.id))||items.find(n=>n.kind==="root")||items.find(n=>!parents.has(n.id))||items[0];
  const {w,h}=cardMetrics(),colGap=w+54,rowGap=h+34,topY=220;
  const direct=(children.get(root.id)||[]).slice();
  if(scope!=="overview"){
    result.set(root.id,{x:0,y:0});let y=topY;
    const walk=(parent,depth)=>{
      for(const child of children.get(parent.id)||[]){
        result.set(child.id,{x:Math.min(depth,4)*30,y});y+=rowGap;walk(child,depth+1);
      }
    };
    walk(root,0);
    let orphanY=topY;
    for(const n of items.filter(n=>!result.has(n.id)).sort(storedOrder)){result.set(n.id,{x:colGap,y:orphanY});orphanY+=rowGap;}
    return result;
  }
  let branches=direct;
  if(!branches.length)branches=items.filter(n=>n.id!==root.id&&!parents.has(n.id)).sort(storedOrder);
  result.set(root.id,{x:Math.max(0,(branches.length-1)*colGap/2),y:0});
  branches.forEach((branch,index)=>{
    const baseX=index*colGap;result.set(branch.id,{x:baseX,y:topY});let y=topY+rowGap;
    const walk=(parent,depth)=>{
      for(const child of children.get(parent.id)||[]){
        result.set(child.id,{x:baseX+Math.min(depth,3)*24,y});y+=rowGap;walk(child,depth+1);
      }
    };
    walk(branch,1);
  });
  let extraX=branches.length*colGap,extraY=topY;
  for(const n of items.filter(n=>!result.has(n.id)).sort(storedOrder)){result.set(n.id,{x:extraX,y:extraY});extraY+=rowGap;}
  return result;
}
function visibleNodes(){
  if(!data)return [];
  const active=data.nodes.filter(n=>!n.archived);
  if(viewMode==="hierarchy"){
    if(scope==="overview")return active;
    const ids=descendants(data,scope);ids.add(scope);
    return active.filter(n=>ids.has(n.id));
  }
  if(scope==="overview"){
    const ids=new Set(active.map(n=>n.id));
    return active.filter(n=>["root","topic"].includes(n.kind)||!data.edges.some(e=>e.kind==="contains"&&e.target===n.id&&ids.has(e.source)));
  }
  const ids=descendants(data,scope);ids.add(scope);
  return active.filter(n=>ids.has(n.id));
}
function render(){
  if(!data)return;
  const items=visibleNodes();hierarchyPositions=viewMode==="hierarchy"?buildHierarchyLayout(items):new Map();
  canvas.classList.toggle("hierarchy-view",viewMode==="hierarchy");
  $("view-free").classList.toggle("active",viewMode==="free");$("view-hierarchy").classList.toggle("active",viewMode==="hierarchy");
  status();renderCatalog();renderNodes();renderEdges();transform();
  $("count").textContent=data.nodes.filter(n=>n.kind==="skill"&&!n.archived).length;
  $("archive-count").textContent=data.nodes.filter(n=>n.archived).length;
  const label=boardTitle();const base=scope==="overview"?`${label} / Обзор программы`:`${label} / ${node(scope)?.title||"Раздел"}`;
  $("breadcrumb").textContent=base+(viewMode==="hierarchy"?" / Дерево":" / Карта");
}
function renderCatalog(){
  const container=$("sections");container.replaceChildren();
  for(const n of data.nodes.filter(n=>n.kind==="topic"&&!n.archived)){
    const e=button("",()=>openSection(n.id),"section"+(scope===n.id?" active":""));
    const dot=element("span","dot");dot.style.setProperty("--accent",colors[n.color]);
    const ids=descendants(data,n.id);
    e.append(dot,element("span","",n.title),element("span","number",data.nodes.filter(x=>ids.has(x.id)&&!x.archived&&x.kind==="skill").length));
    container.append(e);
  }
  $("overview").classList.toggle("active",scope==="overview");renderSearch();
}
function renderSearch(){
  if(!data)return;
  const q=$("search").value.trim().toLocaleLowerCase();
  const matches=data.nodes.filter(n=>showArchived?n.archived:!n.archived&&q&&[n.title,n.de,n.description].join(" ").toLocaleLowerCase().includes(q));
  $("results").hidden=!q&&!showArchived;$("sections").hidden=Boolean(q)||showArchived;$("overview").hidden=Boolean(q)||showArchived;
  $("results").replaceChildren();
  for(const n of matches)$("results").append(button(n.title,()=>{if(focusNode(n.id))showNode(n.id);},"search-result"));
  if((q||showArchived)&&matches.length===0)$("results").append(element("p","help","Ничего не найдено"));
  $("archives").classList.toggle("active",showArchived);
}
function renderNodes(){
  if(!data)return;
  layer.replaceChildren();const highlights=dependencyHighlights(),filters=currentTrackFilters(),activeTracks=filters.schools,chosen=selectedStudents();
  for(const n of visibleNodes()){
    const track=nodeTrackInfo(n);
    const trackRelevant=n.kind==="skill"
      ?(track.core?filters.core:track.schools.some(type=>activeTracks.has(type)))
      :data.nodes.some(skill=>skill.kind==="skill"&&!skill.archived&&descendants(data,n.id).has(skill.id)&&(()=>{const info=skillTrack(skill);return info.core?filters.core:info.schools.some(type=>activeTracks.has(type));})());
    const trackClass=!track.configured?" track-neutral":!trackRelevant?" track-other":n.kind==="skill"&&track.core&&filters.core?" track-core":" track-relevant";
    const relationClass=highlights.beforeNodes.has(n.id)?" dependency-before":highlights.afterNodes.has(n.id)?" dependency-after":highlights.active&&selection?.id!==n.id&&n.kind==="skill"?" dependency-dim":"";
    const groupClass=selectedGroupId?" group-mode":"";
    const e=element("div",`node kind-${n.kind}${groupClass}${trackClass}${selection?.type==="node"&&selection.id===n.id?" selected":""}${linkSource===n.id?" link-source":""}${relationClass}`);
    const p=displayPosition(n),metrics=cardMetrics();e.dataset.id=n.id;e.style.left=p.x+"px";e.style.top=p.y+"px";e.style.height=metrics.h+"px";e.style.setProperty("--accent",colors[n.color]);e.tabIndex=0;
    e.setAttribute("role","button");e.setAttribute("aria-label",`${kindLabels[n.kind]}: ${n.title}`);
    const count=n.kind==="topic"?descendants(data,n.id).size:null;
    const kind=element("div","kind",kindLabels[n.kind]),meta=element("span","kind-meta");
    if(count!==null)meta.append(element("span","",`${count} →`));
    if(!selectedGroupId&&selectedStudentId){
      const pct=masteryPercent(n,selectedStudentId),badge=element("span",`mastery-badge ${masteryClass(pct)}`,`${pct}%`);
      badge.title=n.kind==="skill"?`Освоение: ${selectedStudent()?.fullName||"ученик"}`:"Среднее по дочерним навыкам";
      meta.append(badge);
    }
    kind.append(meta);
    e.append(kind,element("div","title",n.title),element("div","de",n.de||"Добавьте описание навыка"));
    if(track.core||track.schools.length){
      const tags=element("div","track-badges");
      if(track.core)tags.append(element("span",`track-badge core${filters.core?" active":""}`,"CORE"));
      for(const type of track.schools)tags.append(element("span",`track-badge school school-${type.toLowerCase()}${activeTracks.has(type)?" active":""}`,schoolShort[type]||type));
      e.append(tags);
    }
    if(selectedGroupId){
      const list=element("div","mastery-list");
      for(const student of chosen.slice(0,4)){
        const row=element("div","mastery-person");
        row.append(element("span","mastery-person-name",student.fullName),element("span",`mastery-person-value ${masteryClass(masteryPercent(n,student.id))}`,`${masteryPercent(n,student.id)}%`));
        list.append(row);
      }
      if(chosen.length>4)list.append(element("div","mastery-more",`+ ещё ${chosen.length-4}`));
      e.append(list);
    }
    if(config.canEdit){
      for(const side of ["in","out"]){const port=element("button","port "+(side==="in"?"in":""));port.type="button";port.dataset.port=side;port.title=side==="in"?"Конец стрелки":"Потяните для создания стрелки";port.setAttribute("aria-label",port.title);e.append(port);}
    }
    e.addEventListener("dblclick",ev=>{ev.stopPropagation();if(n.kind==="topic"||n.kind==="root")openSection(n.kind==="root"?"overview":n.id);});
    e.addEventListener("keydown",ev=>{if(ev.key==="Enter"){selectNode(n.id);if(n.kind==="topic")openSection(n.id);}});
    layer.append(e);
  }
}
function pathBetween(a,b){
  const {w,h}=cardMetrics();
  if(viewMode==="hierarchy"){
    const sx=a.x+w/2,sy=a.y+h,tx=b.x+w/2,ty=b.y,d=Math.max(45,Math.abs(ty-sy)/2);
    return `M${sx},${sy} C${sx},${sy+d} ${tx},${ty-d} ${tx},${ty}`;
  }
  const vertical=b.y>a.y+h+22&&Math.abs(b.x-a.x)<600;
  const sx=vertical?a.x+w/2:a.x+w,sy=vertical?a.y+h:a.y+h/2;
  const tx=vertical?b.x+w/2:b.x,ty=vertical?b.y:b.y+h/2;
  if(vertical){const d=Math.max(55,Math.abs(ty-sy)/2);return `M${sx},${sy} C${sx},${sy+d} ${tx},${ty-d} ${tx},${ty}`;}
  const d=Math.max(65,Math.abs(tx-sx)/2);return `M${sx},${sy} C${sx+d},${sy} ${tx-d},${ty} ${tx},${ty}`;
}
function renderEdges(){
  if(!data)return;
  edgeLayer.replaceChildren();const ids=new Set(visibleNodes().map(n=>n.id)),highlights=dependencyHighlights();
  for(const edge of data.edges){
    if(!ids.has(edge.source)||!ids.has(edge.target)||edge.kind==="prerequisite"&&!$("prerequisites").checked)continue;
    const d=pathBetween(displayPosition(node(edge.source)),displayPosition(node(edge.target)));
    let dependencyClass="",marker=edge.kind==="contains"?"arrow-hierarchy":"arrow-pre";
    if(edge.kind==="prerequisite"){
      if(highlights.beforeEdges.has(edge.id)){dependencyClass=" dependency-before";marker="arrow-before";}
      else if(highlights.afterEdges.has(edge.id)){dependencyClass=" dependency-after";marker="arrow-after";}
      else if(highlights.active)dependencyClass=" dependency-dim";
    }
    for(const hit of [true,false]){
      const e=document.createElementNS(svgNS,"path");e.setAttribute("d",d);
      e.setAttribute("class",hit?"edge-hit":`edge ${edge.kind}${selection?.type==="edge"&&selection.id===edge.id?" selected":""}${dependencyClass}`);
      if(!hit)e.setAttribute("marker-end",`url(#${marker})`);
      e.dataset.edge=edge.id;edgeLayer.append(e);
    }
  }
  if(linkSource&&node(linkSource)){
    const source=displayPosition(node(linkSource));const e=document.createElementNS(svgNS,"path");e.setAttribute("d",pathBetween(source,{x:lastPoint.x,y:lastPoint.y-cardMetrics().h/2}));
    e.setAttribute("class","edge prerequisite");e.style.pointerEvents="none";edgeLayer.append(e);
  }
}
function transform(){
  world.style.transform=`translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  canvas.style.backgroundSize=`${22*view.z}px ${22*view.z}px`;
  canvas.style.backgroundPosition=`${view.x}px ${view.y}px`;$("zoom").textContent=Math.round(view.z*100)+"%";
}
function fit(){
  const items=visibleNodes();if(!items.length)return;
  const {w:cardW,h:cardH}=cardMetrics(),positions=items.map(n=>displayPosition(n));
  const minX=Math.min(...positions.map(p=>p.x)),maxX=Math.max(...positions.map(p=>p.x+cardW)),minY=Math.min(...positions.map(p=>p.y)),maxY=Math.max(...positions.map(p=>p.y+cardH));
  const w=canvas.clientWidth,h=canvas.clientHeight;view.z=Math.max(.12,Math.min(1,(w-90)/(maxX-minX||cardW),(h-150)/(maxY-minY||cardH)));
  view.x=(w-(maxX-minX)*view.z)/2-minX*view.z;view.y=(h-(maxY-minY)*view.z)/2-minY*view.z;transform();
}
function zoomAt(factor,x=canvas.clientWidth/2,y=canvas.clientHeight/2){
  const z=Math.max(.12,Math.min(2.5,view.z*factor)),ratio=z/view.z;
  view.x=x-(x-view.x)*ratio;view.y=y-(y-view.y)*ratio;view.z=z;transform();
}
function openSection(id){
  if(!flushForm())return;
  scope=id;selection=null;connectMode=false;linkSource=null;showArchived=false;$("search").value="";
  render();showHelp();fit();
}
function focusNode(id){
  if(!flushForm())return false;
  const n=node(id);if(!n)return;
  if(!n.archived&&!visibleNodes().some(x=>x.id===id)){
    let parent=id,seen=new Set();
    while(!seen.has(parent)){seen.add(parent);const edge=data.edges.find(e=>e.kind==="contains"&&e.target===parent);if(!edge)break;parent=edge.source;if(node(parent)?.kind==="topic")break;}
    scope=node(parent)?.kind==="topic"?parent:"overview";render();
  }
  const p=displayPosition(n),m=cardMetrics();view.z=1;view.x=canvas.clientWidth/2-(p.x+m.w/2);view.y=canvas.clientHeight/2-(p.y+m.h/2);transform();return true;
}
function selectNode(id){
  if(!flushForm())return false;
  selection={type:"node",id};renderNodes();renderEdges();showNode(id);return true;
}
function showHelp(){
  $("inspector-heading").textContent="Как работать";
  $("inspector-body").replaceChildren();
  const help=element("div","help");
  help.innerHTML="<h2>Карта группы и ученика</h2><p><strong>Выберите группу или ученика</strong> сверху. Для группы на карточке показываются проценты каждого ребёнка отдельно.</p><p><strong>CORE</strong> — общее ядро. Метки GYM / RS / WS / MS показывают, в каких школьных программах встречается навык. Темы, не относящиеся к школам выбранной группы, приглушаются.</p><p><strong>Нажмите на навык:</strong> синим подсветится, от чего он зависит, зелёным — где используется дальше.</p><p><strong>Вид «Карта»</strong> сохраняет свободное расположение карточек, а <strong>«Дерево»</strong> показывает иерархию.</p><p>Проценты каждого ученика сохраняются отдельно от структуры программы.</p>";
  if(!config?.canEdit)help.append(element("p","","Просмотр для преподавателя. Общую программу редактирует администратор."));
  $("inspector-body").append(help);
  if(innerWidth<850)$("inspector").classList.add("closed");
}
function field(form,label,name,value,kind="input",max=4000){
  const caption=element("label","",label);caption.htmlFor="field-"+name;
  const e=element(kind);e.id="field-"+name;e.name=name;e.value=value||"";e.maxLength=max;e.disabled=!canEdit();
  if(name==="title"){e.required=true;e.maxLength=200;}
  form.append(caption,e);return e;
}
function showNode(id){
  const n=node(id);if(!n)return;selection={type:"node",id};
  $("inspector").classList.remove("closed");$("inspector-heading").textContent=n.archived?"Карточка в архиве":"Свойства карточки";
  const chosen=selectedStudents(),masteryBox=element("div","mastery-box"),masteryTitle=element("div","mastery-title",`ОСВОЕНИЕ · ${selectedTargetLabel()}`);
  masteryBox.append(masteryTitle);
  if(!chosen.length){
    masteryBox.append(element("div","mastery-note","Выберите группу или ученика сверху."));
  }else{
    for(const student of chosen){
      const row=element("div","mastery-editor-row"),name=element("span","mastery-editor-name",student.fullName);
      row.append(name);
      if(n.kind==="skill"){
        const input=element("input");input.type="number";input.min="0";input.max="100";input.step="1";input.value=String(masteryPercent(n,student.id));input.setAttribute("aria-label",`Процент освоения: ${student.fullName}`);
        row.append(input,button("Сохранить",()=>void saveSkillMastery(student.id,n.id,input.value),"primary"));
      }else row.append(element("span",`mastery-editor-value ${masteryClass(masteryPercent(n,student.id))}`,`${masteryPercent(n,student.id)}%`));
      masteryBox.append(row);
    }
    masteryBox.append(element("div","mastery-note",n.kind==="skill"?"Процент хранится отдельно для каждого ученика.":"Для раздела показано среднее по дочерним навыкам."));
  }
  const form=element("form");form.id="node-form";form.dataset.id=id;form.dataset.changed="false";
  field(form,"НАЗВАНИЕ","title",n.title,"input",200);field(form,"НЕМЕЦКИЙ ТЕРМИН","de",n.de,"input",300);
  const caption=element("label","","ТИП КАРТОЧКИ");const kind=element("select");kind.name="kind";kind.disabled=!canEdit();
  for(const [v,t]of Object.entries(kindLabels)){const option=element("option","",t);option.value=v;kind.append(option);}kind.value=n.kind;form.append(caption,kind);
  field(form,"ЧТО РЕБЁНОК ДОЛЖЕН УМЕТЬ","description",n.description,"textarea");
  field(form,"ПРИМЕР ПРОВЕРКИ","example",n.example,"textarea");
  field(form,"ИСТОЧНИК / ПРИМЕЧАНИЕ","source",n.source,"textarea");
  const parentLabel=element("label","","РОДИТЕЛЬСКИЙ РАЗДЕЛ"),parent=element("select");parent.name="parent";parent.disabled=!canEdit();
  const none=element("option","","Без родителя");none.value="";parent.append(none);
  const excluded=descendants(data,id);excluded.add(id);
  const currentParent=data.edges.find(e=>e.kind==="contains"&&e.target===id)?.source;
  for(const candidate of data.nodes.filter(x=>(!x.archived||x.id===currentParent)&&!excluded.has(x.id))){
    const option=element("option","",candidate.title);option.value=candidate.id;parent.append(option);
  }
  parent.value=data.edges.find(e=>e.kind==="contains"&&e.target===id)?.source||"";form.append(parentLabel,parent);
  if(n.kind==="skill"){
    const info=skillTrack(n),coreLabel=element("label","track-edit-label","ПРОГРАММА НАВЫКА"),coreWrap=element("label","track-edit-check"),coreInput=element("input");
    coreInput.type="checkbox";coreInput.name="core";coreInput.checked=info.core;coreInput.disabled=!canEdit();coreWrap.append(coreInput,document.createTextNode(" CORE — общее ядро"));form.append(coreLabel,coreWrap);
    const schoolTitle=element("div","track-edit-title","ШКОЛЬНЫЕ ТРЕКИ"),schoolWrap=element("div","track-edit-grid");
    for(const type of allSchoolTypes){
      const label=element("label","track-edit-check"),input=element("input");input.type="checkbox";input.name="schoolTypes";input.value=type;input.checked=info.schools.includes(type);input.disabled=!canEdit();
      label.append(input,document.createTextNode(" "+(schoolShort[type]||type)));label.title=schoolLabels[type]||type;schoolWrap.append(label);
    }
    form.append(schoolTitle,schoolWrap);
  }
  const colorLabel=element("label","","ЦВЕТ РАЗДЕЛА"),color=element("select");color.name="color";color.disabled=!canEdit();
  for(const [v,t]of Object.entries({orange:"Оранжевый",blue:"Синий",violet:"Сиреневый",teal:"Бирюзовый",green:"Зелёный"})){const option=element("option","",t);option.value=v;color.append(option);}color.value=n.color;form.append(colorLabel,color);
  form.addEventListener("input",()=>{form.dataset.changed="true";$("save").disabled=!canEdit();$("save-state").textContent="Правки в карточке";stash();});
  const actions=element("div","actions");
  if(config.canEdit){
    actions.append(button("Применить",()=>applyForm(form),"primary"));
    actions.append(button(n.archived?"Восстановить":"В архив",()=>{
      if(!canEdit()||!flushForm())return;
      if(!n.archived&&!confirm("Убрать карточку в архив? История сохранится. Дочерние карточки не удаляются."))return;
      const next=clone(data);next.nodes.find(x=>x.id===id).archived=!n.archived;
      if(mutate(next)){showNode(id);}
    },n.archived?"":"danger"));
  }
  form.append(actions,element("div","id",`Постоянный ID: ${id}`));
  const relations=data.edges.filter(e=>e.source===id||e.target===id);
  if(relations.length)form.append(element("label","","СВЯЗИ"));
  for(const e of relations){
    const title=`${node(e.source)?.title} → ${node(e.target)?.title}`;
    const label=element("div","relation",`${e.kind==="contains"?"Входит в тему":"Нужно знать прежде"}: ${title}`);
    label.append(button("Открыть связь",()=>showEdge(e.id)));form.append(label);
  }
  const dependency=directDependencies(id),block=element("div","dependency-block");
  const beforeTitle=element("h3","", "ОТ ЧЕГО ЗАВИСИТ"),beforeList=element("div","dependency-list before");
  if(dependency.before.length)for(const item of dependency.before)beforeList.append(button(item.title,()=>{if(focusNode(item.id))selectNode(item.id);}));
  else beforeList.append(element("div","dependency-empty","Прямых предпосылок пока нет."));
  const afterTitle=element("h3","", "ГДЕ ИСПОЛЬЗУЕТСЯ ДАЛЬШЕ"),afterList=element("div","dependency-list after");
  if(dependency.after.length)for(const item of dependency.after)afterList.append(button(item.title,()=>{if(focusNode(item.id))selectNode(item.id);}));
  else afterList.append(element("div","dependency-empty","Следующие навыки пока не связаны стрелкой «нужно знать прежде»."));
  block.append(beforeTitle,beforeList,afterTitle,afterList);form.append(block);
  form.addEventListener("submit",e=>{e.preventDefault();applyForm(form);});
  $("inspector-body").replaceChildren(masteryBox,form);
}
function applyForm(form){
  if(!canEdit()||!form.reportValidity())return false;
  const next=clone(data),n=next.nodes.find(x=>x.id===form.dataset.id);if(!n)return false;
  const values=new FormData(form);
  for(const key of ["title","de","kind","description","example","source","color"])n[key]=String(values.get(key)||"").trim();
  if(n.kind==="skill"){
    n.core=values.has("core");
    n.schoolTypes=values.getAll("schoolTypes").map(String);
  }else{
    n.core=false;n.schoolTypes=[];
  }
  const parent=String(values.get("parent")||"");
  const current=next.edges.find(e=>e.kind==="contains"&&e.target===n.id);
  if((current?.source||"")!==parent){
    next.edges=next.edges.filter(e=>!(e.kind==="contains"&&e.target===n.id));
    if(parent)next.edges.push({id:uid("edge"),kind:"contains",source:parent,target:n.id});
  }
  const ok=mutate(next);if(ok){form.dataset.changed="false";showNode(n.id);stash();}
  return ok;
}
function showEdge(id){
  if(!flushForm())return;
  const e=data.edges.find(x=>x.id===id);if(!e)return;
  selection={type:"edge",id};renderEdges();renderNodes();$("inspector").classList.remove("closed");
  $("inspector-heading").textContent="Свойства стрелки";const body=$("inspector-body");body.replaceChildren();
  body.append(element("p","help",`${node(e.source)?.title} → ${node(e.target)?.title}`));
  body.append(element("p","help",e.kind==="contains"?"Источник — родительский раздел. Цель — вложенная карточка.":"Сначала осваивается навык у начала стрелки; затем — навык у наконечника."));
  if(config.canEdit){
    body.append(button("Изменить тип",()=>{const next=clone(data);next.edges.find(x=>x.id===id).kind=e.kind==="contains"?"prerequisite":"contains";if(mutate(next))showEdge(id);}));
    body.append(button("Удалить стрелку",()=>{const next=clone(data);next.edges=next.edges.filter(x=>x.id!==id);if(mutate(next)){selection=null;showHelp();}},"danger"));
  }
}
function addNode(kind="skill",point=null){
  if(!canEdit()||!data||!flushForm())return;
  const next=clone(data),id=uid("skill");
  const p=point||{x:(canvas.clientWidth/2-view.x)/view.z-130,y:(canvas.clientHeight/2-view.y)/view.z-74};
  next.nodes.push({id,kind,title:kind==="topic"?"Новый раздел":"Новый навык",de:"",description:"",example:"",source:"Добавлено вручную. Требования нужно уточнить.",color:node(scope)?.color||"orange",x:Math.round(p.x),y:Math.round(p.y),archived:false,core:false,schoolTypes:[]});
  const parent=scope!=="overview"?scope:kind==="topic"?data.nodes.find(n=>n.kind==="root"&&!n.archived)?.id:null;
  if(parent)next.edges.push({id:uid("edge"),kind:"contains",source:parent,target:id});
  if(mutate(next)){selectNode(id);$("field-title")?.focus();$("field-title")?.select();}
}
function addEdge(source,target){
  if(!canEdit()||source===target)return false;
  const next=clone(data);next.edges.push({id:uid("edge"),source,target,kind:"prerequisite"});
  if(mutate(next)){connectMode=false;linkSource=null;render();return true;}return false;
}
canvas.addEventListener("pointerdown",event=>{
  if(!data||![0,1].includes(event.button)||op)return;
  if(event.target.closest("button")&&!event.target.closest(".port"))return;
  const edge=event.target.closest("[data-edge]");
  if(edge){showEdge(edge.dataset.edge);event.preventDefault();return;}
  const card=event.target.closest(".node"),port=event.target.closest(".port");
  const pos={x:event.clientX,y:event.clientY};
  if(port&&canEdit()){
    if(!flushForm())return;
    connectMode=true;linkSource=card.dataset.id;op={type:"link",id:event.pointerId};canvas.setPointerCapture(event.pointerId);render();event.preventDefault();return;
  }
  if(card&&connectMode&&canEdit()){
    if(!linkSource)linkSource=card.dataset.id;else if(linkSource!==card.dataset.id)addEdge(linkSource,card.dataset.id);
    render();return;
  }
  if(card&&!space&&event.button===0){
    if(!selectNode(card.dataset.id))return;
    if(canEdit()&&viewMode==="free")op={type:"node",id:event.pointerId,nodeId:card.dataset.id,start:pos,original:clone(data),x:node(card.dataset.id).x,y:node(card.dataset.id).y,moved:false};
  }else{op={type:"pan",id:event.pointerId,start:pos,x:view.x,y:view.y};canvas.classList.add("dragging");}
  if(op){canvas.setPointerCapture(event.pointerId);event.preventDefault();}
});
canvas.addEventListener("pointermove",event=>{
  const rect=canvas.getBoundingClientRect();lastPoint={x:(event.clientX-rect.left-view.x)/view.z,y:(event.clientY-rect.top-view.y)/view.z};
  if(linkSource)renderEdges();
  if(!op||op.id!==event.pointerId)return;
  if(op.type==="pan"){view.x=op.x+event.clientX-op.start.x;view.y=op.y+event.clientY-op.start.y;transform();}
  if(op.type==="node"){
    const dx=(event.clientX-op.start.x)/view.z,dy=(event.clientY-op.start.y)/view.z;
    if(Math.abs(dx)+Math.abs(dy)>3)op.moved=true;
    if(op.moved){const n=node(op.nodeId);n.x=Math.max(-100000,Math.min(100000,Math.round(op.x+dx)));n.y=Math.max(-100000,Math.min(100000,Math.round(op.y+dy)));renderNodes();renderEdges();}
  }
});
function finishPointer(event,cancel=false){
  if(!op||op.id!==event.pointerId)return;const ended=op;op=null;
  if(ended.type==="node"&&ended.moved){
    if(cancel)data=ended.original;
    else{history.push(ended.original);if(history.length>40)history.shift();dirty=true;stash();}
    render();
  }
  if(ended.type==="link"&&!cancel){
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest(".node");
    if(target&&target.dataset.id!==linkSource)addEdge(linkSource,target.dataset.id);
  }
  if(cancel){connectMode=false;linkSource=null;render();}
  if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove("dragging");
}
canvas.addEventListener("pointerup",e=>finishPointer(e));canvas.addEventListener("pointercancel",e=>finishPointer(e,true));
canvas.addEventListener("wheel",e=>{e.preventDefault();const r=canvas.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*.0015),e.clientX-r.left,e.clientY-r.top);},{passive:false});
canvas.addEventListener("dblclick",e=>{if(data&&!e.target.closest(".node")&&!e.target.closest("button")&&!e.target.closest("[data-edge]"))addNode("skill",lastPoint);});
window.addEventListener("keydown",e=>{
  const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if(e.key==="Escape"){connectMode=false;linkSource=null;render();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();if($("node-form")?.dataset.changed==="true")applyForm($("node-form"));void save();}
  if(typing)return;
  if(e.code==="Space"){space=true;e.preventDefault();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();undo();}
});
window.addEventListener("keyup",e=>{if(e.code==="Space")space=false;});
window.addEventListener("blur",()=>{space=false;});
window.addEventListener("beforeunload",e=>{if(dirty||$("node-form")?.dataset.changed==="true"){stash();e.preventDefault();e.returnValue="";}});
function undo(){if(!canEdit()||!flushForm()||!history.length)return;data=history.pop();dirty=true;stash();selection=null;render();showHelp();}
$("save").onclick=()=>{if($("node-form")?.dataset.changed==="true"&&!applyForm($("node-form")))return;void save();};
$("add").onclick=()=>addNode();$("add-topic").onclick=()=>addNode("topic");
$("connect").onclick=()=>{if(!flushForm())return;connectMode=!connectMode;linkSource=null;notice(connectMode?"Выберите начало и конец стрелки.":"");render();};
function setViewMode(mode){
  if(!["free","hierarchy"].includes(mode)||!flushForm())return;
  viewMode=mode;selection=null;connectMode=false;linkSource=null;
  try{localStorage.setItem("mindcrafti.skills.viewMode",mode);}catch{/* Preference is optional. */}
  render();showHelp();fit();
}
$("undo").onclick=undo;$("overview").onclick=()=>openSection("overview");
function setCatalogCollapsed(collapsed){
  catalogCollapsed=Boolean(collapsed);
  const catalog=$("catalog"),toggle=$("catalog-toggle");
  catalog.classList.toggle("collapsed",catalogCollapsed);
  toggle.textContent=catalogCollapsed?"›":"‹";
  toggle.title=catalogCollapsed?"Развернуть разделы":"Свернуть разделы";
  toggle.setAttribute("aria-label",toggle.title);
  toggle.setAttribute("aria-expanded",String(!catalogCollapsed));
  try{localStorage.setItem("mindcrafti.skills.catalogCollapsed",String(catalogCollapsed));}catch{/* Preference is optional. */}
}
$("catalog-toggle").onclick=()=>setCatalogCollapsed(!catalogCollapsed);
setCatalogCollapsed(catalogCollapsed);
$("view-free").onclick=()=>setViewMode("free");$("view-hierarchy").onclick=()=>setViewMode("hierarchy");
$("student-filter").onchange=e=>void chooseStudent(e.target.value);$("search").oninput=()=>{showArchived=false;renderSearch();};
$("archives").onclick=()=>{showArchived=!showArchived;$("search").value="";renderSearch();};
$("prerequisites").onchange=renderEdges;$("zoom-in").onclick=()=>zoomAt(1.2);$("zoom-out").onclick=()=>zoomAt(1/1.2);$("fit").onclick=fit;
$("fullscreen").onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();setTimeout(fit,100);}catch{notice("Полноэкранный режим недоступен в этом браузере.");}};
$("close-inspector").onclick=()=>{if(!flushForm())return;selection=null;renderNodes();renderEdges();showHelp();$("inspector").classList.add("closed");};
$("export").onclick=()=>{
  if(!data||!flushForm())return;const blob=new Blob([JSON.stringify({id:snapshot.id,revision:snapshot.revision,exportedAt:new Date().toISOString(),data},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=element("a");a.href=url;a.download=`mindcrafti-skills-${boardId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
new ResizeObserver(()=>transform()).observe(canvas);
showHelp();status();
