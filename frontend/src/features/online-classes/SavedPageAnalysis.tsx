import { useEffect, useState } from 'react';
import { kolinApi, type KolinPageAnalysisResult } from '../../api/kolin';
import { KolinRichText } from './KolinRichText';
import './kolin-panel.css';

export function SavedPageAnalysis({ classId, studentId, pageNumber, boardId, de, enabled, inline = false }: {
  classId: string; studentId?: string; pageNumber?: number; boardId?: string; de: boolean; enabled: boolean; inline?: boolean;
}) {
  const scope = JSON.stringify([classId, studentId, boardId]);
  const [stored, setStored] = useState<{ scope: string; results?: KolinPageAnalysisResult[]; failed?: boolean }>();
  const current = stored?.scope === scope ? stored : undefined;
  useEffect(() => {
    if (!enabled || !studentId || !pageNumber) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const rows = await kolinApi.savedPageAnalyses(classId, studentId!);
        if (!stopped) setStored({ scope, results: rows.filter(row => row.studentId === studentId && (!boardId || row.boardId === boardId)) });
      } catch {
        if (!stopped) setStored({ scope, failed: true });
      } finally {
        if (!stopped) timer = setTimeout(() => { void poll(); }, 3000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [classId, studentId, boardId, scope, enabled, Boolean(pageNumber)]);
  if (!enabled || !studentId || !pageNumber) return null;
  const row = current?.results?.find(result => result.pageNumber === pageNumber);
  const status = current?.failed ? (de ? 'Analyse nicht verfügbar' : 'Анализ недоступен') :
    row?.state === 'READY' ? (de ? 'Gespeicherte Prüfung' : 'Сохранённая проверка') :
    row?.state === 'RUNNING' ? (de ? 'Wird geprüft…' : 'Проверяется…') :
    row?.state === 'FAILED' ? (de ? 'Prüfung fehlgeschlagen' : 'Не удалось проверить') :
    de ? 'Warte auf 30 Sekunden Schreibpause' : 'Ожидание 30 секунд бездействия';
  const content = row?.state === 'READY' && row.text
      ? <div className="kolin-saved-page__content"><KolinRichText text={row.text} />
        {row.finishedAt && <small>{new Date(row.finishedAt).toLocaleTimeString(de ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>}</div>
      : <p>{de ? 'Nur Ergebnisse der aktuellen gespeicherten Seite. Fehlende Analyse bedeutet nicht fehlerfrei.'
        : 'После новых записей ученика лист проверяется один раз. До появления результата не считаем задание проверенным.'}</p>;
  if (inline) return <aside className="kolin-saved-page kolin-saved-page--inline" aria-label={de ? 'Seitenprüfung' : 'Проверка листа'}>
    <header><strong>{de ? 'Seitenprüfung' : 'Проверка листа'} · {pageNumber}</strong><span>Kolyn</span></header>
    <div className="kolin-saved-page__status" role="status">{status}</div>
    {content}
  </aside>;
  return <details className="kolin-saved-page">
    <summary>{de ? 'Seite' : 'Лист'} {pageNumber} · <span role="status">{status}</span></summary>
    {content}
  </details>;
}
