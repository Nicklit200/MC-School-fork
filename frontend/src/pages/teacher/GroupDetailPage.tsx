import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { ImportPreview, StudentGroup } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';

type CardTab = 'manual' | 'import';

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { t } = useI18n();
  const [group, setGroup] = useState<StudentGroup | null>(null);
  const [memberEmails, setMemberEmails] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [cardTab, setCardTab] = useState<CardTab>('manual');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    api.groups.get(groupId)
      .then(setGroup)
      .catch((e) => setError(toErrorMessage(e, t)));
  }, [groupId, t]);

  if (!groupId) {
    return <div className="banner banner--error">Группа не найдена</div>;
  }

  async function addMembers(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const emails = memberEmails
      .split(/[\n,;]+/)
      .map((email) => email.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    try {
      const updated = await api.groups.addMembers(groupId!, emails);
      setGroup(updated);
      setMemberEmails('');
      setMessage(`Добавлено учеников: ${updated.students.length}.`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function createCard(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const count = await api.groups.createCard(groupId!, startDate, question.trim(), answer.trim());
      setQuestion('');
      setAnswer('');
      setMessage(`Карточка создана для ${count} учеников.`);
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function makePreview(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    try {
      setPreview(await api.cards.importPreview(rawText, '->', '\n'));
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  async function importCards() {
    if (!preview || preview.cards.length === 0) return;
    setError(null);
    setMessage(null);
    try {
      const created = await api.groups.importCards(groupId!, startDate, preview.cards);
      const studentCount = group?.students.length ?? 0;
      setMessage(`Готово: ${preview.cards.length} карточек выдано ${studentCount} ученикам (${created} индивидуальных карточек).`);
      setPreview(null);
      setRawText('');
    } catch (e) {
      setError(toErrorMessage(e, t));
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{group?.name ?? 'Группа'}</h1>
          <div className="muted">Одинаковые карточки выдаются всем, но прогресс считается отдельно для каждого ученика.</div>
        </div>
        <Link className="btn btn--secondary" to="/groups">Назад к группам</Link>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {message && <div className="banner banner--success">{message}</div>}

      <div className="panel">
        <h2>Добавить учеников</h2>
        <form onSubmit={addMembers}>
          <label className="field">
            <span className="field__label">Email учеников</span>
            <textarea
              className="textarea"
              value={memberEmails}
              onChange={(e) => setMemberEmails(e.target.value)}
              placeholder={'student1@example.com\nstudent2@example.com'}
              required
            />
          </label>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Можно вставить несколько email через новую строку, запятую или точку с запятой.
          </div>
          <button className="btn" type="submit">Добавить в группу</button>
        </form>
      </div>

      <div className="panel">
        <h2>Ученики группы</h2>
        {!group ? (
          <p className="muted">{t('common.loading')}</p>
        ) : group.students.length === 0 ? (
          <p className="muted">В группе пока нет учеников</p>
        ) : (
          group.students.map((student) => (
            <div className="list-row" key={student.id}>
              <div>
                <div className="list-row__title">{student.fullName}</div>
                <div className="muted">{student.email}</div>
              </div>
              <Link className="btn btn--secondary" to={`/students/${student.id}`}>Ошибки и карточки</Link>
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h2>Выдать карточки всей группе</h2>
        <label className="field">
          <span className="field__label">Дата начала</span>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>

        <div className="row" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`btn ${cardTab === 'manual' ? '' : 'btn--ghost'}`}
            onClick={() => setCardTab('manual')}
          >
            Вручную
          </button>
          <button
            type="button"
            className={`btn ${cardTab === 'import' ? '' : 'btn--ghost'}`}
            onClick={() => setCardTab('import')}
          >
            Импорт
          </button>
        </div>

        {cardTab === 'manual' ? (
          <form onSubmit={createCard}>
            <label className="field">
              <span className="field__label">Вопрос</span>
              <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} required />
            </label>
            <label className="field">
              <span className="field__label">Правильный ответ</span>
              <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
            </label>
            <button className="btn" type="submit" disabled={!group || group.students.length === 0}>Добавить всей группе</button>
          </form>
        ) : (
          <div>
            <form onSubmit={makePreview}>
              <label className="field">
                <span className="field__label">Текст для импорта</span>
                <textarea
                  className="textarea"
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={'2 + 2 -> 4 | 3 | 5 | 6\n3 + 3 -> 6 | 5 | 7 | 9'}
                  required
                />
              </label>
              <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                Формат такой же, как у отдельного ученика: вопрос -&gt; правильный ответ | неверный 1 | неверный 2 | неверный 3
              </div>
              <button className="btn btn--secondary" type="submit">Предпросмотр</button>
            </form>

            {preview && (
              <div style={{ marginTop: 16 }}>
                <h3>Карточек: {preview.cards.length}</h3>
                {preview.cards.map((card, index) => (
                  <div className="list-row" key={index}>
                    <div>
                      <div className="list-row__title">{card.question}</div>
                      <div className="muted">Ответ: {card.correctAnswer}</div>
                      <div className="muted">Неверные: {card.wrongAnswer1} · {card.wrongAnswer2} · {card.wrongAnswer3}</div>
                    </div>
                  </div>
                ))}
                {preview.warnings.length > 0 && (
                  <div className="banner banner--info">
                    <strong>Предупреждения:</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                    </ul>
                  </div>
                )}
                <button
                  className="btn"
                  type="button"
                  onClick={importCards}
                  disabled={!group || group.students.length === 0 || preview.cards.length === 0}
                >
                  Выдать {preview.cards.length} карточек всей группе
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
