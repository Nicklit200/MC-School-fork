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
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function pageText() {
    return normalize(document.body?.innerText || '');
  }

  function looksLikeLeaveScreen() {
    const text = pageText();
    if (leavePhrases.some((phrase) => text.includes(phrase))) return true;

    const url = location.href;
    const likelyMeetPage = /^https:\/\/meet\.google\.com\//.test(url);
    if (!likelyMeetPage) return false;

    const hasRejoin = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .some((element) => {
        const value = normalize(element.textContent || element.getAttribute('aria-label') || '');
        return value.includes('rejoin')
          || value.includes('join again')
          || value.includes('снова присоединиться')
          || value.includes('присоединиться снова')
          || value.includes('erneut teilnehmen')
          || value.includes('wieder teilnehmen');
      });

    const hasActiveLeaveControl = Array.from(document.querySelectorAll('button, [role="button"]'))
      .some((element) => {
        const value = normalize(element.getAttribute('aria-label') || element.textContent || '');
        return inMeetingPhrases.some((phrase) => value.includes(phrase));
      });

    return hasRejoin && !hasActiveLeaveControl;
  }

  async function returnToMindcrafti(root) {
    root.querySelector('button')?.setAttribute('disabled', 'true');
    try {
      const stored = await chrome.storage.local.get('mindcraftiActiveLesson');
      const context = stored?.mindcraftiActiveLesson;
      if (context?.returnUrl) {
        await chrome.storage.local.remove('mindcraftiActiveLesson');
        window.location.href = context.returnUrl;
        return;
      }
    } catch {
      // Fall through and simply close the reminder.
    }
    root.remove();
  }

  function showReminder() {
    if (document.getElementById(OVERLAY_ID)) return;
    shownForCurrentLeave = true;

    const root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'display:grid',
      'place-items:center',
      'background:rgba(15,23,42,.58)',
      'padding:24px',
      'font-family:Arial,sans-serif'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'width:min(560px,calc(100vw - 40px))',
      'background:#fff',
      'border-radius:24px',
      'padding:32px',
      'box-shadow:0 24px 80px rgba(0,0,0,.30)',
      'border:3px solid #ff6a00',
      'text-align:center',
      'color:#111827'
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
      'width:100%',
      'min-height:54px',
      'border:0',
      'border-radius:14px',
      'background:#ff6a00',
      'color:#fff',
      'font-size:17px',
      'font-weight:800',
      'cursor:pointer'
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
