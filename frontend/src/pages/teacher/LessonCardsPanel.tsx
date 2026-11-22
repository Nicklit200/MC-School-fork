import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { GroupLesson, ParsedCard } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { TeacherIcon } from '../../components/TeacherIcon';

export function LessonCardsPanel({ lesson }: { lesson: GroupLesson | null }) {
  const { language } = useI18n(); const de = language === 'DE';
  const dialog = useRef<HTMLDialogElement>(null);
  const [date, setDate] = useState('');
  const [rows, setRows] = useState([{ question: '', answer: '' }]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (!lesson) return; const dateKey = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(lesson.startsAt)); const next=new Date(dateKey+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);setDate(next.toISOString().slice(0,10));setRows([{question:'',answer:''}]);setSummary('');setError('');dialog.current?.close(); },[lesson?.eventId]);
  useEffect(()=>{if(!lesson || !date)return;let cancelled=false;void (async()=>{let id=lesson.studentId;if(!id && lesson.groupId)id=(await api.groups.get(lesson.groupId)).students[0]?.id ?? null;if(!id)return;const homeworks=await api.homeworks.listForStudent(id);const matching=homeworks.filter(h=>h.startDate===date && h.totalCards>0);const cards=(await Promise.all(matching.map(h=>api.cards.listForHomework(h.id)))).flat();if(!cancelled)setSummary(cards.map(c=>c.question).join('\n'));})().catch(()=>{});return()=>{cancelled=true;};},[lesson?.eventId,date]);
  async function assign(event: FormEvent) {
    event.preventDefault(); if(!lesson || busy)return;setBusy(true);setError('');
    const cards:ParsedCard[]=rows.map(row=>({question:row.question.trim(),correctAnswer:row.answer.trim(),wrongAnswer1:'',wrongAnswer2:'',wrongAnswer3:'',timeLimitSeconds:null}));
    try {
      if(lesson.groupId)await api.groups.importCards(lesson.groupId,date,cards);
      else if(lesson.studentId){const batches=await api.homeworks.listForStudent(lesson.studentId);const batch=batches.find(h=>h.startDate===date) ?? await api.homeworks.create(lesson.studentId,date);await api.cards.importConfirmInHomework(batch.id,cards);}
      else throw new Error(de?'Bitte zuerst einen Schüler oder eine Gruppe zuordnen.':'Сначала привяжите к уроку ученика или группу.');
      setSummary(current=>[current,...cards.map(c=>c.question)].filter(Boolean).join('\n'));setRows([{question:'',answer:''}]);dialog.current?.close();
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  }
  const assignedQuestions = summary.split('\n').map(question => question.trim()).filter(Boolean);
  return <section className="panel workspace-card workspace-cards-card">
    <div className="workspace-card-heading"><span><TeacherIcon name="skills"/></span><h2>{de ? 'Karten' : 'Карточки'}</h2></div>
    <div className="workspace-cards-topline">
      <div className="workspace-cards-count" aria-live="polite">
        <strong>{assignedQuestions.length}</strong>
        <span>{de ? 'Karten zugewiesen' : 'карточек задано'}</span>
      </div>
      <button className="btn btn--secondary" type="button" disabled={!lesson} onClick={()=>dialog.current?.showModal()}>{de?'Karten aufgeben':'Задать карточки'}</button>
    </div>
    {assignedQuestions.length > 0 ? <details className="workspace-cards-details">
      <summary>{de ? 'Fragen anzeigen' : 'Посмотреть задания'}</summary>
      <ol>{assignedQuestions.map((question, index) => <li key={index}>{question}</li>)}</ol>
    </details> : <p className="muted workspace-cards-empty">{de ? 'Noch keine Karten zugewiesen.' : 'Карточек пока нет.'}</p>}
    <dialog ref={dialog} className="workspace-homework-dialog" onCancel={e=>{if(busy)e.preventDefault();}}><div className="workspace-dialog-heading"><h2>{de?'Karten aufgeben':'Задать карточки'}</h2><button type="button" className="teacher-icon-button" disabled={busy} aria-label={de?'Schließen':'Закрыть'} onClick={()=>dialog.current?.close()}>×</button></div><form onSubmit={event=>void assign(event)}><fieldset disabled={busy} className="workspace-card-fields"><label className="field"><span>{de?'Datum':'Дата карточек'}</span><input className="input" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>{rows.map((row,i)=><div className="workspace-card-editor" key={i}><label className="field"><span>{de?'Frage':'Вопрос'} {i+1}</span><textarea className="input" required value={row.question} onChange={e=>setRows(current=>current.map((r,j)=>i===j?{...r,question:e.target.value}:r))}/></label><label className="field"><span>{de?'Antwort':'Правильный ответ'}</span><textarea className="input" required value={row.answer} onChange={e=>setRows(current=>current.map((r,j)=>i===j?{...r,answer:e.target.value}:r))}/></label>{rows.length>1 && <button type="button" className="btn btn--ghost" onClick={()=>setRows(current=>current.filter((_,j)=>i!==j))}>{de?'Entfernen':'Убрать'}</button>}</div>)}<div className="workspace-actions"><button type="button" className="btn btn--secondary" onClick={()=>setRows(current=>[...current,{question:'',answer:''}])}>{de?'+ Karte':'+ Ещё карточка'}</button><button type="submit" className="btn">{busy?(de?'Speichern…':'Сохраняем…'):(de?'Karten aufgeben':'Задать карточки')}</button></div></fieldset>{error && <p role="alert" className="banner banner--error">{error}</p>}</form></dialog></section>;
}
