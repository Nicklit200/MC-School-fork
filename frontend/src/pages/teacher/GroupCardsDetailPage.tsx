import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Card, Homework, StudentGroup } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type GroupCard = {
  key: string;
  question: string;
  correctAnswer: string;
  copies: Card[];
};

export function GroupCardsDetailPage() {
  const { groupId = '', startDate = '' } = useParams();
  const { language, t } = useI18n();
  const [group, setGroup] = useState<StudentGroup | null>(null);
  const [cards, setCards] = useState<GroupCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const currentGroup = await api.groups.get(groupId);
    setGroup(currentGroup);

    const allCards: Card[] = [];
    for (const student of currentGroup.students) {
      const homeworks = await api.homeworks.listForStudent(student.id);
      const cardHomeworks = homeworks.filter((homework: Homework) => homework.startDate === startDate && homework.totalCards > 0);
      for (const homework of cardHomeworks) {
        allCards.push(...await api.cards.listForHomework(homework.id));
      }
    }

    const byContent = new Map<string, GroupCard>();
    for (const card of allCards) {
      const key = `${card.question}\u0000${card.correctAnswer}`;
      const existing = byContent.get(key);
      if (existing) {
        existing.copies.push(card);
      } else {
        byContent.set(key, {
          key,
          question: card.question,
          correctAnswer: card.correctAnswer,
          copies: [card],
        });
      }
    }
    setCards(Array.from(byContent.values()));
    setLoading(false);
  }, [groupId, startDate]);

  useEffect(() => {
    reload().catch((e) => {
      setError(toErrorMessage(e, t));
      setLoading(false);
    });
  }, [reload, t]);

  const memberCount = group?.students.length ?? 0;
  const totalCopies = useMemo(() => cards.reduce((sum, card) => sum + card.copies.length, 0), [cards]);

  function startEdit(card: GroupCard) {
    setEditingKey(card.key);
    setQuestion(card.question);
    setAnswer(card.correctAnswer);
    setMessage(null);
    setError(null);
  }

  async function saveEdit(card: GroupCard) {
    const nextQuestion = question.trim();
    const nextAnswer = answer.trim();
    if (!nextQuestion || !nextAnswer || saving) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(card.copies.map((copy) => api.cards.update(copy.id, nextQuestion, nextAnswer)));
      setEditingKey(null);
      setMessage(language === 'DE' ? 'Karte für die ganze Gruppe aktualisiert.' : 'Карточка обновлена у всей группы.');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  }

  async function deleteCard(card: GroupCard) {
    const text = language === 'DE'
      ? `Diese Karte bei allen Schülern der Gruppe löschen?\n\n${card.question}`
      : `Удалить эту карточку у всех учеников группы?\n\n${card.question}`;
    if (!window.confirm(text)) return;
    setError(null);
    setMessage(null);
    try {
      await Promise.all(card.copies.map((copy) => api.cards.remove(copy.id)));
      setMessage(language === 'DE' ? 'Karte bei der ganzen Gruppe gelöscht.' : 'Карточка удалена у всей группы.');
      await reload();
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      <p><Link to={`/groups/${groupId}`} className="muted">← {language === 'DE' ? 'Zurück zur Gruppe' : 'Назад к группе'}</Link></p>
      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <h1>{language === 'DE' ? 'Karten der Gruppe' : 'Карточки группы'}</h1>
      <p className="muted">
        {group?.name ?? ''}{group ? ' · ' : ''}{formatDate(startDate, language)}
        {memberCount > 0 ? ` · ${memberCount} ${language === 'DE' ? 'Schüler' : 'уч.'}` : ''}
      </p>

      {loading ? (
        <p className="muted">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <div className="teacher-empty-state">{language === 'DE' ? 'Keine Karten gefunden.' : 'Карточек в этом наборе нет.'}</div>
      ) : (
        <>
          <div className="panel row center" style={{ flexWrap: 'wrap', gap: 28, marginBottom: 18 }}>
            <SummaryStat label={language === 'DE' ? 'Karten' : 'Карточек'} value={cards.length} />
            <SummaryStat label={language === 'DE' ? 'Kopien bei Schülern' : 'Копий у учеников'} value={totalCopies} />
          </div>

          <h2>{language === 'DE' ? 'Karten' : 'Карточки'}</h2>
          <div className="stack">
            {cards.map((card) => (
              <div key={card.key} className="panel" style={{ padding: 18 }}>
                {editingKey === card.key ? (
                  <div className="stack">
                    <label className="field">
                      <span className="field__label">{language === 'DE' ? 'Frage' : 'Вопрос'}</span>
                      <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} />
                    </label>
                    <label className="field">
                      <span className="field__label">{language === 'DE' ? 'Richtige Antwort' : 'Правильный ответ'}</span>
                      <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} />
                    </label>
                    <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                      <button className="btn" type="button" disabled={saving || !question.trim() || !answer.trim()} onClick={() => void saveEdit(card)}>
                        {saving ? (language === 'DE' ? 'Speichern…' : 'Сохраняем…') : (language === 'DE' ? 'Speichern' : 'Сохранить')}
                      </button>
                      <button className="btn btn--secondary" type="button" disabled={saving} onClick={() => setEditingKey(null)}>
                        {language === 'DE' ? 'Abbrechen' : 'Отмена'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 240, flex: '1 1 520px' }}>
                      <div style={{ fontWeight: 700, fontSize: 17 }}>{card.question}</div>
                      <div className="muted" style={{ marginTop: 4 }}>{card.correctAnswer}</div>
                    </div>
                    <div className="row" style={{ gap: 16, alignItems: 'center' }}>
                      <span className="badge">{language === 'DE' ? 'Aktiv' : 'Активна'}</span>
                      <button type="button" className="btn btn--ghost" onClick={() => startEdit(card)}>{language === 'DE' ? 'Bearbeiten' : 'Редактировать'}</button>
                      <button type="button" className="btn btn--ghost" style={{ color: '#dc2626' }} onClick={() => void deleteCard(card)}>{language === 'DE' ? 'Löschen' : 'Удалить'}</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return <div><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div><div className="muted" style={{ fontSize: 13 }}>{label}</div></div>;
}

function formatDate(date: string, language: 'DE' | 'RU') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}
