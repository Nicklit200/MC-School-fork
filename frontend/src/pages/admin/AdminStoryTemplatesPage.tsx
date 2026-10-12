import { useEffect, useState } from 'react';
import { storyTemplatesApi, type StoryTemplateInfo } from '../../api/storyTemplates';

export function AdminStoryTemplatesPage() {
  const [info, setInfo] = useState<StoryTemplateInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    storyTemplatesApi.get().then(setInfo).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : 'Не удалось получить шаблон'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!file) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await storyTemplatesApi.upload(file);
      setInfo(next);
      setFile(null);
      setNotice('Новый мастер-шаблон сохранён. ChatGPT получит его через Mindcrafti-коннектор.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки шаблона');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="panel">Загружаем шаблоны Stories...</div>;

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <div>
        <h1 style={{ marginBottom: 8 }}>Шаблоны Instagram Stories</h1>
        <p className="muted" style={{ marginTop: 0 }}>Единственный утверждённый PPTX для всех трёх Stories Mindcrafti. Доступен только администратору.</p>
      </div>
      {error && <div className="banner banner--error">{error}</div>}
      {notice && <div className="banner banner--success">{notice}</div>}
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Главный мастер-файл</h2>
        <div><strong>Состояние:</strong> {info?.configured ? 'Загружен' : 'Ещё не загружен'}</div>
        {info?.configured && <>
          <div><strong>Файл:</strong> {info.filename}</div>
          <div><strong>Версия:</strong> {info.version}</div>
          <div><strong>Размер:</strong> {Math.round(info.sizeBytes / 1024)} КБ</div>
          <div><strong>SHA-256:</strong> <code style={{ overflowWrap: 'anywhere' }}>{info.sha256}</code></div>
          {info.updatedAt && <div className="muted">Обновлён: {new Date(info.updatedAt).toLocaleString('ru-RU')}</div>}
          <button className="btn btn--secondary" type="button" style={{ alignSelf: 'flex-start' }}
            onClick={() => void storyTemplatesApi.download().catch((e: unknown) =>
              setError(e instanceof Error ? e.message : 'Не удалось скачать PPTX'))}>
            Скачать текущий мастер
          </button>
        </>}
        <div className="muted">PPTX должен содержать ровно 3 редактируемых слайда. Первая Story с утверждённым фото, вторая с выводами, третья с советами. Фон, фото, логотип и декоративные элементы не меняются.</div>
        <label htmlFor="story-master-file"><strong>{info?.configured ? 'Заменить мастер-файл' : 'Загрузить мастер-файл'}</strong></label>
        <input id="story-master-file" className="input" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setNotice(''); }} />
        <button className="btn" type="button" disabled={saving || !file} onClick={() => void save()} style={{ alignSelf: 'flex-start' }}>
          {saving ? 'Сохраняем...' : 'Утвердить новый мастер'}
        </button>
        {info?.configured && <div className="muted">Замена обновляет мастер для всех будущих генераций. Сохрани предыдущий PPTX локально перед заменой, если нужна резервная копия.</div>}
      </div>
      <div className="panel stack">
        <h2 style={{ margin: 0 }}>Фиксированные параметры</h2>
        <div>Instagram Stories: 1080 x 1920 px, формат 9:16.</div>
        <div>Безопасная зона: 125 px сверху и снизу, 65 px слева и справа.</div>
        <div>Никаких длинных тире. Никакой кнопки пробного урока. Не менять фотографию, логотип или оформление.</div>
        <p className="muted" style={{ marginBottom: 0 }}>Через коннектор ChatGPT читает текущую версию и скачивает исходный PPTX по частям. Поэтому предыдущие копии из диалогов больше не должны использоваться как мастер.</p>
      </div>
    </div>
  );
}
