(() => {
  const OVERLAY_ID = 'mindcrafti-soniox-reminder';
  const CHECK_INTERVAL_MS = 500;
  let shownForCurrentLeave = false;

  const leavePhrases = [
    'you left the meeting',
    "you've left the meeting",
    'you have left the meeting',
    'вы покинули встречу',
    'вы вышли из встречи',
    'вы покинули звонок',
    'du hast die besprechung verlassen',
    'du hast den anruf verlassen',
    'du hast das meeting verlassen',
    'besprechung verlassen',
    'anruf verlassen',
  ];

  const inMeetingPhrases = [
    'leave call',
    'leave meeting',
    'покинуть встречу',
    'выйти из звонка',
    'anruf verlassen',
    'besprechung verlassen',
  ];

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function pageText() {
    return normalize(document.body?.innerText || '');
  }

  function looksLikeLeaveScreen() {
    const text = pageText();
    if (leavePhrases.some((phrase) => text.includes(phrase))) return true;

    if (!/^https:\/\/meet\.google\.com\//.test(location.href)) return false;

    const hasRejoin = Array.from(document.querySelectorAll('button, [role="button"], a')).some((element) => {
      const value = normalize(element.textContent || element.getAttribute('aria-label') || '');
      return value.includes('rejoin')
        || value.includes('join again')
        || value.includes('снова присоединиться')
        || value.includes('присоединиться снова')
        || value.includes('erneut teilnehmen')
        || value.includes('wieder teilnehmen');
    });

    const hasActiveLeaveControl = Array.from(document.querySelectorAll('button, [role="button"]')).some((element) => {
      const value = normalize(element.getAttribute('aria-label') || element.textContent || '');
      return inMeetingPhrases.some((phrase) => value.includes(phrase));
    });

    return hasRejoin && !hasActiveLeaveControl;
  }

  function buildSafeReturnUrl(origin, context) {
    const params = new URLSearchParams();
    if (context?.lessonId) params.set('completedLesson', context.lessonId);
    if (context?.groupId) params.set('groupId', context.groupId);
    if (context?.studentId) params.set('studentId', context.studentId);
    params.set('mindcraftiReturn', 'lesson');
    return `${origin}/?${params.toString()}`;
  }

  async function resolveReturnUrl() {
    try {
      const stored = await chrome.storage.local.get(['mindcraftiActiveLesson', 'mindcraftiReturnOrigin']);
      const context = stored?.mindcraftiActiveLesson;
      const origin = stored?.mindcraftiReturnOrigin;
      if (origin) return buildSafeReturnUrl(origin, context);
      if (context?.returnUrl) {
        try {
          const url = new URL(context.returnUrl);
          return buildSafeReturnUrl(url.origin, context);
        } catch {
          return context.returnUrl;
        }
      }
    } catch {
      // Keep fallback below.
    }
    return null;
  }

  async function returnToMindcrafti(root) {
    const button = root.querySelector('button');
    if (button) {
      button.setAttribute('disabled', 'true');
      button.textContent = 'Переходим в Mindcrafti…';
    }

    const returnUrl = await resolveReturnUrl();
    if (returnUrl) {
      try {
        await chrome.storage.local.remove('mindcraftiActiveLesson');
      } catch {
        // Navigation still continues.
      }
      window.location.assign(returnUrl);
      return;
    }

    if (button) {
      button.removeAttribute('disabled');
      button.textContent = 'Открыть Mindcrafti';
    }
    root.querySelector('[data-mindcrafti-error]')?.remove();
    const error = document.createElement('div');
    error.setAttribute('data-mindcrafti-error', 'true');
    error.textContent = 'Не удалось определить адрес Mindcrafti. Вернись на сайт вручную — урок уже завершён.';
    error.style.cssText = 'font-size:14px;color:#b91c1c;margin-top:12px';
    root.querySelector('div > div')?.append(error);
  }

  function showReminder() {
    if (document.getElementById(OVERLAY_ID)) return;
    shownForCurrentLeave = true;

    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647', 'display:grid', 'place-items:center',
      'background:rgba(15,23,42,.58)', 'padding:24px', 'font-family:Arial,sans-serif'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(560px,calc(100vw - 40px))', 'background:#fff', 'border-radius:24px', 'padding:32px',
      'box-shadow:0 24px 80px rgba(0,0,0,.30)', 'border:3px solid #ff6a00', 'text-align:center', 'color:#111827'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Останови Soniox';
    title.style.cssText = 'font-size:34px;font-weight:900;line-height:1.1;color:#d94f00;margin-bottom:14px';

    const text = document.createElement('div');
    text.textContent = 'Ты вышел из Google Meet. Останови запись Soniox, затем вернись в Mindcrafti и загрузи транскрипцию.';
    text.style.cssText = 'font-size:19px;line-height:1.5;margin-bottom:24px';

    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Soniox остановлен — перейти в Mindcrafti';
    done.style.cssText = [
      'width:100%', 'min-height:54px', 'border:0', 'border-radius:14px', 'background:#ff6a00',
      'color:#fff', 'font-size:17px', 'font-weight:800', 'cursor:pointer'
    ].join(';');
    done.addEventListener('click', () => void returnToMindcrafti(root));

    const hint = document.createElement('div');
    hint.textContent = 'Mindcrafti';
    hint.style.cssText = 'font-size:12px;color:#6b7280;margin-top:12px';

    card.append(title, text, done, hint);
    root.append(card);
    document.documentElement.append(root);
  }

  function check() {
    const isLeaveScreen = looksLikeLeaveScreen();
    if (isLeaveScreen && !shownForCurrentLeave) showReminder();
    if (!isLeaveScreen) {
      shownForCurrentLeave = false;
      document.getElementById(OVERLAY_ID)?.remove();
    }
  }

  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(check, CHECK_INTERVAL_MS);
  check();
})();
