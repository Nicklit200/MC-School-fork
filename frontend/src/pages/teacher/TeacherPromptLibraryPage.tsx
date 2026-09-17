import { useEffect, useState } from 'react';
import { promptSettingsApi, type SchoolPromptSettings } from '../../api/promptSettings';

export function TeacherPromptLibraryPage() {
  const [settings, setSettings] = useState<SchoolPromptSettings | null>(null);
  const [copied, setCopied] = useState<'group' | 'individual' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    promptSettingsApi.get()
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить промты'));
  }, []);

  async function copy(kind: 'group' | 'individual', text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div>
        <h1 style={{ marginBottom: 8 }}>Промты школы</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Используйте эти инструкции в рабочем чате ChatGPT. Их обновляет администратор школы.
        </p>
      </div>
      {error && <div className="banner banner--error">{error}</div>}
      {!settings && !error && <div className="panel">Загружаем промты…</div>}
      {settings && (
        <>
          <PromptCard
            title="Групповой урок"
            text={settings.groupLessonPrompt}
            copied={copied === 'group'}
            onCopy={() => void copy('group', settings.groupLessonPrompt)}
          />
          <PromptCard
            title="Индивидуальный урок"
            text={settings.individualLessonPrompt}
            copied={copied === 'individual'}
            onCopy={() => void copy('individual', settings.individualLessonPrompt)}
          />
        </>
      )}
    </div>
  );
}

function PromptCard({ title, text, copied, onCopy }: { title: string; text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="panel stack">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button className="btn btn--secondary" type="button" disabled={!text} onClick={onCopy}>
          {copied ? 'Скопировано' : 'Скопировать в чат'}
        </button>
      </div>
      {text ? (
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55, padding: 16, border: '1px solid #e1e5ec', borderRadius: 12, maxHeight: 420, overflow: 'auto' }}>
          {text}
        </div>
      ) : (
        <div className="muted">Администратор ещё не добавил этот промт.</div>
      )}
    </div>
  );
}
