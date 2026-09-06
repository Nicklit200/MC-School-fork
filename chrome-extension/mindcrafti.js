(() => {
  const START_LABELS = ['начать урок', 'unterricht starten'];
  const PROTOCOL_URL = 'mindcrafti-soniox://open';

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  async function rememberReturnOrigin() {
    try {
      await chrome.storage.local.set({ mindcraftiReturnOrigin: window.location.origin });
    } catch {
      // The lesson flow must continue even if extension storage is unavailable.
    }
  }

  void rememberReturnOrigin();

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button, a') : null;
    if (!target) return;

    const label = normalize(target.textContent || target.getAttribute('aria-label') || '');
    if (!START_LABELS.some((value) => label.includes(value))) return;

    const lessonId = target.getAttribute('data-mindcrafti-lesson-id') || '';
    const groupId = target.getAttribute('data-mindcrafti-group-id') || '';
    const studentId = target.getAttribute('data-mindcrafti-student-id') || '';
    const params = new URLSearchParams();
    if (lessonId) params.set('completedLesson', lessonId);
    if (groupId) params.set('groupId', groupId);
    if (studentId) params.set('studentId', studentId);
    params.set('fromMeet', '1');

    const returnUrl = `${window.location.origin}/teacher/lessons?${params.toString()}`;

    void (async () => {
      try {
        await chrome.storage.local.set({
          mindcraftiReturnOrigin: window.location.origin,
          mindcraftiActiveLesson: {
            lessonId,
            groupId,
            studentId,
            returnUrl,
            startedAt: Date.now(),
          },
        });
      } catch {
        // Returning to Mindcrafti is an enhancement; lesson start must still continue.
      }

      // Only launch Soniox after the return context has definitely been stored.
      try {
        window.location.href = PROTOCOL_URL;
      } catch {
        // Mindcrafti lesson start must continue even if Soniox cannot be launched.
      }
    })();
  }, true);
})();
