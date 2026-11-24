import { useEffect, useState } from 'react';
import { kolinApi, type KolinPageAnalysisResult } from '../../api/kolin';
import { KolinRichText } from './KolinRichText';
import './kolin-panel.css';

type AnalysisState = { results?: KolinPageAnalysisResult[]; failed?: boolean };

/** One metadata poll per active personal workbook, never one request per page. */
export function useSavedPageAnalyses(classId: string, studentId: string | undefined, boardId: string | undefined, enabled: boolean): AnalysisState | undefined {
  const scope = JSON.stringify([classId, studentId, boardId]);
  const [stored, setStored] = useState<AnalysisState & { scope: string }>();
  useEffect(() => {
    if (!enabled || !studentId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        if (document.visibilityState === 'hidden') return;
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
  }, [classId, studentId, boardId, scope, enabled]);
  return enabled && stored?.scope === scope ? stored : undefined;
}

export function PageAnalysisFeedback({ current, pageNumber, de, inline = false }: {
  current?: AnalysisState; pageNumber: number; de: boolean; inline?: boolean;
}) {
  const row = current?.results?.find(result => result.pageNumber === pageNumber);
  const status = current?.failed ? (de ? 'Analyse nicht verfügbar' : 'Анализ недоступен') :
    row?.state === 'READY' ? (de ? 'Gespeicherte Prüfung' : 'Сохранённая проверка') :
    row?.state === 'RUNNING' ? (de ? 'Wird geprüft…' : 'Проверяется…') :
    row?.state === 'FAILED' ? (de ? 'Prüfung fehlgeschlagen' : 'Не удалось проверить') :
    de ? 'Warte auf 30 Sekunden Schreibpause' : 'Ожидание 30 секунд бездействия';
  const content = row?.state === 'READY' && row.text
      ? <div className="kolin-saved-page__content" tabIndex={inline ? 0 : undefined}><KolinRichText text={row.text} />
        {row.finishedAt && <small>{new Date(row.finishedAt).toLocaleTimeString(de ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>}</div>
      : <p>{de ? 'Nur Ergebnisse der aktuellen gespeicherten Seite. Fehlende Analyse bedeutet nicht fehlerfrei.'
        : 'После новых записей ученика лист проверяется один раз. До появления результата не считаем задание проверенным.'}</p>;
  if (inline) return <aside className="kolin-saved-page kolin-saved-page--inline" data-review-page={pageNumber}
    aria-label={de ? `Seitenprüfung · ${pageNumber}` : `Проверка листа · ${pageNumber}`}>
    <header><strong>{de ? 'Seitenprüfung' : 'Проверка листа'} · {pageNumber}</strong><span>Kolyn</span></header>
    <div className="kolin-saved-page__status" role="status">{status}</div>
    {content}
  </aside>;
  return <details className="kolin-saved-page">
    <summary>{de ? 'Seite' : 'Лист'} {pageNumber} · <span role="status">{status}</span></summary>
    {content}
  </details>;
}

export function SavedPageAnalysis({ classId, studentId, pageNumber, boardId, de, enabled }: {
  classId: string; studentId?: string; pageNumber?: number; boardId?: string; de: boolean; enabled: boolean;
}) {
  const current = useSavedPageAnalyses(classId, studentId, boardId, enabled && Boolean(pageNumber));
  if (!enabled || !studentId || !pageNumber) return null;
  return <PageAnalysisFeedback current={current} pageNumber={pageNumber} de={de} />;
}
