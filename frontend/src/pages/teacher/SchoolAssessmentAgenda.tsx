import {useEffect,useState} from 'react';
import type {StudentListItem} from '../../api/types';
import {schoolAssessmentsApi,type SchoolAssessment,type SchoolAssessmentDraft,type SchoolAssessmentKind,type SchoolAssessmentReadiness} from '../../api/schoolAssessments';

type Props={
  language:'DE'|'RU'; students:StudentListItem[]; selectedDate:string;
  events:SchoolAssessment[]; onChanged:()=>Promise<void>;
};
const kindNames:Record<SchoolAssessmentKind,string>={
 KLASSENARBEIT:'Контрольная',TEST:'Тест',EXAM:'Экзамен',QUIZ:'Проверочная',OTHER:'Другая проверка'
};
const empty=(date:string,student:string):SchoolAssessmentDraft=>({
 studentId:student,examDate:date,kind:'KLASSENARBEIT',title:'Контрольная по математике',
 topics:[],notes:'',sourceType:'TEACHER_NOTE',confirmationStatus:'REPORTED'
});
const toInput=(event:SchoolAssessment):SchoolAssessmentDraft=>({
 studentId:event.studentId,examDate:event.examDate,kind:event.kind,title:event.title,
 topics:event.topics,notes:event.notes??'',sourceType:event.sourceType,
 sourceRef:event.sourceRef??undefined,sourceExcerpt:event.sourceExcerpt??undefined,
 confirmationStatus:event.confirmationStatus
});
export function SchoolAssessmentAgenda({language,students,selectedDate,events,onChanged}:Props){
 const [editor,setEditor]=useState(false);
 const [editing,setEditing]=useState<SchoolAssessment|null>(null);
 const [draft,setDraft]=useState<SchoolAssessmentDraft>(()=>empty(selectedDate,students[0]?.id??''));
 const [topics,setTopics]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [expanded,setExpanded]=useState<string|null>(null);
 const [readinessById,setReadinessById]=useState<Record<string,SchoolAssessmentReadiness>>({});
 const [readinessErrors,setReadinessErrors]=useState<Record<string,string>>({});
 const [readinessBusy,setReadinessBusy]=useState<string|null>(null);
 async function loadReadiness(id:string) {
   setReadinessBusy(id);
   setReadinessErrors(old=>({...old,[id]:''}));
   try{
     const data=await schoolAssessmentsApi.readiness(id);
     setReadinessById(old=>({...old,[id]:data}));
   }catch(err){setReadinessErrors(old=>({...old,[id]:err instanceof Error?err.message:String(err)}));}
   finally{setReadinessBusy(null);}
 }
 function toggle(id:string) {
   if(expanded===id){setExpanded(null);return;}
   setExpanded(id);void loadReadiness(id);
 }
 useEffect(()=>{if(!editor){setDraft(empty(selectedDate,students[0]?.id??''));setTopics('');}},[selectedDate,students,editor]);
 const shown=events.filter(event=>event.examDate===selectedDate);
 const start=(event?:SchoolAssessment)=>{
   setError('');setEditing(event??null);setDraft(event?toInput(event):empty(selectedDate,students[0]?.id??''));
   setTopics(event?.topics.join('\n')??'');setEditor(true);
 };
 async function save(){
   if(busy)return;setBusy(true);setError('');
   try{
     const next={...draft,topics:topics.split(/\n|;/).map(s=>s.trim()).filter(Boolean)};
     if(!next.studentId||!next.examDate||!next.title.trim())throw Error('Укажите ученика, дату и название');
     if(next.sourceType==='TRANSCRIPT'&&(!next.sourceRef?.trim()||!next.sourceExcerpt?.trim()))
       throw Error('Для транскрипции необходимы ID урока и подтверждающая цитата');
     if(next.confirmationStatus==='SCHOOL_CONFIRMED'&&next.sourceType!=='SCHOOL_DOCUMENT')
       throw Error('Подтверждение школы требует школьного документа');
     if(editing)await schoolAssessmentsApi.update(editing.id,{...next,expectedRevision:editing.revision});
     else await schoolAssessmentsApi.create(next,'assessment-ui-'+crypto.randomUUID());
     await onChanged();setEditor(false);setEditing(null);
   }catch(e){setError(e instanceof Error?e.message:String(e));}
   finally{setBusy(false);}
 }
 return <section className="school-assessments" aria-label={language==='DE'?'Schulprüfungen':'Школьные контрольные'}>
   <div className="school-assessments__heading">
     <strong>{language==='DE'?'Schulprüfungen':'Контрольные и экзамены'}</strong>
     <button type="button" className="btn btn--secondary" onClick={()=>start()}>{language==='DE'?'+ Prüfung hinzufügen':'+ Добавить контрольную'}</button>
   </div>
   {shown.length===0&&!editor&&<p className="muted">{language==='DE'?'An diesem Tag sind keine Prüfungen eingetragen.':'На этот день контрольных пока нет.'}</p>}
   {shown.map(event=><article className="school-assessment-card" key={event.id}>
     <button type="button" className="school-assessment-card__trigger" aria-expanded={expanded===event.id}
       onClick={()=>toggle(event.id)}>
       <span className="school-assessment-card__emoji">📝</span>
       <span><strong>{event.studentName}: {event.title}</strong><small>{kindNames[event.kind]} · {event.confirmationStatus==='SCHOOL_CONFIRMED'?'Подтверждено школой':'Сообщено, школа не подтверждала'}</small></span>
       <span aria-hidden="true">{expanded===event.id?'▴':'▾'}</span>
     </button>
     {expanded===event.id&&<div className="school-assessment-card__details">
       <div className="school-exam-readiness">
         <div className="school-exam-readiness__top">
           <strong>Готовность к контрольной по навыкам</strong>
           <button type="button" className="btn btn--secondary" disabled={readinessBusy===event.id}
             onClick={()=>void loadReadiness(event.id)}>Обновить оценки</button>
         </div>
         {readinessBusy===event.id&&!readinessById[event.id]&&<p className="muted">Загружаем навыки…</p>}
         {readinessErrors[event.id]&&<p className="muted" role="alert">Не удалось загрузить оценки: {readinessErrors[event.id]}</p>}
         {readinessById[event.id]&&(()=>{
            const r=readinessById[event.id];
            return <div>
              <div className="school-exam-readiness__score">
                <strong>{r.percent===null?'Не оценено':r.percent+'%'}</strong>
                <span className="muted">Проверено {r.assessedCount} из {r.totalCount} навыков ({r.coveragePercent}%)</span>
              </div>
              <div className="school-exam-readiness__bar" role="progressbar" aria-label="Покрытие оценками" aria-valuenow={r.coveragePercent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{width:r.coveragePercent+'%'}}/>
              </div>
              {r.skills.length?<div className="school-exam-readiness__skills">
                {r.skills.map(skill=><div key={skill.id} className="school-exam-readiness__skill">
                  <span>{skill.title}</span><strong>{skill.percent===null?'Не оценено':skill.percent+'%'}</strong>
                </div>)}
              </div>:<p className="muted">Навыки контрольной пока не привязаны. Их можно привязать через коннектор MCH3.</p>}
              {r.unmappedTopics.length>0&&<p className="school-exam-readiness__unmapped">Без активной оценки: {r.unmappedTopics.join(', ')}.</p>}
              {r.status==='PARTIAL'&&<p className="muted">Предварительная оценка только по проверенным навыкам, не полная готовность к контрольной.</p>}
              <small className="muted">Связи навыков редактируются через MCH3. Проценты берутся из карты навыков ученика.</small>
            </div>;
         })()}
       </div>
       <strong>Предполагаемые темы</strong>
       {event.topics.length?<ul>{event.topics.map(topic=><li key={topic}>{topic}</li>)}</ul>:<p className="muted">Темы ещё не указаны.</p>}
       {event.notes&&<p>{event.notes}</p>}
       <p className="muted">Источник: {{
         TRANSCRIPT:'расшифровка урока',STUDENT_REPORTED:'со слов ученика',
         TEACHER_NOTE:'заметка преподавателя',VOICE_NOTE:'голосовая заметка',
         SCHOOL_DOCUMENT:'школьный документ'
       }[event.sourceType]}{event.sourceRef?' · '+event.sourceRef:''}</p>
       {event.sourceExcerpt&&<blockquote className="school-assessment-card__quote">{event.sourceExcerpt}</blockquote>}
       <button type="button" className="btn btn--secondary" onClick={()=>start(event)}>Уточнить дату или темы</button>
     </div>}
   </article>)}
   {editor&&<div className="school-assessment-editor">
     <div className="school-assessments__heading"><strong>{editing?'Изменить контрольную':'Новая контрольная'}</strong><button type="button" className="btn btn--ghost" onClick={()=>setEditor(false)}>Закрыть</button></div>
     <div className="school-assessment-editor__grid">
       <label>Ученик<select className="select" disabled={!!editing} value={draft.studentId} onChange={e=>setDraft({...draft,studentId:e.target.value})}>
         {students.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}
       </select></label>
       <label>Дата<input className="input" type="date" value={draft.examDate} onChange={e=>setDraft({...draft,examDate:e.target.value})}/></label>
       <label>Тип<select className="select" value={draft.kind} onChange={e=>setDraft({...draft,kind:e.target.value as SchoolAssessmentKind})}>
         {Object.entries(kindNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}
       </select></label>
       <label>Название<input className="input" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/></label>
     </div>
     <label>Темы (по одной в строке)<textarea className="input" rows={3} value={topics} onChange={e=>setTopics(e.target.value)}/></label>
     <label>Примечание<textarea className="input" rows={2} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
     <label>Источник<select className="select" value={draft.sourceType} onChange={e=>setDraft({...draft,sourceType:e.target.value as SchoolAssessmentDraft['sourceType'],confirmationStatus:'REPORTED'})}>
       <option value="TEACHER_NOTE">Преподаватель</option><option value="STUDENT_REPORTED">Ученик</option><option value="VOICE_NOTE">Голосовая заметка</option>
       <option value="TRANSCRIPT">Транскрипция урока</option><option value="SCHOOL_DOCUMENT">Документ школы</option>
     </select></label>
     {(draft.sourceType==='TRANSCRIPT'||draft.sourceType==='SCHOOL_DOCUMENT')&&<>
       <label>ID урока / источник<input className="input" value={draft.sourceRef??''} onChange={e=>setDraft({...draft,sourceRef:e.target.value})}/></label>
       <label>Цитата из источника<textarea className="input" rows={2} value={draft.sourceExcerpt??''} onChange={e=>setDraft({...draft,sourceExcerpt:e.target.value})}/></label>
     </>}
     {draft.sourceType==='SCHOOL_DOCUMENT'&&<label><input type="checkbox" checked={draft.confirmationStatus==='SCHOOL_CONFIRMED'} onChange={e=>setDraft({...draft,confirmationStatus:e.target.checked?'SCHOOL_CONFIRMED':'REPORTED'})}/> Подтверждено школой</label>}
     {error&&<p role="alert" className="banner banner--error">{error}</p>}
     <button type="button" className="btn" disabled={busy} onClick={()=>void save()}>{busy?'Сохраняем…':'Сохранить в календаре'}</button>
   </div>}
 </section>;
}
