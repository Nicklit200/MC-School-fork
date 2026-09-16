import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { parentChatApi, type ParentTeacherMessage } from '../api/parent';

type Props = {
  studentId: string;
  studentName: string;
  language: 'RU' | 'DE';
  viewerRole: 'PARENT' | 'TEACHER';
};

export function ParentTeacherChat({ studentId, studentName, language, viewerRole }: Props) {
  const [messages, setMessages] = useState<ParentTeacherMessage[]>([]);
  const [text, setText] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const imageUrlsRef = useRef<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const syncImages = useCallback(async (items: ParentTeacherMessage[]) => {
    const wanted = items.filter((item) => item.hasImage && !imageUrlsRef.current[item.id]);
    if (wanted.length === 0) return;
    const created: Record<string, string> = {};
    await Promise.all(wanted.map(async (item) => {
      try {
        const blob = await parentChatApi.image(item.id);
        created[item.id] = URL.createObjectURL(blob);
      } catch {
        // A broken attachment should not hide the rest of the conversation.
      }
    }));
    if (Object.keys(created).length === 0) return;
    imageUrlsRef.current = { ...imageUrlsRef.current, ...created };
    setImageUrls({ ...imageUrlsRef.current });
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const items = await parentChatApi.list(studentId);
      setMessages(items);
      await syncImages(items);
      setError(null);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [studentId, syncImages]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => () => {
    Object.values(imageUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length, loading]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending || (!text.trim() && !image)) return;
    setSending(true);
    setError(null);
    try {
      await parentChatApi.send(studentId, text, image);
      setText('');
      setImage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load(true);
      window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 20);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel stack" style={{ margin: 0, padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <strong>{language === 'DE' ? `Chat zu ${studentName}` : `Чат по ученику ${studentName}`}</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
            {language === 'DE' ? 'Nachrichten zwischen Eltern und Lehrkraft' : 'Сообщения родителя и учителя'}
          </div>
        </div>
        <button type="button" className="btn btn--ghost" onClick={() => void load()} disabled={loading}>
          {language === 'DE' ? 'Aktualisieren' : 'Обновить'}
        </button>
      </div>

      {error && <div className="banner banner--error">{error}</div>}

      <div
        style={{
          minHeight: 180,
          maxHeight: 420,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 12,
          background: 'var(--surface, #fff)',
          display: 'grid',
          gap: 10,
        }}
      >
        {loading ? (
          <div className="muted" style={{ padding: 20, textAlign: 'center' }}>{language === 'DE' ? 'Laden…' : 'Загрузка…'}</div>
        ) : messages.length === 0 ? (
          <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
            {language === 'DE' ? 'Noch keine Nachrichten.' : 'Сообщений пока нет.'}
          </div>
        ) : messages.map((message) => {
          const own = message.senderRole === viewerRole;
          return (
            <div key={message.id} style={{ display: 'flex', justifyContent: own ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '82%',
                  padding: '10px 12px',
                  borderRadius: 14,
                  border: '1px solid var(--border)',
                  background: own ? 'rgba(37, 99, 235, 0.08)' : 'rgba(15, 23, 42, 0.04)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
                  {message.senderName}
                  <span className="muted" style={{ fontWeight: 400 }}> · {formatTime(message.createdAt, language)}</span>
                </div>
                {message.text && <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</div>}
                {message.hasImage && imageUrls[message.id] && (
                  <a href={imageUrls[message.id]} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: message.text ? 8 : 0 }}>
                    <img
                      src={imageUrls[message.id]}
                      alt={message.imageFilename ?? (language === 'DE' ? 'Anhang' : 'Вложение')}
                      style={{ display: 'block', maxWidth: '100%', maxHeight: 280, borderRadius: 10, objectFit: 'contain' }}
                    />
                  </a>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="stack" onSubmit={send} style={{ gap: 10 }}>
        <textarea
          className="input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={4000}
          rows={3}
          placeholder={language === 'DE' ? 'Nachricht schreiben…' : 'Написать сообщение…'}
          disabled={sending}
          style={{ resize: 'vertical' }}
        />
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn--secondary" style={{ cursor: 'pointer' }}>
            {language === 'DE' ? 'Foto anhängen' : 'Прикрепить фото'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              disabled={sending}
              onChange={(event) => setImage(event.target.files?.[0] ?? null)}
            />
          </label>
          {image && (
            <span className="muted" style={{ fontSize: 13 }}>
              {image.name}
              <button
                type="button"
                className="btn btn--ghost"
                style={{ padding: '2px 7px', marginLeft: 6 }}
                onClick={() => {
                  setImage(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                ×
              </button>
            </span>
          )}
          <button className="btn" type="submit" disabled={sending || (!text.trim() && !image)} style={{ marginLeft: 'auto' }}>
            {sending
              ? (language === 'DE' ? 'Senden…' : 'Отправляем…')
              : (language === 'DE' ? 'Senden' : 'Отправить')}
          </button>
        </div>
      </form>
    </section>
  );
}

function formatTime(value: string, language: 'RU' | 'DE') {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}
