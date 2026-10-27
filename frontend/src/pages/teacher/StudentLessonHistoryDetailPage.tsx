import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { StudentLessonHistoryDetail } from '../../api/types';
import { toErrorMessage } from '../../lib/errors';

export function StudentLessonHistoryDetailPage() {
  const { studentId='', sourceTeacherId='', eventId='' } = useParams();
  const [detail,setDetail]=useState<StudentLessonHistoryDetail|null>(null);
  const [files,setFiles]=useState<Record<string,string>>({});
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{let cancelled=false;const urls:string[]=[];(async()=>{try{
    const d=await api.students.lessonHistoryDetail(studentId,sourceTeacherId,eventId);if(cancelled)return;setDetail(d);
    const kinds:Array<'workbook'|'answers'|'transcript'>=[];if(d.hasWorkbook)kinds.push('workbook');if(d.hasAnswers)kinds.push('answers');if(d.hasTranscript&&d.transcriptFilename)kinds.push('transcript');
    const entries=await Promise.all(kinds.map(async k=>{const blob=await api.students.lessonHistoryFile(studentId,sourceTeacherId,eventId,k);const url=URL.createObjectURL(blob);urls.push(url);return [k,url] as const;}));if(!cancelled)setFiles(Object.fromEntries(entries));
  }catch(e){if(!cancelled)setError(toErrorMessage(e));}})();return()=>{cancelled=true;urls.forEach(URL.revokeObjectURL);};},[studentId,sourceTeacherId,eventId]);
  return <div><p><Link className="muted" to={`/students/${studentId}/lessons`}>← Назад к истории уроков</Link></p>{error&&<div className="banner banner--error">{error}</div>}{detail&&<><h1>{detail.title}</h1><p className="muted">{new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeZone:'Europe/Berlin'}).format(new Date(detail.startsAt))} · {detail.sourceTeacherName}</p><div className="banner banner--info">Исторический урок. Просмотр без редактирования.</div><section className="panel stack"><h2>Содержание урока</h2><HistoryText title="Пройденный материал" value={detail.coveredMaterial}/><HistoryText title="План урока" value={detail.lessonPlan}/><HistoryText title="Трудности ученика" value={detail.difficulties}/><HistoryText title="Домашнее задание и заметки" value={detail.homeworkNotes}/></section><section className="panel stack" style={{marginTop:16}}><h2>Материалы</h2>{files.workbook&&<p><a href={files.workbook} target="_blank" rel="noreferrer">Рабочий лист: {detail.workbookFilename??'PDF'}</a></p>}{files.answers&&<p><a href={files.answers} target="_blank" rel="noreferrer">Ответы: {detail.answersFilename??'PDF'}</a></p>}{files.transcript&&<p><a href={files.transcript} target="_blank" rel="noreferrer">Транскрипция: {detail.transcriptFilename??'PDF'}</a></p>}{detail.transcriptText&&<HistoryText title="Текст транскрипции" value={detail.transcriptText}/>}</section></>}</div>;
}
function HistoryText({title,value}:{title:string;value:string|null}){return value?<div><h3>{title}</h3><div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{value}</div></div>:null;}
