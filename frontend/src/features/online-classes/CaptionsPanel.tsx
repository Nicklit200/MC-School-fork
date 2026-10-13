import { useTranscriptions } from '@livekit/components-react';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18nContext';

/** Only the most recent lines are kept on screen; the transcript is durable. */
const VISIBLE_LINES = 4;

/**
 * Live captions.
 *
 * <p>Renders the interim stream that LiveKit delivers in-room. Nothing here is
 * persisted — final segments are written by the transcription worker straight to
 * the backend, so captions dropping out never loses transcript content.
 *
 * <p>Must be rendered inside {@code LiveKitRoom}: `useTranscriptions` needs the
 * room context.
 */
export function CaptionsPanel({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const transcriptions = useTranscriptions();
  const regionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const region = regionRef.current;
    if (region) region.scrollTop = region.scrollHeight;
  }, [transcriptions]);

  if (!enabled) return null;

  const recent = transcriptions.slice(-VISIBLE_LINES);

  return (
    <section className="captions" aria-labelledby="captions-title">
      <h3 id="captions-title" className="visually-hidden">
        {t('onlineClass.captions')}
      </h3>

      {/*
        Captions are an accessibility feature in their own right, so the region
        is polite rather than assertive: it must not interrupt a screen reader
        mid-sentence on every partial update.
      */}
      <div ref={regionRef} role="log" aria-live="polite" aria-atomic="false" className="captions__lines">
        {recent.length === 0 ? (
          <p className="captions__waiting">{t('onlineClass.captions.waiting')}</p>
        ) : (
          recent.map((entry) => (
            <p key={entry.streamInfo.id} className="captions__line">
              {/* Rendered as text: caption content is never treated as markup. */}
              <span className="captions__text">{entry.text}</span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}
