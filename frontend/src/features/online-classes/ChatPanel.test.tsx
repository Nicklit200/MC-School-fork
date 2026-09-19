import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type ChatMessage } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { ChatPanel } from './ChatPanel';

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
    id: 'a',
    clientMessageId: 'c-a',
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

function renderChat(isHost = false, currentUserId = 'student-1') {
  render(
    <I18nProvider>
      <ChatPanel classId="class-1" currentUserId={currentUserId} isHost={isHost} />
    </I18nProvider>,
  );
}

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.messageHistory.mockResolvedValue({
      messages: [message()],
      nextCursor: null,
      hasMore: false,
    });
    api.sendMessage.mockImplementation(async (_c, clientMessageId, body) =>
      message({ id: 'server-new', clientMessageId, body }),
    );
    api.deleteMessage.mockResolvedValue(message({ deleted: true, body: '' }));
  });

  it('renders history', async () => {
    renderChat();

    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(screen.getByText('Student')).toBeInTheDocument();
  });

  it('renders a message containing markup as inert text', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    api.messageHistory.mockResolvedValue({
      messages: [message({ body: payload })],
      nextCursor: null,
      hasMore: false,
    });

    renderChat();

    // Present as text, and no element was created from the payload.
    expect(await screen.findByText(payload)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('sends a message and clears the composer', async () => {
    renderChat();
    await screen.findByText('hello');

    const input = screen.getByRole('textbox');
    await userEvent.type(input, 'my message');
    await userEvent.click(screen.getByRole('button', { name: /Senden|Отправить/i }));

    await waitFor(() => expect(api.sendMessage).toHaveBeenCalled());
    expect(input).toHaveValue('');
    expect(await screen.findByText('my message')).toBeInTheDocument();
  });

  it('offers a retry when sending fails', async () => {
    api.sendMessage.mockRejectedValueOnce(new Error('offline'));
    renderChat();
    await screen.findByText('hello');

    await userEvent.type(screen.getByRole('textbox'), 'will fail');
    await userEvent.click(screen.getByRole('button', { name: /Senden|Отправить/i }));

    expect(
      await screen.findByRole('button', { name: /Wiederholen|повторить/i }),
    ).toBeInTheDocument();
  });

  it('lets a student delete only their own message', async () => {
    api.messageHistory.mockResolvedValue({
      messages: [message({ id: 'mine', senderId: 'student-1' }), message({ id: 'theirs', senderId: 'other', senderName: 'Other' })],
      nextCursor: null,
      hasMore: false,
    });

    renderChat(false, 'student-1');
    await screen.findByText('Other');

    const deleteButtons = screen.getAllByRole('button', { name: /löschen|Удалить сообщение/i });
    expect(deleteButtons).toHaveLength(1);
  });

  it('lets the host delete any message', async () => {
    api.messageHistory.mockResolvedValue({
      messages: [message({ id: 'mine', senderId: 'student-1' }), message({ id: 'theirs', senderId: 'other', senderName: 'Other' })],
      nextCursor: null,
      hasMore: false,
    });

    renderChat(true, 'teacher-1');
    await screen.findByText('Other');

    expect(screen.getAllByRole('button', { name: /löschen|Удалить сообщение/i })).toHaveLength(2);
  });

  it('shows a deleted message as a placeholder without its body', async () => {
    api.messageHistory.mockResolvedValue({
      messages: [message({ body: '', deleted: true })],
      nextCursor: null,
      hasMore: false,
    });

    renderChat();

    expect(await screen.findByText(/gelöscht|удалено/i)).toBeInTheDocument();
  });

  it('announces the rate limit', async () => {
    const { ApiRequestError } = await vi.importActual<typeof import('../../api/client')>(
      '../../api/client',
    );
    api.sendMessage.mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'too quickly'));
    renderChat();
    await screen.findByText('hello');

    await userEvent.type(screen.getByRole('textbox'), 'spam');
    await userEvent.click(screen.getByRole('button', { name: /Senden|Отправить/i }));

    const status = await screen.findByRole('status');
    await waitFor(() => expect(status).toHaveTextContent(/warten|Подождите/i));
  });
});
