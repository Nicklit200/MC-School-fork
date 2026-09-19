import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi, type ChatMessage } from '../../api/onlineClasses';
import { useClassChat } from './useClassChat';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>(
    '../../api/onlineClasses',
  );
  return {
    ...actual,
    onlineClassesApi: {
      messageHistory: vi.fn(),
      sendMessage: vi.fn(),
      deleteMessage: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'server-1',
    clientMessageId: 'client-1',
    senderId: 'student-1',
    senderName: 'Student',
    body: 'hello',
    messageType: 'USER',
    createdAt: '2026-09-18T10:00:00.000Z',
    editedAt: null,
    deleted: false,
    ...overrides,
  };
}

describe('useClassChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.messageHistory.mockResolvedValue({ messages: [], nextCursor: null, hasMore: false });
  });

  it('loads history on mount', async () => {
    api.messageHistory.mockResolvedValue({
      messages: [message({ id: 'a', body: 'first' })],
      nextCursor: null,
      hasMore: false,
    });

    const { result } = renderHook(() => useClassChat('class-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.messages).toHaveLength(1);
  });

  it('shows a message optimistically and replaces it once saved', async () => {
    api.sendMessage.mockImplementation(async (_classId, clientMessageId, body) =>
      message({ id: 'server-9', clientMessageId, body }),
    );
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send('hi there');
    });

    expect(result.current.pending).toHaveLength(0);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].body).toBe('hi there');
  });

  it('does not render a message twice when the realtime copy also arrives', async () => {
    api.sendMessage.mockImplementation(async (_classId, clientMessageId, body) =>
      message({ id: 'server-9', clientMessageId, body }),
    );
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send('hi there');
    });
    const saved = result.current.messages[0];

    // The same message arriving over the data channel must merge, not duplicate.
    act(() => {
      result.current.ingest(saved);
    });

    expect(result.current.messages).toHaveLength(1);
  });

  it('merges a realtime message matched only by clientMessageId', async () => {
    api.sendMessage.mockImplementation(async (_classId, clientMessageId, body) =>
      message({ id: 'server-9', clientMessageId, body }),
    );
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.send('hi there');
    });
    const clientMessageId = result.current.messages[0].clientMessageId;

    // Same logical message, different server id (e.g. a re-read after reconnect).
    act(() => {
      result.current.ingest(message({ id: 'server-different', clientMessageId, body: 'hi there' }));
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('server-different');
  });

  it('keeps a failed send retryable and reuses the same idempotency key', async () => {
    api.sendMessage.mockRejectedValueOnce(new ApiRequestError(500, 'UNKNOWN', 'boom'));
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send('will fail');
    });
    expect(result.current.pending[0].failed).toBe(true);
    const key = result.current.pending[0].clientMessageId;

    api.sendMessage.mockImplementation(async (_classId, clientMessageId, body) =>
      message({ id: 'server-9', clientMessageId, body }),
    );
    await act(async () => {
      await result.current.retry(key);
    });

    // Retrying with the original key is what prevents a duplicate server-side.
    expect(api.sendMessage).toHaveBeenLastCalledWith('class-1', key, 'will fail');
    expect(result.current.pending).toHaveLength(0);
  });

  it('surfaces the rate limit without losing the message', async () => {
    api.sendMessage.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'too quickly'));
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send('spam');
    });

    expect(result.current.rateLimited).toBe(true);
    expect(result.current.pending[0].body).toBe('spam');
  });

  it('prepends older pages without duplicating known messages', async () => {
    api.messageHistory.mockResolvedValueOnce({
      messages: [message({ id: 'b', body: 'newer' })],
      nextCursor: 'b',
      hasMore: true,
    });
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    api.messageHistory.mockResolvedValueOnce({
      messages: [message({ id: 'a', body: 'older' }), message({ id: 'b', body: 'newer' })],
      nextCursor: null,
      hasMore: false,
    });
    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('ignores blank sends', async () => {
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send('   ');
    });

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('applies a deletion returned by the server', async () => {
    api.messageHistory.mockResolvedValue({
      messages: [message({ id: 'a', body: 'oops' })],
      nextCursor: null,
      hasMore: false,
    });
    api.deleteMessage.mockResolvedValue(message({ id: 'a', body: '', deleted: true }));
    const { result } = renderHook(() => useClassChat('class-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove('a');
    });

    expect(result.current.messages[0].deleted).toBe(true);
  });
});
