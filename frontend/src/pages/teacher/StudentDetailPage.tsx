import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, CardSummary, ReviewSessionHistory } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { CardCreator } from './CardCreator';
import { CardRow } from './CardRow';

const MIN_CARDS_TO_START = 4;

export function StudentDetailPage() {
  const { studentId = '' } = useParams();
  const { t } = useI18n();
  const [cards, setCards] = useState<Card[]>([]);
  const [summary, setSummary] = useState<CardSummary | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ReviewSessionHistory[]>([]);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [cardList, cardSummary, history] = await Promise.all([
      api.cards.listForStudent(studentId),
      api.cards.summaryForStudent(studentId),
      api.students.reviewHistory(studentId),
    ]);
    setCards(cardList);
    setSummary(cardSummary);
    setReviewHistory(history);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    reload().catch((e) => setError(toErrorMessage(e, t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  function downloadTable(session: ReviewSessionHistory) {
    const rows = [
      ['Вопрос', 'Ответ ученика', 'Правильный ответ', 'Результат'],
      ...session.answers.map((answer) => [
        answer.question,
        answer.selectedAnswer ?? 'Ответ не сохранён',
        answer.correctAnswer,
        answer.correct ? 'Правильно' : 'Неправильно',
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `повторение-${formatFileDate(session.completedAt)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <p>
        <Link to="/students" className="muted">← {t('common.back')}</Link>
      </p>
      <h1>{t('cards.title')}</h1>
      {error && <div className="banner banner--error">{error}</div>}

      {summary && (
        <>
          <div className="panel row center">
            <SummaryStat label={t('cards.summary.total')} value={summary.total} />
            <SummaryStat label={t('cards.summary.dueNow')} value={summary.dueNow} />
            <SummaryStat label={t('cards.summary.awaiting')} value={summary.awaitingRepetition} />
            <SummaryStat label={t('cards.summary.learned')} value={summary.learned} />
          </div>
          {summary.total < MIN_CARDS_TO_START && (
            <div className="banner banner--info">{t('cards.tooFew', { min: MIN_CARDS_TO_START })}</div>
          )}
        </>
      )}

      <h2>История повторений</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : reviewHistory.length === 0 ? (
        <p className="muted">Повторений пока нет</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {reviewHistory.map((session) => {
            const isOpen = openSessionId === session.sessionId;
            return (
              <div key={session.sessionId} className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setOpenSessionId(isOpen ? null : session.sessionId)}
                  style={{
                    width: '100%',
                    border: 0,
                    background: 'transparent',
                    padding: '16px 18px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 1fr',
                    gap: 16,
                    alignItems: 'center',
                    color: 'inherit',
                    font: 'inherit',
                  }}
                >
                  <strong>{formatDisplayDate(session.completedAt)}</strong>
                  <span>Правильных ответов: {session.correctAnswers}</span>
                  <span>Неправильных ответов: {session.wrongAnswers}</span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid rgba(128,128,128,.25)', padding: 18 }}>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 18,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
                        <span>Всего карточек: {session.totalCards}</span>
                        <span>Правильных ответов: {session.correctAnswers}</span>
                        <span>Неправильных ответов: {session.wrongAnswers}</span>
                      </div>
                      <button type="button" className="btn" onClick={() => downloadTable(session)}>
                        Скачать таблицу
                      </button>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                        <thead>
                          <tr>
                            <TableHeader>Вопрос</TableHeader>
                            <TableHeader>Ответ ученика</TableHeader>
                            <TableHeader>Правильный ответ</TableHeader>
                            <TableHeader>Результат</TableHeader>
                          </tr>
                        </thead>
                        <tbody>
                          {session.answers.map((answer) => (
                            <tr key={answer.cardId}>
                              <TableCell>{answer.question}</TableCell>
                              <TableCell>{answer.selectedAnswer ?? 'Ответ не сохранён'}</TableCell>
                              <TableCell>{answer.correctAnswer}</TableCell>
                              <TableCell>{answer.correct ? 'Правильно' : 'Неправильно'}</TableCell>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2>{t('cards.add')}</h2>
      <CardCreator studentId={studentId} onChanged={reload} />

      <h2>{t('cards.title')}</h2>
      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <p className="muted">{t('cards.empty')}</p>
      ) : (
        cards.map((card) => <CardRow key={card.id} card={card} onChanged={reload} />)
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

function TableHeader({ children }: { children: string }) {
  return (
    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(128,128,128,.3)' }}>
      {children}
    </th>
  );
}

function TableCell({ children }: { children: string }) {
  return (
    <td style={{ padding: '10px 12px', borderBottom: '1px solid rgba(128,128,128,.18)', verticalAlign: 'top' }}>
      {children}
    </td>
  );
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatDisplayDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(value));
}

function formatFileDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}
