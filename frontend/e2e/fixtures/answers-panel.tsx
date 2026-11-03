// Development-only fixture: real answers panel/resizer and production classroom
// CSS. No signaling, camera, microphone, provider or backend is involved.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { AnswersPanel } from '../../src/features/online-classes/AnswersPanel';
import { AnswersPanelResizer } from '../../src/features/online-classes/AnswersPanelResizer';
import type { AnswersView } from '../../src/features/online-classes/useAnswersPanel';
import '../../src/index.css';
import '../../src/online-classes.css';
import '../../src/styles/whiteboard-original-v3.css';

const teacherId = '33333333-3333-4333-8333-333333333333';
localStorage.setItem('language', 'RU');

function Fixture() {
  const [open, setOpen] = useState(false);
  const [videosOpen, setVideosOpen] = useState(false);
  const [view, setView] = useState<AnswersView>({ page: 0, zoom: 1, scrollTop: 0, scrollLeft: 0 });
  return <div className="online-class-room lk-room-container online-class-room--original-v3" data-lk-theme="default">
    <header className="online-class-room__topbar">
      <strong>Пробный урок без ученика</strong>
      <button type="button" onClick={() => setOpen(value => !value)}>Ответы</button>
      <button type="button" className="online-class-room__videos-toggle" onClick={() => setVideosOpen(value => !value)}>Видео</button>
    </header>
    <div className="online-class-room__stage">
      {open && <>
        <AnswersPanel pdf={{ status: 'idle' }} view={view} getView={() => view}
          onViewChange={patch => setView(previous => ({ ...previous, ...patch }))}
          onScroll={(scrollTop, scrollLeft) => setView(previous => ({ ...previous, scrollTop, scrollLeft }))}
          onClose={() => setOpen(false)} onUpload={() => {}} />
        <AnswersPanelResizer storageKey={teacherId} videosOpen={videosOpen} />
      </>}
      <main className="online-class-room__main" style={{ background: '#eaf1f7' }}>
        <div className="online-class-room__board" />
      </main>
      <div id="online-class-videos" className={`online-class-room__videos-drawer${videosOpen ? ' is-open' : ''}`} aria-hidden={!videosOpen}>
        <ul className="camera-column">
          <li className="camera-card" data-host="true" data-camera="off">
            <div className="camera-card__avatar">BT</div>
            <div className="camera-card__bar"><span className="camera-card__name">Browser Teacher</span></div>
          </li>
        </ul>
      </div>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider><Fixture /></I18nProvider>,
);
