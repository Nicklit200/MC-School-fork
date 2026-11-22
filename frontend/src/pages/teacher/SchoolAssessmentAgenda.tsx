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
 const [expanded,setExpanded]=useState<string|null>(null);
 // Fetch immediately so the percentage is visible even while the card is closed.
 // Reload on calendar date/event changes, then revalidate on window focus.
 useEffect(()=>{
   const ids=events.filter(x=>x.examDate===selectedDate).map(x=>x.id);
   let alive=true;
   const refresh=()=>{
     void Promise.all(ids.map(id=>schoolAssessmentsApi.readiness(id)
       .then(data=>{if(alive)setReadinessById(old=>({...old,[id]:data}));})
       .catch(error=>{if(alive)setReadinessErrors(old=>({...old,[id]:error instanceof Error?error.message:String(error)}));})
     ));
   };
   refresh();
   const onFocus=()=>refresh();
   window.addEventListener('focus',onFocus);
   const interval=window.setInterval(()=>{if(!document.hidden)refresh();},60000);
   return ()=>{alive=false;window.removeEventListener('focus',onFocus);window.clearInterval(interval);};
 },[events,selectedDate]);
 function toggle(id:string){setExpanded(old=>old===id?null:id);}
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
   {shown.map(event=>{
     const readiness=readinessById[event.id];
     const overall=readiness?.percent;
     const status=readiness?.status;
     const incomplete=status==='PARTIAL'||status==='NO_VALID_SKILLS'||status==='NOT_LINKED';
     return <article className="school-assessment-card" key={event.id}>
       <button type="button" className="school-assessment-card__trigger" aria-expanded={expanded===event.id}
         onClick={()=>toggle(event.id)}>
         <span className="school-assessment-card__emoji">📝</span>
         <span><strong>{event.studentName}: {event.title}</strong>
           <small>{kindNames[event.kind]} · {event.confirmationStatus==='SCHOOL_CONFIRMED'?'Подтверждено школой':'Со слов ученика, школа не подтверждала'}</small>
         </span>
         <span className={'school-exam-readiness__badge'+(overall===null||overall===undefined?' is-unknown':'')}>
           {overall===null||overall===undefined?'Не оценено':overall+'%'}
           {incomplete&&overall!==null&&overall!==undefined?'*':''}
         </span>
         <span aria-hidden="true">{expanded===event.id?'▴':'▾'}</span>
       </button>
       {expanded===event.id&&<div className="school-assessment-card__details">
         {readinessErrors[event.id]&&!readiness&&<p className="muted">Не удалось загрузить проценты</p>}
         <div className="school-exam-topic-list">
           {event.topics.map(topic=>{
             const value=readiness?.topics?.find(entry=>entry.title===topic)?.percent;
             return <div className="school-exam-topic" key={topic}>
               <span>{topic}</span>
               <strong>{value===null||value===undefined?'Не оценено':value+'%'}</strong>
             </div>;
           })}
           {!event.topics.length&&<div className="school-exam-topic">Темы ещё не указаны</div>}
         </div>
       </div>}
     </article>;
   })}
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
