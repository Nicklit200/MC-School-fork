import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import type { OnlineClass } from '../../api/onlineClasses';
import { LessonEntryAction } from './LessonEntryAction';

afterEach(cleanup);

it.each([true, false])('shows an idle classroom and retains its existing host entry link (host=%s)', viewerIsHost => {
  const room = { id: 'existing-class', status: 'LIVE', mediaState: 'IDLE', joinWindowOpen: true,
    viewerIsHost, viewerHasJoined: true } as OnlineClass;
  render(<MemoryRouter><LessonEntryAction room={room} startsAt="2026-10-24T12:00:00Z"
    language="RU" now={Date.parse('2026-10-24T12:05:00Z')} /></MemoryRouter>);
  expect(screen.getByRole('status')).toHaveTextContent('Комната в ожидании входа учителя');
  expect(screen.queryByText(/Урок продолжается|Урок открыт/)).not.toBeInTheDocument();
  const join = screen.queryByRole('link', { name: /Mindcrafti Online/ });
  if (viewerIsHost) expect(join).toHaveAttribute('href', '/online-classes/existing-class');
  else expect(join).not.toBeInTheDocument();
});

it.each(['2026-10-23T12:00:00Z', '2026-11-02T12:00:00Z'])('keeps the teacher entry link before the lesson date and after its calendar week (%s)', now => {
  const room = { id: 'existing-class', status: 'LIVE', mediaState: 'IDLE', joinWindowOpen: true,
    viewerIsHost: true, viewerHasJoined: true } as OnlineClass;
  render(<MemoryRouter><LessonEntryAction room={room} startsAt="2026-10-24T12:00:00Z"
    language="RU" now={Date.parse(now)} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: /Mindcrafti Online/ })).toHaveAttribute('href', '/online-classes/existing-class');
  expect(screen.queryByText(/день урока|Урок завершён/)).not.toBeInTheDocument();
});

it('shows an early pupil entry grant while labelling the future date as the schedule', () => {
  const room = { id: 'mark-lesson', status: 'LIVE', teacherPresent: true, mediaState: 'ACTIVE',
    joinWindowOpen: true, viewerIsHost: false, viewerHasJoined: false, entryState: 'OPEN' } as OnlineClass;
  render(<MemoryRouter><LessonEntryAction room={room} startsAt="2026-11-03T15:00:00Z"
    language="RU" now={Date.parse('2026-11-02T20:00:00Z')} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: /Mindcrafti Online/ })).toHaveAttribute('href', '/online-classes/mark-lesson');
  expect(screen.getByText('По расписанию: 03.11.2026 (Берлин)')).toBeInTheDocument();
  expect(screen.queryByText(/День входа|только в день/)).not.toBeInTheDocument();
});

it('labels the appointment date as planned in German while waiting for the teacher', () => {
  render(<MemoryRouter><LessonEntryAction startsAt="2026-11-03T15:00:00Z"
    language="DE" now={Date.parse('2026-11-02T20:00:00Z')} /></MemoryRouter>);
  expect(screen.getByText('Geplant für: 3.11.2026 (Berlin)')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Wir warten auf die Lehrkraft');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
