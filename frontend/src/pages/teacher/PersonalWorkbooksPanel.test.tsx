import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi, type PersonalWorkbook } from '../../api/lessonPreparation';
import { api } from '../../api/client';
import type { GroupLesson } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { PersonalWorkbooksPanel } from './PersonalWorkbooksPanel';

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api, lessons: { ...actual.api.lessons,
    participants: vi.fn(), addParticipant: vi.fn(), removeParticipant: vi.fn(),
    transferParticipant: vi.fn(),
  } } };
});

vi.mock('../../api/lessonPreparation', () => ({ lessonPreparationApi: {
  personalWorkbooks: vi.fn(), uploadPersonalWorkbook: vi.fn(), personalWorkbookUrl: vi.fn(),
  uploadPersonalAnswers: vi.fn(), personalAnswersUrl: vi.fn(),
} }));

const alice: PersonalWorkbook = { studentId: 'alice', studentName: 'Анна', hasWorkbook: true, filename: 'anna.pdf', version: 2 };
const bob: PersonalWorkbook = { studentId: 'bob', studentName: 'Борис', hasWorkbook: false, filename: null, version: 0 };
const mount = () => render(<I18nProvider><PersonalWorkbooksPanel eventId="lesson-1" /></I18nProvider>);
const futureLesson: GroupLesson = {
  eventId: 'lesson-1', bindingKey: 'lesson-1', title: 'Группа 1', groupId: 'group1',
  groupName: 'Группа 1', studentId: null, studentName: null,
  startsAt: '2099-11-27T17:00:00Z', endsAt: '2099-11-27T18:00:00Z',
  participantStudentIds: ['alice', 'bob'], meetUrl: null, calendarUrl: null,
};
const mountWithRoster = (onChanged = vi.fn(async () => {})) =>
  render(<I18nProvider><PersonalWorkbooksPanel eventId="lesson-1"
    lesson={futureLesson} lessons={[futureLesson]} students={[
      { id: 'alice', fullName: 'Анна', status: 'ACTIVE' },
      { id: 'bob', fullName: 'Борис', status: 'ACTIVE' },
      { id: 'sofia', fullName: 'София', status: 'ACTIVE' },
    ] as any} onChanged={onChanged} /></I18nProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('language', 'RU');
  vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [alice, bob] });
  vi.mocked(api.lessons.participants).mockResolvedValue([
    { studentId: 'alice', studentName: 'Анна' },
    { studentId: 'bob', studentName: 'Борис' },
  ]);
  vi.mocked(api.lessons.removeParticipant).mockResolvedValue([]);
  vi.mocked(api.lessons.addParticipant).mockResolvedValue([]);
});
afterEach(cleanup);

describe('personal lesson worksheets', () => {
  it('shows a compact minus by each personal workbook and confirms removal for only this occurrence', async () => {
    const onChanged = vi.fn(async () => {});
    mountWithRoster(onChanged);
    const bobCard = await screen.findByRole('region', { name: 'Борис' });
    const minus = await within(bobCard).findByRole('button', { name: 'Убрать Борис только из этого урока' });
    await userEvent.click(minus);
    expect(api.lessons.removeParticipant).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Основная группа, остальные уроки и сохранённые тетради не изменятся.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.lessons.removeParticipant).not.toHaveBeenCalled();

    await userEvent.click(minus);
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Да, убрать только из этого урока',
    }));
    await waitFor(() => expect(api.lessons.removeParticipant).toHaveBeenCalledWith('lesson-1', 'bob'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('adds one temporary student right beside the workbook cards', async () => {
    mountWithRoster();
    const select = await screen.findByRole('combobox', { name: 'Выбрать ученика для добавления' });
    await userEvent.selectOptions(select, 'sofia');
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить на один урок' }));
    await waitFor(() => expect(api.lessons.addParticipant).toHaveBeenCalledWith('lesson-1', 'sofia'));
  });

  it('never removes a student when confirmation is dismissed', async () => {
    mountWithRoster();
    const minus = await screen.findByRole('button', { name: 'Убрать Анна только из этого урока' });
    await userEvent.click(minus);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.lessons.removeParticipant).not.toHaveBeenCalled();
  });

  it('keeps the upload controls hidden when the server has not enabled this account', async () => {
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: false, students: [] });
    mount();
    await waitFor(() => expect(lessonPreparationApi.personalWorkbooks).toHaveBeenCalledWith('lesson-1'));
    expect(screen.queryByRole('heading', { name: 'Листы учеников' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Лист для/)).not.toBeInTheDocument();
  });

  it('uploads to the selected student and preserves another student’s worksheet', async () => {
    const saved = { ...bob, hasWorkbook: true, filename: 'boris.pdf', version: 1 };
    vi.mocked(lessonPreparationApi.uploadPersonalWorkbook).mockResolvedValue(saved);
    mount();
    const input = await screen.findByLabelText('Лист для Борис');
    const file = new File(['%PDF-1.7'], 'boris.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await waitFor(() => expect(lessonPreparationApi.uploadPersonalWorkbook).toHaveBeenCalledWith('lesson-1', 'bob', file));
    expect(await screen.findByRole('status')).toHaveTextContent('Лист для Борис сохранён.');
    expect(within(screen.getByRole('region', { name: 'Анна' })).getByText('anna.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Борис' })).getByText('boris.pdf')).toBeInTheDocument();
  });

  it('keeps the existing worksheet when the replacement is rejected', async () => {
    vi.mocked(lessonPreparationApi.uploadPersonalWorkbook).mockRejectedValue(new Error('PDF повреждён'));
    mount();
    await userEvent.upload(await screen.findByLabelText('Лист для Анна'), new File(['bad'], 'new.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF повреждён');
    expect(screen.getByText('anna.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('rejects an empty file before upload', async () => {
    mount();
    await userEvent.upload(await screen.findByLabelText('Лист для Борис'), new File([], 'empty.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('непустой PDF');
    expect(lessonPreparationApi.uploadPersonalWorkbook).not.toHaveBeenCalled();
  });

  it('uploads private solutions for the selected pupil while preserving both worksheets', async () => {
    vi.mocked(lessonPreparationApi.uploadPersonalAnswers).mockResolvedValue({ studentId: 'bob', hasAnswers: true, answersFilename: 'boris-solutions.pdf', version: 1 });
    mount();
    const file = new File(['%PDF-1.7'], 'boris-solutions.pdf', { type: 'application/pdf' });
    await userEvent.upload(await screen.findByLabelText('Решения для Борис'), file);
    expect(lessonPreparationApi.uploadPersonalAnswers).toHaveBeenCalledWith('lesson-1', 'bob', file);
    expect(lessonPreparationApi.uploadPersonalWorkbook).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('видны только преподавателю');
    expect(within(screen.getByRole('region', { name: 'Борис' })).getByText('boris-solutions.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Анна' })).getByText('anna.pdf')).toBeInTheDocument();
  });

  it('preserves personal solutions when a worksheet response omits the optional answer fields', async () => {
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [{ ...alice, hasAnswers: true, answersFilename: 'anna-solutions.pdf', answersVersion: 3 }] });
    vi.mocked(lessonPreparationApi.uploadPersonalWorkbook).mockResolvedValue({ ...alice, filename: 'new-anna.pdf', version: 4 });
    mount();
    await userEvent.upload(await screen.findByLabelText('Лист для Анна'), new File(['%PDF-1.7'], 'new-anna.pdf', { type: 'application/pdf' }));
    await screen.findByText('new-anna.pdf');
    expect(screen.getByText('anna-solutions.pdf')).toBeInTheDocument();
    const solutions = screen.getByText('anna-solutions.pdf').parentElement!;
    expect(within(solutions).getByRole('button', { name: 'Открыть' })).toBeInTheDocument();
  });

  it('never applies a previous lesson’s pending solutions upload to the current lesson', async () => {
    let finish!: (value: { studentId: string; hasAnswers: boolean; answersFilename: string; version: number }) => void;
    vi.mocked(lessonPreparationApi.uploadPersonalAnswers).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = mount();
    await userEvent.upload(await screen.findByLabelText('Решения для Борис'), new File(['%PDF-1.7'], 'old.pdf', { type: 'application/pdf' }));
    view.rerender(<I18nProvider><PersonalWorkbooksPanel eventId="lesson-2" /></I18nProvider>);
    await waitFor(() => expect(lessonPreparationApi.personalWorkbooks).toHaveBeenCalledWith('lesson-2'));
    await act(async () => { finish({ studentId: 'bob', hasAnswers: true, answersFilename: 'old.pdf', version: 1 }); });
    await waitFor(() => expect(screen.getByLabelText('Решения для Борис')).not.toBeDisabled());
    expect(screen.queryByText('old.pdf')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
