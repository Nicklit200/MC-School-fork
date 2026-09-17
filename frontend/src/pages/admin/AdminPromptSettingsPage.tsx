import { useEffect, useState } from 'react';
import { promptSettingsApi } from '../../api/promptSettings';

export function AdminPromptSettingsPage() {
  const [groupPrompt, setGroupPrompt] = useState('');
  const [individualPrompt, setIndividualPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    promptSettingsApi.get()
      .then((settings) => {
        setGroupPrompt(settings.groupLessonPrompt);
        setIndividualPrompt(settings.individualLessonPrompt);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить промты'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const settings = await promptSettingsApi.update(groupPrompt, individualPrompt);
      setGroupPrompt(settings.groupLessonPrompt);
      setIndividualPrompt(settings.individualLessonPrompt);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить промты');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="panel">Загружаем настройки…</div>;

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div>
        <h1 style={{ marginBottom: 8 }}>Промты школы</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Эти инструкции задаёт администратор. Учителя могут использовать актуальные версии в ChatGPT, но не могут их изменять.
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {saved && <div className="banner banner--success">Промты сохранены. Новая версия сразу доступна учителям.</div>}

      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Групповые уроки</h2>
          <p className="muted">Главный промт для подготовки материалов, домашней работы и работы с группой.</p>
        </div>
        <textarea
          className="input"
          value={groupPrompt}
          maxLength={30000}
          onChange={(event) => { setGroupPrompt(event.target.value); setSaved(false); }}
          placeholder="Вставьте промт для групповых уроков…"
          style={{ minHeight: 280, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{groupPrompt.length.toLocaleString()} / 30 000 символов</div>
      </div>

      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Индивидуальные уроки</h2>
          <p className="muted">Главный промт для подготовки индивидуального занятия и домашней работы конкретного ученика.</p>
        </div>
        <textarea
          className="input"
          value={individualPrompt}
          maxLength={30000}
          onChange={(event) => { setIndividualPrompt(event.target.value); setSaved(false); }}
          placeholder="Вставьте промт для индивидуальных уроков…"
          style={{ minHeight: 280, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{individualPrompt.length.toLocaleString()} / 30 000 символов</div>
      </div>

      <button className="btn" type="button" disabled={saving} onClick={() => void save()} style={{ alignSelf: 'flex-start' }}>
        {saving ? 'Сохраняем…' : 'Сохранить промты'}
      </button>
    </div>
  );
}
