(() => {
  const START_LABELS = ['начать урок', 'unterricht starten'];
  const PROTOCOL_URL = 'mindcrafti-soniox://open';

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button, a') : null;
    if (!target) return;

    const label = normalize(target.textContent || target.getAttribute('aria-label') || '');
    if (!START_LABELS.some((value) => label.includes(value))) return;

    const lessonId = target.getAttribute('data-mindcrafti-lesson-id') || '';
    const groupId = target.getAttribute('data-mindcrafti-group-id') || '';
    const params = new URLSearchParams();
    if (lessonId) params.set('completedLesson', lessonId);
    if (groupId) params.set('groupId', groupId);
    params.set('fromMeet', '1');

    const returnUrl = `${window.location.origin}/teacher/lessons?${params.toString()}`;
    try {
      chrome.storage.local.set({
        mindcraftiActiveLesson: {
          lessonId,
          groupId,
          returnUrl,
          startedAt: Date.now(),
        },
      });
    } catch {
      // Returning to Mindcrafti is an enhancement; lesson start must still continue.
    }

    try {
      window.location.href = PROTOCOL_URL;
    } catch {
      // Mindcrafti lesson start must continue even if Soniox cannot be launched.
    }
  }, true);
})();
