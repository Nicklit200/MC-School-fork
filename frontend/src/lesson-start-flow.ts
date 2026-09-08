import { api } from './api/client';

const STARTED_LESSON_KEY = 'mindcrafti.startedGroupLesson';
const STARTED_LESSON_AT_KEY = 'mindcrafti.startedGroupLessonOpenedAt';
const SONIOX_NOTIFICATION_PREFIX = 'mindcrafti.sonioxStopNotification.';
const DETAIL_START_ATTRIBUTE = 'data-mindcrafti-detail-start';

let installed = false;
let activeModal: HTMLElement | null = null;

export function installLessonStartFlow() {
  if (installed) return;
  installed = true;

  document.addEventListener('click', handleDocumentClick, true);
  window.addEventListener('popstate', scheduleEnhance);
  window.addEventListener('pageshow', scheduleEnhance);
  window.addEventListener('focus', scheduleEnhance);

  scheduleEnhance();
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const meetAnchor = target?.closest<HTMLAnchorElement>('a[href*="meet.google.com"]');

  if (meetAnchor && isLessonDetailPath()) {
    event.preventDefault();
    event.stopPropagation();
    const meetUrl = meetAnchor.href;
    if (!meetUrl) return;

    // Notification setup may require network access. Do not make the lesson
    // button feel frozen while that happens.
    void prepareBrowserNotifications();
    showSonioxReminder(meetUrl);
    return;
  }

  // React Router changes the URL without a full page load. Re-check shortly
  // after ordinary clicks. No MutationObserver is used, so this cannot loop.
  scheduleEnhance();
}

function scheduleEnhance() {
  const enhance = () => {
    enhanceLessonDetailButton();
    hidePreparationButtons();
  };
  window.setTimeout(enhance, 0);
  window.setTimeout(enhance, 150);
  window.setTimeout(enhance, 600);
  window.setTimeout(enhance, 1400);
}

function hidePreparationButtons() {
  if (!window.location.pathname.startsWith('/teacher/lessons')) return;
  const buttons = document.querySelectorAll<HTMLButtonElement>('.teacher-lessons-page button.btn--secondary');
  buttons.forEach((button) => {
    const label = button.textContent?.trim() ?? '';
    if (label === 'Подготовка' || label === 'Vorbereitung' || label === 'Скрыть детали' || label === 'Details schließen') {
      button.style.display = 'none';
    }
  });
}

function enhanceLessonDetailButton() {
  if (!isLessonDetailPath()) return;

  const meetAnchor = document.querySelector<HTMLAnchorElement>('a.btn[href*="meet.google.com"]');
  if (!meetAnchor) return;

  const language = currentLanguage();
  const label = language === 'DE' ? 'Unterricht starten' : 'Начать урок';
  if (meetAnchor.textContent?.trim() !== label) meetAnchor.textContent = label;
  meetAnchor.setAttribute(DETAIL_START_ATTRIBUTE, '1');
  meetAnchor.removeAttribute('target');
  meetAnchor.setAttribute('role', 'button');
}

function showSonioxReminder(meetUrl: string) {
  activeModal?.remove();
  const language = currentLanguage();
  const title = document.querySelector('h1')?.textContent?.trim() || (language === 'DE' ? 'Unterricht' : 'Урок');

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:grid;place-items:center;padding:20px;';

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.style.cssText = 'width:min(560px,100%);padding:28px;text-align:center;box-shadow:0 24px 70px rgba(15,23,42,.28);';

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:28px;font-weight:900;margin-bottom:10px;';
  heading.textContent = language === 'DE' ? 'Soniox einschalten' : 'Включи Soniox';

  const description = document.createElement('div');
  description.style.cssText = 'font-size:17px;line-height:1.5;margin-bottom:20px;';
  description.textContent = language === 'DE'
    ? 'Starte jetzt die Soniox-Aufnahme. Erst danach öffnen wir Google Meet.'
    : 'Сначала запусти запись Soniox. Только после этого открывай Google Meet.';

  const lessonTitle = document.createElement('div');
  lessonTitle.style.cssText = 'font-weight:800;margin-bottom:18px;';
  lessonTitle.textContent = title;

  const actions = document.createElement('div');
  actions.className = 'stack';
  actions.style.gap = '10px';

  const startButton = document.createElement('button');
  startButton.className = 'btn';
  startButton.type = 'button';
  startButton.style.cssText = 'width:100%;min-height:52px;font-size:16px;';
  startButton.textContent = language === 'DE' ? 'Soniox läuft — Google Meet öffnen' : 'Soniox включён — открыть Google Meet';
  startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    try {
      await openMeetAfterSoniox(meetUrl);
      closeModal();
    } finally {
      startButton.disabled = false;
    }
  });

  const cancelButton = document.createElement('button');
  cancelButton.className = 'btn btn--ghost';
  cancelButton.type = 'button';
  cancelButton.style.width = '100%';
  cancelButton.textContent = language === 'DE' ? 'Abbrechen' : 'Отмена';
  cancelButton.addEventListener('click', closeModal);

  actions.append(startButton, cancelButton);
  panel.append(heading, description, lessonTitle, actions);
  overlay.appendChild(panel);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  activeModal = overlay;
}

async function openMeetAfterSoniox(meetUrl: string) {
  // Open the tab synchronously from the user's click so popup blockers do not
  // discard it while we refresh the Meet event subscription.
  const tab = window.open('about:blank', '_blank');
  if (tab) tab.opener = null;

  try {
    await api.lessons.ensureGoogleMeetEvents();
  } catch {
    // The lesson should still start even if the Meet event subscription cannot be refreshed.
  }

  const lessonId = currentLessonEventId();
  const openedAt = Date.now();
  if (lessonId) {
    localStorage.setItem(STARTED_LESSON_KEY, lessonId);
    localStorage.setItem(STARTED_LESSON_AT_KEY, String(openedAt));
    localStorage.removeItem(`${SONIOX_NOTIFICATION_PREFIX}${lessonId}`);
  }

  if (tab) tab.location.href = meetUrl;
  else window.location.href = meetUrl;
}

function closeModal() {
  activeModal?.remove();
  activeModal = null;
}

function currentLessonEventId() {
  const match = window.location.pathname.match(/^\/teacher\/lessons\/(.+)$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function isLessonDetailPath() {
  return /^\/teacher\/lessons\/[^/]+$/.test(window.location.pathname);
}

function currentLanguage(): 'DE' | 'RU' {
  return localStorage.getItem('language') === 'DE' ? 'DE' : 'RU';
}

async function prepareBrowserNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const config = await api.push.config();
    if (!config.enabled || !config.publicKey) return;
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return;
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(config.publicKey),
      });
    }
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;
    await api.push.subscribe({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
  } catch {
    // Lesson flow continues without web push.
  }
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const bytes = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) bytes[i] = rawData.charCodeAt(i);
  return bytes.buffer;
}
