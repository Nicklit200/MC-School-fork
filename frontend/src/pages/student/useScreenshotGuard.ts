import { useEffect, useState } from 'react';
import type { DOMAttributes } from 'react';

type GuardProps = Pick<DOMAttributes<HTMLElement>, 'onContextMenu' | 'onCopy' | 'onCut' | 'onDragStart'>;

/**
 * Best-effort screenshot deterrence for the study screen.
 *
 * IMPORTANT: a browser cannot truly block screenshots — no web API exists for it
 * (only native mobile apps can, via FLAG_SECURE on Android / secure-view on iOS).
 * This hook therefore raises the effort/limits cheating rather than making capture
 * impossible:
 *  - `blurred` turns true whenever the tab/window loses focus or is hidden, which is
 *    exactly when the OS takes app-switcher/snapshot thumbnails — the caller blurs the
 *    content so those snapshots don't reveal the question;
 *  - PrintScreen (and Cmd/Ctrl+Shift+P) briefly blur and attempt to clear the clipboard;
 *  - `guardProps` disable the context menu, copy/cut and drag on the guarded element.
 * A per-student watermark (rendered by the caller) makes any leaked capture traceable.
 */
export function useScreenshotGuard(): { blurred: boolean; guardProps: GuardProps } {
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    const hide = () => setBlurred(true);
    const show = () => setBlurred(false);
    const onVisibility = () => setBlurred(document.hidden);
    const onKey = (event: KeyboardEvent) => {
      const captureChord =
        event.key === 'PrintScreen' ||
        (event.key.toLowerCase() === 'p' && (event.metaKey || event.ctrlKey) && event.shiftKey);
      if (captureChord) {
        setBlurred(true);
        navigator.clipboard?.writeText('').catch(() => {});
        window.setTimeout(() => setBlurred(false), 1200);
      }
    };

    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const prevent = (event: { preventDefault: () => void }) => event.preventDefault();

  return {
    blurred,
    guardProps: {
      onContextMenu: prevent,
      onCopy: prevent,
      onCut: prevent,
      onDragStart: prevent,
    },
  };
}
