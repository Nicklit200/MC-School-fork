import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type ChatMessage } from '../../api/onlineClasses';

/** A message that is on screen but not yet acknowledged by the server. */
export interface PendingMessage {
  clientMessageId: string;
  body: string;
  failed: boolean;
}

export interface ClassChat {
  messages: ChatMessage[];
  pending: PendingMessage[];
  hasMore: boolean;
  loading: boolean;
  rateLimited: boolean;
  send: (body: string) => Promise<void>;
  retry: (clientMessageId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  /** Merges a message that arrived over the realtime channel. */
  ingest: (message: ChatMessage) => void;
}

function newId(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Chat state: persisted history plus optimistic sends, merged with realtime
 * delivery.
 *
 * <p>The backend is the source of truth. `clientMessageId` is the join key
 * between an optimistic bubble, the realtime copy and the persisted row, so the
 * same message can arrive by three paths and still render once.
 */
export function useClassChat(classId: string | undefined): ClassChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Inserts or replaces by id, keeping the list chronological. */
  const mergeOne = useCallback((incoming: ChatMessage) => {
    setMessages((current) => {
      const existing = current.findIndex((message) => message.id === incoming.id);
      if (existing >= 0) {
        const next = current.slice();
        next[existing] = incoming;
        return next;
      }
      // A message we sent optimistically arrives back over the channel; it is
      // the same message, matched on the client-generated key.
      const byClientId = current.findIndex(
        (message) => message.clientMessageId === incoming.clientMessageId,
      );
      if (byClientId >= 0) {
        const next = current.slice();
        next[byClientId] = incoming;
        return next;
      }
      return [...current, incoming].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    setPending((current) =>
      current.filter((item) => item.clientMessageId !== incoming.clientMessageId),
    );
  }, []);

  useEffect(() => {
    if (!classId) return;
    let active = true;
    setLoading(true);
    onlineClassesApi
      .messageHistory(classId)
      .then((page) => {
        if (!active) return;
        setMessages(page.messages);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [classId]);

  const deliver = useCallback(
    async (clientMessageId: string, body: string) => {
      if (!classId) return;
      try {
        const saved = await onlineClassesApi.sendMessage(classId, clientMessageId, body);
        if (!mounted.current) return;
        mergeOne(saved);
        setRateLimited(false);
      } catch (error) {
        if (!mounted.current) return;
        // 409 here means the rate limit; the message stays retryable rather
        // than being silently dropped.
        if (error instanceof ApiRequestError && error.status === 409) {
          setRateLimited(true);
        }
        setPending((current) =>
          current.map((item) =>
            item.clientMessageId === clientMessageId ? { ...item, failed: true } : item,
          ),
        );
      }
    },
    [classId, mergeOne],
  );

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      const clientMessageId = newId();
      setPending((current) => [...current, { clientMessageId, body: trimmed, failed: false }]);
      await deliver(clientMessageId, trimmed);
    },
    [deliver],
  );

  const retry = useCallback(
    async (clientMessageId: string) => {
      const item = pending.find((entry) => entry.clientMessageId === clientMessageId);
      if (!item) return;
      setPending((current) =>
        current.map((entry) =>
          entry.clientMessageId === clientMessageId ? { ...entry, failed: false } : entry,
        ),
      );
      // Reusing the same key means a retry after an ambiguous failure cannot
      // create a duplicate on the server.
      await deliver(clientMessageId, item.body);
    },
    [deliver, pending],
  );

  const loadOlder = useCallback(async () => {
    if (!classId || !cursor) return;
    try {
      const page = await onlineClassesApi.messageHistory(classId, cursor);
      if (!mounted.current) return;
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...page.messages.filter((message) => !known.has(message.id)), ...current];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      // Leave the existing history in place.
    }
  }, [classId, cursor]);

  const remove = useCallback(
    async (messageId: string) => {
      if (!classId) return;
      try {
        mergeOne(await onlineClassesApi.deleteMessage(classId, messageId));
      } catch {
        // Ignored: the message stays as-is and the server remains authoritative.
      }
    },
    [classId, mergeOne],
  );

  return { messages, pending, hasMore, loading, rateLimited, send, retry, loadOlder, remove, ingest: mergeOne };
}
