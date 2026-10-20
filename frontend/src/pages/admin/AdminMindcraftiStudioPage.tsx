import { useEffect, useRef, useState } from 'react';
import studioHtml from './mindcrafti-studio.html?raw';

const STORAGE_KEY = 'mindcrafti.admin-studio.project.v1';

export function AdminMindcraftiStudioPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [saveState, setSaveState] = useState('Ожидаем редактор…');

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'mindcrafti-studio:ready') {
        const saved = localStorage.getItem(STORAGE_KEY);
        frame.current?.contentWindow?.postMessage({ type: 'mindcrafti-studio:hydrate', payload: saved }, '*');
        setSaveState(saved ? 'Проект восстановлен' : 'Редактор готов');
      }
      if (event.data.type === 'mindcrafti-studio:save' && typeof event.data.payload === 'string') {
        try {
          localStorage.setItem(STORAGE_KEY, event.data.payload);
          setSaveState('Автосохранение в этом браузере');
        } catch {
          setSaveState('Память браузера заполнена: скачайте проект JSON');
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'min(84vh, 980px)', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Mindcrafti Studio</h1>
          <p className="muted" style={{ margin: '5px 0 0' }}>Создавайте Stories: цвета, фото, текст, HTML, CSS и экспорт PNG.</p>
        </div>
        <span className="muted" role="status">{saveState}</span>
      </div>
      <iframe
        ref={frame}
        title="Mindcrafti Stories Studio"
        srcDoc={studioHtml}
        sandbox="allow-scripts allow-same-origin allow-downloads"
        style={{ border: '1px solid #e7e9f0', borderRadius: 14, background: '#fff', flex: 1, minHeight: 730, width: '100%' }}
      />
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Проекты сохраняются в этом браузере. Для переноса между устройствами используйте кнопку «Проект JSON» внутри Studio.
        Загрузка фотографий и публикация в Instagram не запускаются автоматически.
      </p>
    </div>
  );
}
