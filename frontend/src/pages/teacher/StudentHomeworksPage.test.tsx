import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { GroupLesson, Homework, StudentLessonHistoryItem, StudentListItem } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentHomeworksPage } from './StudentHomeworksPage';
import { StudentLessonsPage } from './StudentLessonsPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      ...actual.api,
      students: { ...actual.api.students, get: vi.fn(), lessonHistory: vi.fn() },
      lessons: { ...actual.api.lessons, savedGroupLessons: vi.fn() },
      homeworks: {
        ...actual.api.homeworks,
        listForStudent: vi.fn(), remove: vi.fn(), createPdf: vi.fn(),
      },
    },
  };
});
vi.mock('./GoogleDrivePdfPicker', () => ({
  GoogleDrivePdfPicker: () => null,
}));
vi.mock('./GoogleDriveMultiPdfPicker', () => ({
  GoogleDriveMultiPdfPicker: () => null,
}));

const pupil = { id: 'pupil', fullName: 'Тестовый ученик' } as StudentListItem;
function homework(id: string, name: string, overrides: Partial<Homework> = {}): Homework {
  return {
    id, studentId: 'pupil', startDate: '2026-11-20',
    createdAt: '2026-11-17T10:00:00Z', totalCards: 0, notStarted: 0,
    inProgress: 0, learned: 0, status: 'PENDING', hasWorksheet: true,
    worksheetFilename: name, worksheetPageCount: 1, submitted: false,
    submittedAt: null, deadlineAt: '2026-11-20T19:00:00+01:00',
    overdue: false, submittedLate: false, ...overrides,
  };
}
const a = homework('homework-a', 'Mindcrafti_Hausaufgabe_A.pdf');
const b = homework('homework-b', 'Mindcrafti_Hausaufgabe_B.pdf');

function LocationEcho() {
  const location = useLocation();
  return <div data-testid="detail-location">{location.pathname + location.search}</div>;
}
function mount(initialEntry = '/students/pupil/homeworks') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <I18nProvider>
        <Routes>
          <Route path="/students/:studentId/homeworks" element={<StudentHomeworksPage />} />
          <Route path="/students/:studentId/lessons" element={<StudentLessonsPage />} />
          <Route path="/teacher/students/:studentId/homeworks/:homeworkId" element={<LocationEcho />} />
          <Route path="/teacher/lessons/:eventId" element={<LocationEcho />} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>,
  );
}
function findRow(filename: string): HTMLElement {
  const node = screen.getByText(filename);
  const row = node.closest('.homework-history-row');
  if (!(row instanceof HTMLElement)) throw new Error('No homework history row');
  return row;
}

async function selectFixtureDate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^20\.11\.2026/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The fixture is a future assignment; keep calendar-dependent labels stable.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  localStorage.setItem('language', 'RU');
  vi.mocked(api.students.get).mockResolvedValue(pupil);
  vi.mocked(api.homeworks.listForStudent).mockResolvedValue([a, b]);
  vi.mocked(api.homeworks.remove).mockResolvedValue(undefined);
  vi.mocked(api.lessons.savedGroupLessons).mockResolvedValue([]);
  vi.mocked(api.students.lessonHistory).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Homework history three-dot actions', () => {
  it('displays separate records and a compact menu when both PDFs have the same date', async () => {
    const user = userEvent.setup();
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    expect(screen.getByText(b.worksheetFilename!)).toBeInTheDocument();
    expect(screen.getAllByText('20.11.2026').filter(node => node.closest('.homework-history-row'))).toHaveLength(2);
    const row = findRow(a.worksheetFilename!);
    const toggle = within(row).getByRole('button', { name: /Действия с домашкой/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(row).getByText('Запланировано')).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const menu = within(row).getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Посмотреть' }))
      .toHaveAttribute('href', '/teacher/students/pupil/homeworks/homework-a?section=preview');
    expect(within(menu).getByRole('menuitem', { name: 'Редактировать' }))
      .toHaveAttribute('href', '/teacher/students/pupil/homeworks/homework-a?section=edit');
    expect(within(menu).getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();
    expect(within(findRow(b.worksheetFilename!)).queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the existing PDF editor via the action menu', async () => {
    const user = userEvent.setup();
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    expect(screen.getByTestId('detail-location'))
      .toHaveTextContent('/teacher/students/pupil/homeworks/homework-a?section=edit');
  });

  it('opens the existing PDF viewer via the action menu', async () => {
    const user = userEvent.setup();
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Посмотреть' }));
    expect(screen.getByTestId('detail-location'))
      .toHaveTextContent('/teacher/students/pupil/homeworks/homework-a?section=preview');
  });

  it('does not delete before confirmation and removes only the selected same-day PDF', async () => {
    const user = userEvent.setup();
    vi.mocked(api.homeworks.listForStudent)
      .mockResolvedValueOnce([a, b])
      .mockResolvedValue([b]);
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('20.11.2026');
    expect(confirm).toHaveTextContent(a.worksheetFilename!);
    expect(api.homeworks.remove).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.homeworks.remove).toHaveBeenCalledExactlyOnceWith('homework-a'));
    expect(await screen.findByText('Домашнее задание удалено.')).toBeInTheDocument();
    expect(screen.queryByText(a.worksheetFilename!)).not.toBeInTheDocument();
    expect(screen.getByText(b.worksheetFilename!)).toBeInTheDocument();
  });

  it('cancels deletion without touching the original homework', async () => {
    const user = userEvent.setup();
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.homeworks.remove).not.toHaveBeenCalled();
    expect(screen.getByText(a.worksheetFilename!)).toBeInTheDocument();
  });

  it('keeps the homework visible and reports a failed delete', async () => {
    const user = userEvent.setup();
    vi.mocked(api.homeworks.remove).mockRejectedValue(new Error('Сервер отказал'));
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Что-то пошло не так')).toBeInTheDocument();
    // The pending confirmation also displays the filename; verify the real list
    // entry survived the failed API call rather than querying both copies.
    expect(screen.getAllByText(a.worksheetFilename!)
      .some(node => Boolean(node.closest('.homework-history-row')))).toBe(true);
  });

  it('closes the menu after clicking away or pressing Escape', async () => {
    const user = userEvent.setup();
    mount();
    await selectFixtureDate(user);
    await screen.findByText(a.worksheetFilename!);
    const toggle = within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ });
    await user.click(toggle);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(toggle);
    await user.click(screen.getByRole('heading', { name: 'Календарь занятий и домашки' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('Monthly homework history', () => {
  it('shows the requested colors and opens the selected day without mixing its assignments', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    vi.mocked(api.homeworks.listForStudent).mockResolvedValue([
      homework('done', 'On-time.pdf', { startDate: '2026-11-23', deadlineAt: '2026-11-23T23:00:00Z', submitted: true, submittedAt: '2026-11-23T18:00:00Z' }),
      homework('late', 'Late.pdf', { startDate: '2026-11-24', deadlineAt: '2026-11-24T23:00:00Z', submitted: true, submittedAt: '2026-11-25T09:00:00Z', submittedLate: true }),
      homework('missed', 'Missing.pdf', { startDate: '2026-11-25', deadlineAt: '2026-11-25T23:00:00Z', overdue: true }),
      homework('today', 'Today.pdf', { startDate: '2026-11-26', deadlineAt: '2026-11-26T23:00:00Z' }),
      homework('future', 'Future.pdf', { startDate: '2026-11-27', deadlineAt: '2026-11-27T23:00:00Z' }),
    ]);
    mount();
    expect(await screen.findByRole('button', { name: /^23\.11\.2026/ })).toHaveAttribute('data-status', 'DONE');
    expect(screen.getByRole('button', { name: /^24\.11\.2026/ })).toHaveAttribute('data-status', 'LATE');
    expect(screen.getByRole('button', { name: /^25\.11\.2026/ })).toHaveAttribute('data-status', 'MISSED');
    expect(screen.getByRole('button', { name: /^26\.11\.2026/ })).toHaveAttribute('data-status', 'TODAY');
    expect(screen.getByRole('button', { name: /^27\.11\.2026/ })).toHaveAttribute('data-status', 'UPCOMING');
    expect(screen.getByText('Today.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^24\.11\.2026/ }));
    expect(screen.queryByText('Today.pdf')).not.toBeInTheDocument();
    expect(within(findRow('Late.pdf')).getByText('Сдано с опозданием')).toHaveClass('homework-history-status--late');
    await user.click(screen.getByRole('button', { name: /^21\.11\.2026/ }));
    expect(screen.getByText('На этот день уроков и домашнего задания нет.')).toBeInTheDocument();
  });

  it('keeps all statuses on a mixed day and does not make incomplete work look completed', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    vi.mocked(api.homeworks.listForStudent).mockResolvedValue([
      homework('done', 'Done.pdf', { submitted: true, submittedAt: '2026-11-20T12:00:00Z' }),
      homework('missed', 'Open.pdf', { overdue: true }),
    ]);
    mount();
    const day = await screen.findByRole('button', { name: /^20\.11\.2026/ });
    expect(day).toHaveAttribute('data-status', 'MISSED');
    expect(day).toHaveAccessibleName(/Не сдано: 1/);
    expect(day).toHaveAccessibleName(/Сдано вовремя: 1/);
    await user.click(day);
    expect(screen.getByText('Done.pdf')).toBeInTheDocument();
    expect(screen.getByText('Open.pdf')).toBeInTheDocument();
  });

  it('switches months across the year boundary and returns to today', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-12-31T12:00:00Z'));
    vi.mocked(api.homeworks.listForStudent).mockResolvedValue([
      homework('january', 'January.pdf', { startDate: '2027-01-01', deadlineAt: '2027-01-01T23:00:00Z' }),
    ]);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Следующий месяц' }));
    expect(screen.getByRole('heading', { name: /январь 2027/i })).toBeInTheDocument();
    expect(screen.getByText('January.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Сегодня$/ }));
    expect(screen.getByRole('heading', { name: /декабрь 2026/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^31\.12\.2026/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('January.pdf')).not.toBeInTheDocument();
  });
});

describe('Lessons and homework in one calendar', () => {
  it('resets student actions immediately and ignores an old reload after switching students', async () => {
    const user = userEvent.setup();
    const otherPupil = { ...pupil, id: 'other', fullName: 'Другой ученик' };
    const otherHomework = homework('other-work', 'Other-student.pdf', {
      studentId: 'other', startDate: '2026-11-17', deadlineAt: '2026-11-17T23:00:00Z',
    });
    let releaseOldReload!: (homeworks: Homework[]) => void;
    const oldReload = new Promise<Homework[]>(resolve => { releaseOldReload = resolve; });
    let firstStudentReads = 0;
    vi.mocked(api.students.get).mockImplementation(async id => id === pupil.id ? pupil : otherPupil);
    vi.mocked(api.homeworks.listForStudent).mockImplementation(id => {
      if (id === 'other') return Promise.resolve([otherHomework]);
      firstStudentReads += 1;
      return firstStudentReads === 1 ? Promise.resolve([a, b]) : oldReload;
    });
    render(
      <MemoryRouter initialEntries={['/students/pupil/homeworks']}>
        <I18nProvider>
          <Link to="/students/other/homeworks">Перейти к другому ученику</Link>
          <Routes>
            <Route path="/students/:studentId/homeworks" element={<StudentHomeworksPage />} />
          </Routes>
        </I18nProvider>
      </MemoryRouter>,
    );
    await selectFixtureDate(user);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(api.homeworks.listForStudent).toHaveBeenNthCalledWith(2, pupil.id));

    // Simulate a route change while the previous student's post-delete reload is pending.
    await user.click(screen.getByRole('link', { name: 'Перейти к другому ученику' }));
    expect(await screen.findByRole('heading', { name: 'Уроки и домашка · Другой ученик' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText(a.worksheetFilename!)).not.toBeInTheDocument();
    expect(screen.queryByText(b.worksheetFilename!)).not.toBeInTheDocument();
    expect(within(findRow(otherHomework.worksheetFilename!)).getByRole('link'))
      .toHaveAttribute('href', '/teacher/students/other/homeworks/other-work?section=preview');

    await act(async () => { releaseOldReload([b]); await oldReload; });
    expect(screen.getByRole('heading', { name: 'Уроки и домашка · Другой ученик' })).toBeInTheDocument();
    expect(screen.getByText(otherHomework.worksheetFilename!)).toBeInTheDocument();
    expect(screen.queryByText(b.worksheetFilename!)).not.toBeInTheDocument();
    expect(screen.queryByText('Домашнее задание удалено.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows a completed lesson beside homework and opens its existing detail route', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    vi.mocked(api.lessons.savedGroupLessons).mockResolvedValue([{
      eventId: 'lesson-1', title: 'Дроби и уравнения', groupName: null,
      studentId: 'pupil', participantStudentIds: ['pupil'],
      startsAt: '2026-11-20T16:00:00Z', endsAt: '2026-11-20T17:00:00Z',
      onlineClassStatus: 'ENDED', actualStartAt: '2026-11-20T16:02:00Z', actualEndAt: '2026-11-20T17:01:00Z',
    } as GroupLesson]);
    mount();
    const day = await screen.findByRole('button', { name: /^20\.11\.2026.*Урок проведён/ });
    expect(day.querySelector('[data-lesson-status="COMPLETED"]')).toBeInTheDocument();
    expect(day).toHaveAttribute('data-status', 'MISSED');
    await user.click(day);
    expect(screen.getByText(a.worksheetFilename!)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Дроби и уравнения/ }));
    expect(screen.getByTestId('detail-location')).toHaveTextContent('/teacher/lessons/lesson-1');
  });

  it('keeps old lessons links working and places archived lessons on their Berlin date', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-11-26T12:00:00Z'));
    vi.mocked(api.students.lessonHistory).mockResolvedValue([{
      eventId: 'old', title: 'Урок прежнего учителя', groupName: null,
      sourceTeacherId: 'former', sourceTeacherName: 'Преподаватель',
      startsAt: '2026-11-19T23:30:00Z', endsAt: '2026-11-20T00:30:00Z',
      onlineClassStatus: 'ENDED', actualStartAt: '2026-11-19T23:30:00Z', actualEndAt: '2026-11-20T00:30:00Z',
    } as StudentLessonHistoryItem]);
    mount('/students/pupil/lessons');
    await user.click(await screen.findByRole('button', { name: /^20\.11\.2026.*Урок 00:30/ }));
    expect(screen.getByRole('link', { name: /Урок прежнего учителя/ }))
      .toHaveAttribute('href', '/teacher/students/pupil/lesson-history/former/old');
  });

  it('keeps homework usable and reports unavailable lesson data', async () => {
    const user = userEvent.setup();
    vi.mocked(api.lessons.savedGroupLessons).mockRejectedValue(new Error('Unavailable'));
    mount();
    await selectFixtureDate(user);
    expect(screen.getByText(a.worksheetFilename!)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось загрузить часть уроков');
  });
});
