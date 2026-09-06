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

    try {
      window.location.href = PROTOCOL_URL;
    } catch {
      // Mindcrafti lesson start must continue even if Soniox cannot be launched.
    }
  }, true);
})();
