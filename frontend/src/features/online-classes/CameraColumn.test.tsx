import { render, screen, within } from '@testing-library/react';
import { ConnectionQuality, ConnectionState } from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';

interface Fake {
  identity: string;
  name: string;
  isLocal?: boolean;
  speaking?: boolean;
  micMuted?: boolean;
  cameraOn?: boolean;
  quality?: ConnectionQuality;
}

let fakes: Fake[] = [];
let roomState = ConnectionState.Connected;

const find = (participant: { identity: string }) => fakes.find((fake) => fake.identity === participant.identity)!;

vi.mock('@livekit/components-react', () => ({
  useTracks: () =>
    fakes.map((fake) => ({
      participant: { identity: fake.identity, name: fake.name, isLocal: !!fake.isLocal },
      source: 'camera',
      ...(fake.cameraOn ? { publication: { isMuted: false } } : {}),
    })),
  useIsSpeaking: (participant: { identity: string }) => !!find(participant).speaking,
  useIsMuted: (ref: { participant: { identity: string }; source?: string; publication?: unknown }) =>
    ref.source === 'microphone' ? !!find(ref.participant).micMuted : !ref.publication,
  useConnectionQualityIndicator: ({ participant }: { participant: { identity: string } }) => ({
    quality: find(participant).quality ?? ConnectionQuality.Excellent,
  }),
  useConnectionState: () => roomState,
  VideoTrack: () => <video data-testid="video" />,
}));

import { CameraColumn } from './CameraColumn';

const teacher: Fake = { identity: 't|d', name: 'Mr Teacher', isLocal: true, cameraOn: true };
const student = (id: string, over: Partial<Fake> = {}): Fake => ({
  identity: `${id}|d`,
  name: `Student ${id}`,
  cameraOn: true,
  ...over,
});

function renderColumn() {
  return render(
    <I18nProvider>
      <CameraColumn hostUserId="t" localIsHost />
    </I18nProvider>,
  );
}

const names = () =>
  screen
    .getAllByRole('listitem')
    // The speaking announcement is appended to the name for screen readers.
    .map((card) => within(card).getByText(/Mr Teacher|Student \w/).textContent?.replace(/\s*\(.*\)$/, ''));

describe('CameraColumn', () => {
  beforeEach(() => {
    fakes = [];
    roomState = ConnectionState.Connected;
  });

  it('puts the teacher first and the students below in arrival order', () => {
    fakes = [student('a'), student('b'), teacher];
    renderColumn();
    expect(names()).toEqual(['Mr Teacher', 'Student a', 'Student b']);
  });

  it('does not move the active speaker — it only highlights their card', () => {
    fakes = [teacher, student('a'), student('b')];
    const { rerender } = renderColumn();
    expect(names()).toEqual(['Mr Teacher', 'Student a', 'Student b']);

    fakes = [teacher, student('a'), student('b', { speaking: true })];
    rerender(
      <I18nProvider>
        <CameraColumn hostUserId="t" localIsHost />
      </I18nProvider>,
    );
    expect(names()).toEqual(['Mr Teacher', 'Student a', 'Student b']);
    const cards = screen.getAllByRole('listitem');
    expect(cards[2]).toHaveAttribute('data-speaking', 'true');
    expect(cards[1]).not.toHaveAttribute('data-speaking');
  });

  it('appends a latecomer at the bottom and closes the gap when someone leaves', () => {
    fakes = [teacher, student('a'), student('b')];
    const { rerender } = renderColumn();
    const again = () =>
      rerender(
        <I18nProvider>
          <CameraColumn hostUserId="t" localIsHost />
        </I18nProvider>,
      );

    fakes = [teacher, student('a'), student('b'), student('c')];
    again();
    expect(names()).toEqual(['Mr Teacher', 'Student a', 'Student b', 'Student c']);

    fakes = [teacher, student('b'), student('c')];
    again();
    expect(names()).toEqual(['Mr Teacher', 'Student b', 'Student c']);
  });

  it('keeps the slot and shows initials and the name when the camera is off', () => {
    fakes = [teacher, student('a', { cameraOn: false, name: 'Anna Schmidt' })];
    renderColumn();
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[1]).toHaveAttribute('data-camera', 'off');
    expect(within(cards[1]).getByText('AS')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Anna Schmidt')).toBeInTheDocument();
    expect(within(cards[1]).queryByTestId('video')).not.toBeInTheDocument();
  });

  it('shows "Переподключение…" in place for a participant who lost connection', () => {
    fakes = [teacher, student('a', { quality: ConnectionQuality.Lost })];
    renderColumn();
    const cards = screen.getAllByRole('listitem');
    expect(within(cards[1]).getByText('Переподключение…')).toBeInTheDocument();
    expect(within(cards[0]).queryByText('Переподключение…')).not.toBeInTheDocument();
    expect(names()).toEqual(['Mr Teacher', 'Student a']);
  });

  it('marks the local card as reconnecting from the room state', () => {
    roomState = ConnectionState.Reconnecting;
    fakes = [teacher, student('a')];
    renderColumn();
    expect(within(screen.getAllByRole('listitem')[0]).getByText('Переподключение…')).toBeInTheDocument();
  });

  it('shows mic and camera status indicators', () => {
    fakes = [teacher, student('a', { micMuted: true, cameraOn: false })];
    renderColumn();
    const card = screen.getAllByRole('listitem')[1];
    expect(within(card).getByRole('img', { name: 'Микрофон выключен' })).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Камера выключена' })).toBeInTheDocument();
  });

  it('is read-only: a card exposes no control to change a participant’s mic or camera', () => {
    fakes = [teacher, student('a')];
    renderColumn();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
