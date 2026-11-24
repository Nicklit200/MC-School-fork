import { useEffect, useState } from 'react';
import { kolinApi, type KolinPageAnalysisResult } from '../../api/kolin';
import { KolinRichText } from './KolinRichText';
import { automaticPageAnalysisEnabled } from './useAutomaticPageAnalysis';

export function SavedPageAnalysis({ classId, studentId, pageNumber, de }: {
  classId: string; studentId?: string; pageNumber?: number; de: boolean;
}) {
  const scope = JSON.stringify([classId, studentId, pageNumber]);
  const [stored, setStored] = useState<{ scope: string; result?: KolinPageAnalysisResult; failed?: boolean }>();
  const current = stored?.scope === scope ? stored : undefined;
  useEffect(() => {
    if (!automaticPageAnalysisEnabled || !studentId || !pageNumber) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const rows = await kolinApi.savedPageAnalyses(classId, studentId!);
        if (!stopped) setStored({ scope, result: rows.find(row =>
          row.studentId === studentId && row.pageNumber === pageNumber) });
      } catch {
        if (!stopped) setStored({ scope, failed: true });
      } finally {
        if (!stopped) timer = setTimeout(() => { void poll(); }, 5000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [classId, studentId, pageNumber, scope]);
  if (!automaticPageAnalysisEnabled || !studentId || !pageNumber) return null;
  const row = current?.result;
  const status = current?.failed ? (de ? 'Analyse nicht verfügbar' : 'Анализ недоступен') :
    row?.state === 'READY' ? (de ? 'Gespeicherte Prüfung' : 'Сохранённая проверка') :
    row?.state === 'RUNNING' ? (de ? 'Wird geprüft…' : 'Проверяется…') :
    row?.state === 'FAILED' ? (de ? 'Prüfung fehlgeschlagen' : 'Не удалось проверить') :
    de ? 'Noch keine aktuelle Prüfung' : 'Актуальной проверки пока нет';
  return <details className="kolin-saved-page">
    <summary>{de ? 'Seite' : 'Лист'} {pageNumber} · <span role="status">{status}</span></summary>
    {row?.state === 'READY' && row.text
      ? <div className="kolin-saved-page__content"><KolinRichText text={row.text} />
        {row.finishedAt && <small>{new Date(row.finishedAt).toLocaleTimeString(de ? 'de-DE' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</small>}</div>
      : <p>{de ? 'Nur Ergebnisse der aktuellen gespeicherten Seite. Fehlende Analyse bedeutet nicht fehlerfrei.'
        : 'Показываются только результаты актуальной версии листа. Отсутствие проверки не означает отсутствие ошибок.'}</p>}
  </details>;
}
