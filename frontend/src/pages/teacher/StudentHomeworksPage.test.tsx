import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { Homework, StudentListItem } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentHomeworksPage } from './StudentHomeworksPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    api: {
      ...actual.api,
      students: { ...actual.api.students, get: vi.fn() },
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
function mount() {
  return render(
    <MemoryRouter initialEntries={['/students/pupil/homeworks']}>
      <I18nProvider>
        <Routes>
          <Route path="/students/:studentId/homeworks" element={<StudentHomeworksPage />} />
          <Route path="/teacher/students/:studentId/homeworks/:homeworkId" element={<LocationEcho />} />
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

beforeEach(() => {
  vi.clearAllMocks();
  // The fixture is a future assignment; keep calendar-dependent labels stable.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  localStorage.setItem('language', 'RU');
  vi.mocked(api.students.get).mockResolvedValue(pupil);
  vi.mocked(api.homeworks.listForStudent).mockResolvedValue([a, b]);
  vi.mocked(api.homeworks.remove).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Homework history three-dot actions', () => {
  it('displays separate records and a compact menu when both PDFs have the same date', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(a.worksheetFilename!);
    expect(screen.getByText(b.worksheetFilename!)).toBeInTheDocument();
    expect(screen.getAllByText('20.11.2026')).toHaveLength(2);
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
    await screen.findByText(a.worksheetFilename!);
    await user.click(within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Редактировать' }));
    expect(screen.getByTestId('detail-location'))
      .toHaveTextContent('/teacher/students/pupil/homeworks/homework-a?section=edit');
  });

  it('opens the existing PDF viewer via the action menu', async () => {
    const user = userEvent.setup();
    mount();
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
    await screen.findByText(a.worksheetFilename!);
    const toggle = within(findRow(a.worksheetFilename!)).getByRole('button', { name: /Действия с домашкой/ });
    await user.click(toggle);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(toggle);
    await user.click(screen.getByRole('heading', { name: 'История домашки' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
