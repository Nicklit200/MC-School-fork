import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi, type ChatMessage } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { ChatPanel } from './ChatPanel';
import { ParticipantListPanel } from './ParticipantListPanel';
import { RecordingControls } from './RecordingControls';

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
      listParticipants: vi.fn(),
      muteParticipant: vi.fn(),
      requestUnmute: vi.fn(),
      removeParticipant: vi.fn(),
      muteAllStudents: vi.fn(),
      acknowledgeRecording: vi.fn(),
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
    },
  };
});

const api = vi.mocked(onlineClassesApi);

const message: ChatMessage = {
  id: 'a',
  clientMessageId: 'c-a',
  senderId: 'student-1',
  senderName: 'Student',
  body: 'hello',
  messageType: 'USER',
  createdAt: '2026-09-18T10:00:00.000Z',
  editedAt: null,
  deleted: false,
};

describe('online-class accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.messageHistory.mockResolvedValue({ messages: [message], nextCursor: null, hasMore: false });
    api.listParticipants.mockResolvedValue([]);
    api.acknowledgeRecording.mockResolvedValue(undefined);
  });

  describe('stylesheet', () => {
    // Resolved from the project root: import.meta.url is not a file: URL
    // under Vitest.
    const css = readFileSync(resolve(process.cwd(), 'src/online-classes.css'), 'utf8');

    it('defines the visually-hidden class the components rely on', () => {
      // Without this, the chat input label and captions heading render as
      // visible text in the middle of the UI.
      expect(css).toMatch(/\.visually-hidden\s*\{/);
    });

    it('keeps visually-hidden content in the accessibility tree', () => {
      const block = css.slice(css.indexOf('.visually-hidden'), css.indexOf('}', css.indexOf('.visually-hidden')));

      // display:none / visibility:hidden would remove it from the tree, which
      // defeats the point of a screen-reader-only label.
      expect(block).not.toMatch(/display:\s*none/);
      expect(block).not.toMatch(/visibility:\s*hidden/);
      expect(block).toMatch(/clip-path|clip:/);
    });

    it('provides a visible keyboard focus indicator', () => {
      expect(css).toMatch(/:focus-visible/);
      expect(css).toMatch(/outline:\s*3px/);
    });

    it('honours a reduced-motion preference', () => {
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });

    it('has a landscape-tablet layout, not only portrait breakpoints', () => {
      expect(css).toMatch(/orientation:\s*landscape/);
    });

    it('keeps touch targets large enough on small screens', () => {
      expect(css).toMatch(/min-height:\s*44px/);
    });
  });

  describe('components', () => {
    it('labels the chat input for screen readers', async () => {
      render(
        <I18nProvider>
          <ChatPanel classId="class-1" currentUserId="student-1" isHost={false} />
        </I18nProvider>,
      );

      // Found by its accessible name, not by placeholder alone.
      expect(await screen.findByLabelText(/Nachricht schreiben|Написать сообщение/i))
        .toBeInTheDocument();
    });

    it('announces connection and status changes politely', async () => {
      render(
        <I18nProvider>
          <RecordingControls classId="class-1" isHost={false} recordingState="ACTIVE" />
        </I18nProvider>,
      );

      const status = screen.getAllByRole('status')[0];
      expect(status).toHaveAttribute('aria-live', 'polite');
    });

    it('gives the recording notice an assertive dialog role', async () => {
      render(
        <I18nProvider>
          <RecordingControls classId="class-1" isHost={false} recordingState="ACTIVE" />
        </I18nProvider>,
      );

      // Consent cannot be a passive status line.
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    });

    it('names every moderation control with the participant it acts on', async () => {
      api.listParticipants.mockResolvedValue([
        {
          userId: 'student-1',
          displayName: 'Student',
          classRole: 'STUDENT',
          admissionState: 'ADMITTED',
          cameraEnabled: true,
          microphoneEnabled: true,
          screenShareEnabled: false,
          connected: true,
          firstJoinedAt: null,
          lastLeftAt: null,
          totalConnectedSeconds: 0,
        },
      ]);
      render(
        <I18nProvider>
          <ParticipantListPanel classId="class-1" isHost />
        </I18nProvider>,
      );
      await screen.findByText('Student');

      // "Mute" alone is ambiguous in a list; the name must be in the label.
      for (const button of screen.getAllByRole('button')) {
        const label = button.getAttribute('aria-label') ?? button.textContent ?? '';
        expect(label.trim().length).toBeGreaterThan(0);
      }
      expect(screen.getByLabelText(/stummschalten Student|Выключить микрофон Student/i))
        .toBeInTheDocument();
    });

    it('is operable by keyboard alone', async () => {
      render(
        <I18nProvider>
          <ChatPanel classId="class-1" currentUserId="student-1" isHost={false} />
        </I18nProvider>,
      );
      await screen.findByText('hello');

      await userEvent.tab();
      // Something in the panel takes focus rather than the tab escaping it.
      expect(document.activeElement).not.toBe(document.body);
    });

    it('marks a raised hand with text, not colour alone', async () => {
      api.listParticipants.mockResolvedValue([
        {
          userId: 'student-1',
          displayName: 'Student',
          classRole: 'STUDENT',
          admissionState: 'ADMITTED',
          cameraEnabled: true,
          microphoneEnabled: true,
          screenShareEnabled: false,
          connected: true,
          firstJoinedAt: null,
          lastLeftAt: null,
          totalConnectedSeconds: 0,
        },
      ]);
      render(
        <I18nProvider>
          <ParticipantListPanel classId="class-1" isHost={false} raisedHands={new Set(['student-1'])} />
        </I18nProvider>,
      );

      expect(await screen.findByLabelText(/Hand gehoben|Рука поднята/i)).toBeInTheDocument();
    });
  });
});
