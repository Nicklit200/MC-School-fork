import { useEffect, useRef, useState } from 'react';
import { api, ApiRequestError } from '../../api/client';
import { readStudioLogo, serializeStudioProject, storyStudioApi } from '../../api/storyStudio';
import studioHtml from './mindcrafti-studio.html?raw';

const LEGACY_KEY = 'mindcrafti.admin-studio.project.v1';
const LEGACY_OWNER = `${LEGACY_KEY}.migrated-owner`;
const PREFIX = 'mindcrafti.admin-studio.project.v2:';
type LocalDraft = { projectJson: string; baseVersion: number | null; pending: boolean };

export function AdminMindcraftiStudioPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [saveState, setSaveState] = useState('Ожидаем редактор…');
  const [hydrated, setHydrated] = useState(false);
  const [recovery, setRecovery] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let started = false;
    let canSave = false;
    let inFlight = false;
    let version: number | null = null;
    let lastSynced = '';
    let pending: string | null = null;
    let storageKey: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const logo = readStudioLogo(studioHtml);
    const normalize = (raw: string) => serializeStudioProject(raw, logo);
    const status = (value: string) => { if (active) setSaveState(value); };

    function readStorage(key: string): string | null {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    function keepLocal(projectJson: string, unsynced: boolean): boolean {
      try {
        if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ projectJson, baseVersion: version, pending: unsynced }));
        else localStorage.setItem(LEGACY_KEY, projectJson);
        return true;
      } catch { return false; }
    }
    function keepRecovery(projectJson: string) {
      if (active) setRecovery(projectJson);
      if (storageKey) {
        try { localStorage.setItem(`${storageKey}.recovery`, projectJson); } catch { /* Download remains available. */ }
      }
    }

    async function flush() {
      if (!active || !canSave || version === null || inFlight || pending === null) return;
      const sent = pending;
      pending = null;
      if (sent === lastSynced) { keepLocal(sent, false); return; }
      inFlight = true;
      status('Сохраняем проект на сервере…');
      try {
        const result = await storyStudioApi.save(version, sent);
        if (!active) return;
        version = result.version;
        lastSynced = sent;
        if (pending !== null) keepLocal(pending, true);
        else keepLocal(sent, false);
        status('Сохранено на сервере. Проект доступен коннектору.');
      } catch (error) {
        if (!active) return;
        canSave = false;
        const unsaved = pending ?? sent;
        pending = unsaved;
        keepLocal(unsaved, true);
        keepRecovery(unsaved);
        status(error instanceof ApiRequestError && error.status === 409
          ? 'На сервере есть новая версия. Ваш черновик сохранён отдельно; обновите страницу.'
          : 'Серверное сохранение недоступно. Черновик сохранён локально; обновите страницу для повтора.');
      } finally {
        inFlight = false;
        if (active && canSave && pending !== null) timer = setTimeout(() => { void flush(); }, 600);
      }
    }

    async function initialize() {
      let local: LocalDraft | null = null;
      let chosen: string | null = null;
      let recovered = false;
      status('Загружаем проект с сервера…');
      try {
        const user = await api.auth.me();
        if (!active) return;
        storageKey = `${PREFIX}${user.id}`;
        const previousRecovery = readStorage(`${storageKey}.recovery`);
        if (previousRecovery) setRecovery(previousRecovery);
        const own = readStorage(storageKey);
        if (own) {
          try {
            const parsed = JSON.parse(own) as LocalDraft;
            local = { ...parsed, projectJson: normalize(parsed.projectJson) };
          } catch { /* Keep a malformed local document untouched. */ }
        } else {
          const claimedBy = readStorage(LEGACY_OWNER);
          const legacy = (!claimedBy || claimedBy === user.id) ? readStorage(LEGACY_KEY) : null;
          if (legacy) {
            try {
              local = { projectJson: normalize(legacy), baseVersion: 0, pending: true };
              localStorage.setItem(LEGACY_OWNER, user.id);
            } catch { /* Legacy file is not removed or overwritten. */ }
          }
        }
        chosen = local?.projectJson ?? null;
        const cloud = await storyStudioApi.get();
        if (!active) return;
        version = cloud.version;
        if (cloud.configured && cloud.projectJson) {
          lastSynced = normalize(cloud.projectJson);
          if (local?.pending && local.baseVersion === version) chosen = local.projectJson;
          else {
            if (local && local.projectJson !== lastSynced) { keepRecovery(local.projectJson); recovered = true; }
            chosen = lastSynced;
          }
        }
        canSave = true;
        status(recovered
          ? 'Загружена серверная версия. Отличающийся локальный черновик сохранён в резервной копии.'
          : cloud.configured ? 'Проект загружен с сервера' : 'Переносим текущий проект на сервер…');
      } catch {
        if (!active) return;
        canSave = false;
        if (!chosen && !storageKey) {
          const legacy = readStorage(LEGACY_KEY);
          if (legacy) { try { chosen = normalize(legacy); } catch { /* No replacement of invalid drafts. */ } }
        }
        status('Сервер недоступен. Редактор работает локально; коннектор пока не получит изменения.');
      }
      if (!active) return;
      setHydrated(true);
      frame.current?.contentWindow?.postMessage({ type: 'mindcrafti-studio:hydrate', payload: chosen }, '*');
    }

    function handleMessage(event: MessageEvent) {
      // The sandbox has an opaque origin. Authenticate the exact iframe window, never arbitrary messages.
      if (!active || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'mindcrafti-studio:ready' && !started) {
        started = true;
        void initialize();
      }
      if (event.data.type === 'mindcrafti-studio:save' && typeof event.data.payload === 'string') {
        try {
          const value = normalize(event.data.payload);
          const localOk = keepLocal(value, value !== lastSynced);
          if (value === lastSynced) return;
          pending = value;
          if (!canSave) {
            keepRecovery(value);
            status(localOk ? 'Черновик сохранён локально. Обновите страницу для синхронизации.' : 'Память браузера заполнена: скачайте резервную копию.');
            return;
          }
          clearTimeout(timer);
          timer = setTimeout(() => { void flush(); }, 800);
        } catch {
          status('Проект не сохранён: проверьте формат и размер данных.');
        }
      }
    }
    window.addEventListener('message', handleMessage);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('message', handleMessage); };
  }, []);

  function downloadRecovery() {
    if (!recovery) return;
    const url = URL.createObjectURL(new Blob([recovery], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mindcrafti-story-local-recovery.json';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="stories-workspace">
      <iframe ref={frame} title="Mindcrafti Stories Studio" srcDoc={studioHtml}
        sandbox="allow-scripts allow-downloads" style={{ visibility: hydrated ? 'visible' : 'hidden' }} />
      <div className="stories-workspace__status">
        <span role="status">{saveState}</span>
        {recovery && <button type="button" onClick={downloadRecovery}>Скачать резервный черновик</button>}
        <span>Проект синхронизируется с вашим аккаунтом. Сохранение не публикует сторис в Instagram.</span>
      </div>
    </div>
  );
}
