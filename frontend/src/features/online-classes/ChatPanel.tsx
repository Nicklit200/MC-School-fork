import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import { useClassChat } from './useClassChat';

/**
 * Class chat.
 *
 * <p>Bodies are rendered as text nodes by React, never as HTML — there is no
 * `dangerouslySetInnerHTML` anywhere in this component, which is what keeps a
 * message containing markup inert.
 */
export function ChatPanel({
  classId,
  currentUserId,
  isHost,
}: {
  classId: string;
  currentUserId: string;
  isHost: boolean;
}) {
  const { t, language } = useI18n();
  const chat = useClassChat(classId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLUListElement | null>(null);

  // Keep the newest message in view, but only when already near the bottom, so
  // reading history is not interrupted by an arrival.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [chat.messages, chat.pending]);

  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const body = draft;
    setDraft('');
    void chat.send(body);
  };

  return (
    <section className="chat" aria-labelledby="chat-title">
      <h3 id="chat-title">{t('onlineClass.chat')}</h3>

      {chat.hasMore && (
        <button type="button" onClick={() => void chat.loadOlder()}>
          {t('onlineClass.chat.loadOlder')}
        </button>
      )}

      <ul className="chat__messages" ref={listRef}>
        {chat.messages.length === 0 && chat.pending.length === 0 && !chat.loading && (
          <li className="chat__empty">{t('onlineClass.chat.empty')}</li>
        )}

        {chat.messages.map((message) => (
          <li
            key={message.id}
            className={message.messageType === 'SYSTEM' ? 'chat__message chat__message--system' : 'chat__message'}
          >
            <span className="chat__sender">{message.senderName}</span>
            <time dateTime={message.createdAt}>{time(message.createdAt)}</time>{' '}
            {message.deleted ? (
              <em className="chat__deleted">{t('onlineClass.chat.deleted')}</em>
            ) : (
              <span className="chat__body">{message.body}</span>
            )}
            {message.editedAt && !message.deleted && (
              <span className="chat__edited"> ({t('onlineClass.chat.edited')})</span>
            )}
            {!message.deleted &&
              message.messageType === 'USER' &&
              (isHost || message.senderId === currentUserId) && (
                <button
                  type="button"
                  onClick={() => void chat.remove(message.id)}
                  aria-label={`${t('onlineClass.chat.deleteAction')}: ${message.senderName}`}
                >
                  ×
                </button>
              )}
          </li>
        ))}

        {chat.pending.map((item) => (
          <li key={item.clientMessageId} className="chat__message chat__message--pending">
            <span className="chat__body">{item.body}</span>
            {item.failed ? (
              <button type="button" onClick={() => void chat.retry(item.clientMessageId)}>
                {t('onlineClass.chat.failed')}
              </button>
            ) : (
              <span className="chat__status">{t('onlineClass.chat.sending')}</span>
            )}
          </li>
        ))}
      </ul>

      <div role="status" aria-live="polite">
        {chat.rateLimited && <p className="chat__error">{t('onlineClass.chat.tooFast')}</p>}
      </div>

      <form onSubmit={submit} className="chat__composer">
        <label htmlFor="chat-input" className="visually-hidden">
          {t('onlineClass.chat.placeholder')}
        </label>
        <input
          id="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('onlineClass.chat.placeholder')}
          maxLength={2000}
          autoComplete="off"
        />
        <button type="submit" disabled={draft.trim().length === 0}>
          {t('onlineClass.chat.send')}
        </button>
      </form>
    </section>
  );
}
