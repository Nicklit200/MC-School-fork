import {calculateMonthReadiness, calculateIndividualMonthReadiness} from "./school-calendar-readiness.js?v=20261122-4";
import {schoolYearMonthKey,schoolYearStartForDate} from "./school-calendar-month-index.js";

/** Visible readiness is derived from the latest student skills, never stored as fake grades. */
export function createMonthlyReadinessPanel({getBoard,getStudents,getMastery,getEvidence,getIndividualMonths,refreshMastery,onChange}) {
  const byId=id=>document.getElementById(id);
  const panel=byId("school-calendar-panel");
  const studentSelect=byId("calendar-student");
  const studentWrap=byId("calendar-student-wrap");
  const refreshButton=byId("calendar-refresh");
  const refreshedAt=byId("calendar-progress-updated");
  let school="",studentId="",busy=false,lastFetched=0,lastError="",refreshTimer=null;
  const element=(tag,cls="",text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const students=()=>getStudents?.()||[];
  const eligible=()=>students().filter(s=>Number(s.grade)===getBoard()?.grade&&s.schoolType===school);
  const student=()=>eligible().find(s=>s.id===studentId)||null;
  const result=month=>{
    if(!student() || !month)return student()?calculateMonthReadiness(getBoard(),month,getMastery?.(studentId)||{},school):null;
    const individual=getIndividualMonths?.(studentId)?.[schoolYearMonthKey(schoolYearStartForDate(),month.month)]||null;
    return calculateIndividualMonthReadiness(getBoard(),individual,getMastery?.(studentId)||{},school)
      ||calculateMonthReadiness(getBoard(),month,getMastery?.(studentId)||{},school);
  };
  const level=r=>r?.status!=="ESTIMATED"?"unverified":r.percent>=80?"high":r.percent>=60?"medium":"low";
  const status=r=>{
    if(!r)return "Нет подходящего ученика";
    if(r.status==="ESTIMATED")return r.percent+"%";
    if(r.status==="INSUFFICIENT_DATA")return "Мало данных";
    if(r.status==="NO_DATA")return "Не оценено";
    if(r.status==="UNMAPPED")return "Нет связей";
    return "Нет программы";
  };
  function selection(nextSchool) {
    school=nextSchool;
    const allowed=eligible();
    if(!allowed.some(s=>s.id===studentId))studentId=allowed[0]?.id||"";
    if(studentWrap)studentWrap.hidden=students().length===0;
    if(studentSelect){
      studentSelect.replaceChildren();
      if(!allowed.length){const option=element("option","","Нет подходящего ученика");option.value="";studentSelect.append(option);}
      for(const pupil of allowed){const option=element("option","",pupil.fullName||"Ученик");option.value=pupil.id;studentSelect.append(option);}
      studentSelect.value=studentId;studentSelect.disabled=allowed.length<=1;
    }
    refreshLabel();
  }
  function refreshLabel() {
    if(refreshButton)refreshButton.disabled=busy||!students().length||panel?.hidden;
    if(refreshedAt)refreshedAt.textContent=busy?"Проверяем новые оценки..."
      :lastError?"Ошибка обновления: "+lastError
      :lastFetched?"Обновлено "+new Date(lastFetched).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})
      :"Данные карты на текущий момент";
  }
  async function refresh() {
    if(busy||panel?.hidden||!students().length)return;
    busy=true;lastError="";refreshLabel();
    try{await refreshMastery?.();lastFetched=Date.now();}
    catch(e){lastError=e?.message||"Не удалось загрузить оценки";}
    finally{busy=false;refreshLabel();onChange();}
  }
  studentSelect?.addEventListener("change",()=>{studentId=studentSelect.value;onChange();});
  refreshButton?.addEventListener("click",()=>void refresh());
  window.addEventListener("focus",()=>{if(panel&&!panel.hidden&&Date.now()-lastFetched>30000)void refresh();});
  function open(){
    lastError="";
    if(refreshTimer!==null)clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{if(panel&&!panel.hidden&&!document.hidden)void refresh();},90000);
    void refresh();
  }
  function close(){if(refreshTimer!==null)clearInterval(refreshTimer);refreshTimer=null;}
  function monthBadge(month) {
    if(!month)return null;
    const r=result(month),badge=element("em","calendar-month-readiness "+level(r),status(r));
    badge.title=r&&r.totalCount
      ?`Навыки: ${r.assessedCount} из ${r.totalCount} проверено. Это оценка на сегодня, не готовность к контрольной.`
      :"Нет достаточных данных об освоении навыков";
    return badge;
  }
  function details(month) {
    const block=element("section","calendar-readiness-summary");
    const s=student();
    if(!s){
      block.append(element("strong","","Индивидуальная готовность"));
      block.append(element("p","calendar-readiness-explanation",students().length
        ?"Тип школы и класс выбранного ученика не соответствуют этому календарю. Для группы результаты считаются отдельно для каждого ребёнка."
        :"Сначала выберите ученика на карте навыков."));
      return block;
    }
    const r=result(month);
    const heading=element("div","calendar-readiness-heading");
    heading.append(element("strong","",`Готовность ${s.fullName||"ученика"}`));
    heading.append(element("span","calendar-readiness-number "+level(r),status(r)));
    block.append(heading);
    if(r.source==="INDIVIDUAL_PLAN"){
      block.append(element("p","calendar-readiness-source","Расчёт по навыкам индивидуального плана именно этого месяца. Используются текущие оценки из карты навыков."));
      const mapped=getIndividualMonths?.(studentId)?.[schoolYearMonthKey(schoolYearStartForDate(),month?.month)];
      if(Array.isArray(mapped?.topics)&&mapped.topics.length)
        block.append(element("p","calendar-readiness-individual-topics","Темы индивидуального плана: "+mapped.topics.join(" · ")));
    }
    if(r.totalCount>0) {
      const coverage=element("div","calendar-coverage");
      coverage.append(element("span","",`Подтверждено навыков: ${r.assessedCount} из ${r.totalCount} (${r.coveragePercent}%)`));
      const bar=element("div","calendar-coverage-track"),fill=element("div","calendar-coverage-fill");
      fill.style.width=r.coveragePercent+"%";bar.append(fill);coverage.append(bar);block.append(coverage);
    }
    const message=r.status==="ESTIMATED"
      ?(r.unmappedTopics.length?"Предварительная оценка по проверенным навыкам. Есть темы вне расчёта, поэтому процент НЕ означает полную готовность к контрольной.":"Предварительная готовность по текущему освоению навыков. Не является прогнозом школьной оценки.")
      :r.status==="INSUFFICIENT_DATA"
        ?`Навыков пока недостаточно для достоверного общего процента.${r.observedPercent===null?"":" По оценённым навыкам среднее "+r.observedPercent+"%."}`
        :r.status==="NO_DATA"
          ?"Эти навыки ещё не проверялись. Это не означает 0% знаний."
          :r.status==="UNMAPPED"
            ?"Темы не привязаны к навыкам карты. Без связей процент рассчитывать нельзя."
            :"Темы этого месяца ещё не добавлены.";
    block.append(element("p","calendar-readiness-explanation",message));
    if(r.unmappedTopics.length)block.append(element("p","calendar-readiness-alert",
      "Без связи с картой навыков: "+r.unmappedTopics.join(", ")+"."));
    const orderedSkills=[...new Map(r.topics.flatMap(topic=>topic.skills)
      .map(skill=>[skill.id,skill])).values()];
    if(orderedSkills.length) {
      const heading=element("h4","calendar-readiness-skills-heading",`Навыки месяца (${orderedSkills.length})`);
      block.append(heading);
      const grid=element("div","calendar-readiness-skills-grid");
      const allEvidence=getEvidence?.(studentId);
      const evidenceError=!Array.isArray(allEvidence)?allEvidence?.error:null;
      const sourceNames={
        LESSON:"Урок",HOMEWORK:"Домашнее задание",TEST:"Тест",
        TEACHER_OBSERVATION:"Наблюдение преподавателя"
      };
      const independence={
        FIRST_TRY:"Поняла с первого раза",INDEPENDENT:"Самостоятельно",
        HINTED:"С подсказкой учителя",AFTER_EXPLANATION:"После объяснения",
        NOT_YET:"Пока не справилась",UNKNOWN:"Степень самостоятельности неизвестна"
      };
      const evidenceRows=Array.isArray(allEvidence)?allEvidence:[];
      for(const skill of orderedSkills) {
        const item=element("details","calendar-skill-proof");
        const summary=element("summary","calendar-skill-proof-summary");
        summary.append(element("span","calendar-skill-proof-title",skill.title));
        const score=element("strong","calendar-skill-proof-percent "+
          (skill.value===null?"unverified":skill.value>=80?"high":skill.value>=60?"medium":"low"),
          skill.value===null?"Не оценён":skill.value+"%");
        summary.append(score);
        item.append(summary);
        const inside=element("div","calendar-skill-proof-body");
        if(evidenceError) {
          inside.append(element("p","calendar-proof-muted","Не удалось загрузить доказательства: "+evidenceError));
        } else {
          const relevant=evidenceRows.filter(entry=>entry.skillId===skill.id);
          if(relevant.length===0) {
            inside.append(element("p","calendar-proof-muted",
              skill.value===null
                ?"Навык ещё не оценивался. Доказательства будут появляться после анализа заданий."
                :"Процент уже сохранён в карте, но обоснование пока не было записано. Нельзя достоверно указать самостоятельность без анализа уроков и домашки."));
          } else {
            const superseded=new Set(relevant.map(e=>e.supersedesId).filter(Boolean));
            for(const observation of relevant.slice(0,8)){
              const proof=element("div","calendar-proof-entry"+(superseded.has(observation.id)?" corrected":""));
              const header=element("div","calendar-proof-header");
              const source=sourceNames[observation.sourceType]||"Источник";
              const timestamp=observation.observedAt?
                new Date(observation.observedAt).toLocaleDateString("ru-RU"):"Дата не указана";
              header.append(element("strong","",source+" · "+timestamp));
              proof.append(header);
              proof.append(element("p","calendar-proof-autonomy",independence[observation.autonomy]||"Наблюдение"));
              proof.append(element("p","calendar-proof-explanation",observation.explanation||""));
              if(observation.sourceExcerpt) proof.append(element("blockquote","calendar-proof-excerpt",observation.sourceExcerpt));
              if(observation.sourceRef) proof.append(element("small","calendar-proof-ref","Источник: "+observation.sourceRef));
              if(observation.masteryAfter!==null&&observation.masteryAfter!==undefined)
                proof.append(element("small","calendar-proof-ref","Оценка после наблюдения: "+observation.masteryAfter+"%"));
              if(superseded.has(observation.id))proof.append(element("small","calendar-proof-correction","Позже исправлено. Сохранено для истории."));
              if(observation.correctionReason)proof.append(element("small","calendar-proof-correction","Причина уточнения: "+observation.correctionReason));
              inside.append(proof);
            }
          }
        }
        inside.append(element("p","calendar-proof-footnote",
          "Наблюдения и исправления сохраняются через MCH3. Сам процент берётся из карты навыков."));
        item.append(inside);
        grid.append(item);
      }
      block.append(grid);
    }
    if(r.unassessedSkills.length)
      block.append(element("p","calendar-readiness-unassessed",
        `Не оценено навыков: ${r.unassessedSkills.length}. Они не считаются нулевыми.`));
    block.append(element("p","calendar-readiness-fineprint",
      "Оценка действует на сегодня, не показывает результат на конец прошлого месяца. Индивидуальный план имеет приоритет над широкими разделами календаря; реальные темы и даты контрольных уточняйте в школе."));
    return block;
  }
  return {selection,monthBadge,details,open,close,refresh};
}
