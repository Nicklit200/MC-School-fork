/**
 * Month-by-month reference curricula for /skills.
 * A calendar is one revisioned NOTE in the existing board, not pupil mastery.
 */
import {createMonthlyReadinessPanel} from "./school-calendar-readiness-panel.js?v=20261122-3";

export const schoolCalendarLabels = {
  WIRTSCHAFTSSCHULE:"Wirtschaftsschule", REALSCHULE:"Realschule",
  GYMNASIUM:"Gymnasium", MITTELSCHULE:"Mittelschule",
  WERKREALSCHULE:"Werkrealschule", FACHOBERSCHULE:"Fachoberschule",
  GESAMTSCHULE:"Gesamtschule", OTHER:"Andere"
};
export const calendarMonths = [
  [9,"Сентябрь"], [10,"Октябрь"], [11,"Ноябрь"], [12,"Декабрь"],
  [1,"Январь"], [2,"Февраль"], [3,"Март"], [4,"Апрель"],
  [5,"Май"], [6,"Июнь"], [7,"Июль"]
];
const statuses = {
  DRAFT:"Черновик",
  EXAMPLE_NOT_SCHOOL_CONFIRMED:"Пример, не проверено в школе",
  SCHOOL_CONFIRMED:"Подтверждено конкретной школой"
};
const clone = value => JSON.parse(JSON.stringify(value));
const el = (tag, className="", text) => {
  const item=document.createElement(tag);
  if(className)item.className=className;
  if(text!==undefined)item.textContent=text;
  return item;
};
const button = (text,fn,cls="") => {
  const item=el("button",cls,text);
  item.type="button";
  item.addEventListener("click",fn);
  return item;
};
const labeled = (name,control) => {
  const wrapper=el("label","calendar-form-field");
  wrapper.append(el("span","",name),control);
  return wrapper;
};
const inputField = (value,onInput,placeholder="") => {
  const input=el("input","calendar-input");
  input.value=value||"";
  input.placeholder=placeholder;
  input.addEventListener("input",()=>onInput(input.value));
  return input;
};
const areaField = (value,onInput) => {
  const input=el("textarea","calendar-input calendar-textarea");
  input.value=value||"";
  input.rows=3;
  input.addEventListener("input",()=>onInput(input.value));
  return input;
};
const selectField = (choices,selected,onChange) => {
  const select=el("select","calendar-input");
  for(const [id,name] of choices) {
    const option=el("option","",name);
    option.value=id;
    select.append(option);
  }
  select.value=selected;
  select.addEventListener("change",()=>onChange(select.value));
  return select;
};
export const schoolCalendarNodeId = (school,grade,profile) =>
  "school_calendar_"+school.toLowerCase()+"_"+grade+"_"+profile.replace(/-/g,"_");
export const defaultSchoolProfile = school =>
  school==="WIRTSCHAFTSSCHULE"?"vierstufig":"allgemein";
export const schoolCalendarNodes = board =>
  (board?.nodes||[]).filter(n=>n.kind==="note"&&n.id.startsWith("school_calendar_")&&!n.archived);
export function savedSchoolCalendar(board,school,profile) {
  const id=schoolCalendarNodeId(school,board?.grade,profile);
  const note=schoolCalendarNodes(board).find(n=>n.id===id);
  if(!note)return null;
  try {
    const data=JSON.parse(note.description);
    if(data.version===1&&data.grade===board.grade&&data.schoolType===school
      &&data.profile===profile&&Array.isArray(data.months))return data;
  }catch{/* Ignore malformed notes, keep the rest of the skill board working. */}
  return null;
}
export const emptySchoolCalendar=(school,grade,profile)=>({
  version:1,schoolType:school,grade,profile,
  status:"DRAFT",sourceLabel:"",sourceUrl:"",
  officialSourceUrl:"https://www.lehrplanplus.bayern.de/",
  disclaimer:"Черновик: последовательность месяцев не подтверждена для конкретного класса. Проверяйте тетради и объявления учителя.",
  months:[]
});
export function validateSchoolCalendar(value,board) {
  if(!value||value.version!==1||!schoolCalendarLabels[value.schoolType]
    ||value.grade!==board?.grade||!(/^[a-z0-9-]{2,24}$/.test(value.profile||"")))
    throw Error("Неверный тип школы, класс или профиль.");
  if(!statuses[value.status])throw Error("Укажите достоверность плана.");
  if(!value.disclaimer||value.disclaimer.length>1000)throw Error("Добавьте пояснение о достоверности.");
  if((value.sourceLabel||"").length>500)throw Error("Слишком длинный источник.");
  for(const k of ["sourceUrl","officialSourceUrl"]) {
    const url=value[k]||"";
    if(url.length>500||(url&&!url.startsWith("https://")))throw Error("Ссылка должна начинаться с https://.");
  }
  if(value.status==="SCHOOL_CONFIRMED"&&!value.sourceLabel?.trim())
    throw Error("Для подтверждённого плана укажите конкретную школу и документ.");
  if(!Array.isArray(value.months)||value.months.length>12)throw Error("Можно указать не более 12 месяцев.");
  const seen=new Set();
  for(const row of value.months) {
    if(!Number.isInteger(row.month)||row.month<1||row.month>12||seen.has(row.month))
      throw Error("Проверьте месяц, он не должен повторяться.");
    seen.add(row.month);
    if((row.weeks||"").length>100||(row.note||"").length>900
      ||!Array.isArray(row.topics)||row.topics.length>12)
      throw Error("Сократите информацию за месяц.");
    for(const topic of row.topics) {
      if(!topic.name?.trim()||topic.name.length>160)throw Error("У каждой темы должно быть название.");
      if(topic.boardTopicId!=null&&!board.nodes.some(n=>n.id===topic.boardTopicId&&n.kind==="topic"))
        throw Error("Привязка указывает на отсутствующий раздел навыков.");
    }
  }
  if(JSON.stringify(value).length>4000)throw Error("Календарь слишком подробный, сократите описания.");
  return true;
}
export function createSchoolCalendarPanel({getBoard,getStudentSchool,getStudents,getMastery,refreshMastery,canEdit,onCommit,notify}) {
  const $=id=>document.getElementById(id);
  const panel=$("school-calendar-panel"),sheet=$("school-calendar-body"),monthButtons=$("calendar-months");
  const schoolSelect=$("calendar-school"),profileInput=$("calendar-profile");
  const save=$("calendar-save"),saveStatus=$("calendar-save-status");
  if(!panel||!sheet||!monthButtons||!schoolSelect||!profileInput||!save)
    return{open(){},close(){},sync(){}};
  let school="WIRTSCHAFTSSCHULE",profile="vierstufig",month=11;
  let working=null,original="",dirty=false,saving=false;
  const readiness=createMonthlyReadinessPanel({getBoard,getStudents,getMastery,refreshMastery,onChange:render});
  for(const [id,label] of Object.entries(schoolCalendarLabels)) {
    const option=el("option","",label);option.value=id;schoolSelect.append(option);
  }
  const isEditable=()=>canEdit()&&!saving;
  function change() {
    dirty=JSON.stringify(working)!==original;
    save.disabled=!isEditable()||!dirty;
    saveStatus.textContent=dirty?"Есть изменения":"Без изменений";
  }
  function guard() {
    return !dirty||window.confirm("Календарь не сохранён. Отменить изменения?");
  }
  function load() {
    const persisted=savedSchoolCalendar(getBoard(),school,profile);
    working=clone(persisted||emptySchoolCalendar(school,getBoard().grade,profile));
    original=JSON.stringify(working);dirty=false;
    render();
    saveStatus.textContent=persisted?"Загружено из карты навыков":"План ещё не добавлен";
  }
  function close() {
    if(!guard())return;
    panel.hidden=true;
    readiness.close();
  }
  $("school-calendar-close")?.addEventListener("click",close);
  panel.addEventListener("click",event=>{if(event.target===panel)close();});
  panel.addEventListener("keydown",event=>{
    if(event.key==="Escape"){event.stopPropagation();close();}
  });
  schoolSelect.addEventListener("change",()=>{
    const next=schoolSelect.value;
    if(!guard()){schoolSelect.value=school;return;}
    school=next;profile=defaultSchoolProfile(school);
    profileInput.value=profile;load();
  });
  profileInput.addEventListener("change",()=>{
    const next=profileInput.value.trim().toLowerCase();
    if(!guard()){profileInput.value=profile;return;}
    if(!(/^[a-z0-9-]{2,24}$/.test(next))){
      profileInput.value=profile;
      notify?.("Профиль: латинские буквы, цифры и дефисы.",true);return;
    }
    profile=next;load();
  });
  save.addEventListener("click",async()=>{
    if(!working||!dirty||!isEditable())return;
    saving=true;save.disabled=true;saveStatus.textContent="Сохранение...";
    try {
      validateSchoolCalendar(working,getBoard());
      const board=clone(getBoard()),id=schoolCalendarNodeId(school,board.grade,profile);
      const currentIndex=board.nodes.findIndex(n=>n.id===id);
      const existing=currentIndex>=0?board.nodes[currentIndex]:null;
      const entry={
        id,kind:"note",title:existing?.title||"Календарь тем · "+schoolCalendarLabels[school]+" "+board.grade,
        de:"Помесячный ориентир",description:JSON.stringify(working),example:"",
        source:working.sourceLabel||"Не подтверждено школой",color:"blue",
        x:existing?.x??3600,y:existing?.y??2200,
        archived:false,core:false,schoolTypes:[school]
      };
      if(currentIndex>=0)board.nodes[currentIndex]=entry;else board.nodes.push(entry);
      await onCommit(board);
      const persisted=savedSchoolCalendar(getBoard(),school,profile);
      if(JSON.stringify(persisted)!==JSON.stringify(working))
        throw Error("Сервер ещё не подтвердил календарь. Проверьте состояние карты.");
      original=JSON.stringify(working);dirty=false;
      saveStatus.textContent="Сохранено и доступно через MCP";
      notify?.("Календарь сохранён в карте навыков.");
    }catch(error){
      saveStatus.textContent=error?.message||"Ошибка сохранения";
      notify?.(saveStatus.textContent,true);
    }finally {
      saving=false;
      save.disabled=!dirty||!canEdit();
    }
  });
  function render() {
    if(!working||panel.hidden)return;
    schoolSelect.value=school;profileInput.value=profile;
    profileInput.disabled=!canEdit();
    $("calendar-grade").textContent=String(getBoard().grade)+" класс";
    $("calendar-status").textContent=statuses[working.status]||"Без статуса";
    $("calendar-status").dataset.kind=working.status;
    $("calendar-disclaimer").textContent=working.disclaimer;
    $("calendar-caution").textContent=working.status==="SCHOOL_CONFIRMED"
      ?"Даже подтверждённый план не гарантирует даты контрольных или фактический темп конкретного класса."
      :"Это ориентир, не календарь проверочных ученика. Подтвердите реальные темы по школьной тетради.";
    const src=$("calendar-source-link");src.replaceChildren();
    if(working.sourceUrl?.startsWith("https://")){
      const link=el("a","",working.sourceLabel||"Источник");
      link.href=working.sourceUrl;link.target="_blank";link.rel="noopener noreferrer";src.append(link);
    }else src.textContent=working.sourceLabel||"Источник не указан";
    readiness.selection(school);
    monthButtons.replaceChildren();
    for(const [value,label] of calendarMonths){
      const planned=working.months.find(x=>x.month===value);
      const tile=button("",()=>{month=value;render();},
        "calendar-month"+(month===value?" active":"")+(planned?" filled":""));
      tile.append(el("strong","",label),el("span","",planned?.weeks||"Нет данных"));
      if(planned?.topics?.length)tile.append(el("small","",planned.topics.slice(0,2).map(t=>t.name).join(", ")));
      const badge=readiness.monthBadge(planned);
      if(badge)tile.append(badge);
      monthButtons.append(tile);
    }
    sheet.replaceChildren();
    const title=calendarMonths.find(x=>x[0]===month)?.[1]||"Месяц";
    sheet.append(el("h3","",title));
    const record=working.months.find(m=>m.month===month);
    sheet.append(readiness.details(record));
    if(!record){
      sheet.append(el("p","calendar-empty","Для этого месяца пока нет данных. Не следует предполагать темы и контрольные."));
      if(isEditable())sheet.append(button("＋ Добавить месяц",()=>{
        working.months.push({month,weeks:"",topics:[],note:""});
        const order=calendarMonths.map(x=>x[0]);
        working.months.sort((a,b)=>order.indexOf(a.month)-order.indexOf(b.month));
        change();render();
      },"calendar-add"));
    }else{
      if(isEditable())sheet.append(labeled("Учебные недели",inputField(record.weeks,val=>{
        record.weeks=val;change();
      },"Например KW 45-48")));
      else sheet.append(el("p","calendar-weeks",record.weeks||"Недели не указаны"));
      sheet.append(el("h4","","Темы месяца"));
      if(!record.topics.length)sheet.append(el("p","calendar-empty","Темы не заполнены."));
      for(const [index,topic] of record.topics.entries()){
        const row=el("div","calendar-topic");
        if(isEditable()){
          row.append(inputField(topic.name,val=>{topic.name=val;change();},"Тема"));
          const choices=[["","Без привязки"],...getBoard().nodes.filter(n=>n.kind==="topic"&&!n.archived)
            .map(n=>[n.id,n.title])];
          row.append(selectField(choices,topic.boardTopicId||"",val=>{
            topic.boardTopicId=val||null;change();
          }));
          row.append(button("×",()=>{record.topics.splice(index,1);change();render();},"calendar-remove"));
        }else{
          row.append(el("strong","",topic.name));
          const linked=getBoard().nodes.find(n=>n.id===topic.boardTopicId);
          if(linked)row.append(el("small","",linked.title));
        }
        sheet.append(row);
      }
      if(isEditable()){
        sheet.append(button("＋ Добавить тему",()=>{
          if(record.topics.length>=12){notify?.("Максимум 12 тем за месяц.",true);return;}
          record.topics.push({name:"Новая тема",boardTopicId:null});change();render();
        },"calendar-add"));
        sheet.append(labeled("Описание",areaField(record.note,val=>{record.note=val;change();})));
        sheet.append(button("Удалить месяц",()=>{
          if(!window.confirm("Удалить месяц из календаря?"))return;
          working.months=working.months.filter(m=>m.month!==month);change();render();
        },"calendar-remove-month"));
      }else if(record.note)sheet.append(el("p","calendar-note",record.note));
    }
    if(isEditable()){
      const extra=el("section","calendar-metadata");
      extra.append(el("h4","","Источник и достоверность"));
      extra.append(labeled("Статус",selectField(Object.entries(statuses),working.status,val=>{
        working.status=val;change();render();
      })));
      extra.append(labeled("Школа или пример",inputField(working.sourceLabel,val=>{
        working.sourceLabel=val;change();
      })));
      extra.append(labeled("Ссылка на источник",inputField(working.sourceUrl,val=>{
        working.sourceUrl=val;change();
      },"https://...")));
      extra.append(labeled("Предупреждение",areaField(working.disclaimer,val=>{
        working.disclaimer=val;
        $("calendar-disclaimer").textContent=val;change();
      })));
      sheet.append(extra);
    }
    save.hidden=!canEdit();
    change();
  }
  return {
    open(){
      if(!getBoard()){notify?.("Выберите ученика или группу для открытия календаря.",true);return;}
      panel.hidden=false;
      const selected=getStudentSchool();
      school=schoolCalendarLabels[selected]?selected:"WIRTSCHAFTSSCHULE";
      profile=defaultSchoolProfile(school);
      month=new Date().getMonth()+1;load();
      readiness.open();
    },
    close,
    sync(){if(!panel.hidden&&!dirty)load();}
  };
}
