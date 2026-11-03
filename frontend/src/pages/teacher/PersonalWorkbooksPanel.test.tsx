import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lessonPreparationApi, type PersonalWorkbook } from '../../api/lessonPreparation';
import { I18nProvider } from '../../i18n/I18nContext';
import { PersonalWorkbooksPanel } from './PersonalWorkbooksPanel';

vi.mock('../../api/lessonPreparation', () => ({ lessonPreparationApi: {
  personalWorkbooks: vi.fn(), uploadPersonalWorkbook: vi.fn(), personalWorkbookUrl: vi.fn(),
  uploadPersonalAnswers: vi.fn(), personalAnswersUrl: vi.fn(),
} }));

const alice: PersonalWorkbook = { studentId: 'alice', studentName: 'Анна', hasWorkbook: true, filename: 'anna.pdf', version: 2 };
const bob: PersonalWorkbook = { studentId: 'bob', studentName: 'Борис', hasWorkbook: false, filename: null, version: 0 };
const mount = () => render(<I18nProvider><PersonalWorkbooksPanel eventId="lesson-1" /></I18nProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('language', 'RU');
  vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [alice, bob] });
});
afterEach(cleanup);

describe('personal lesson worksheets', () => {
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
    expect(within(screen.getByRole('group', { name: 'Анна' })).getByText('anna.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Борис' })).getByText('boris.pdf')).toBeInTheDocument();
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
    expect(within(screen.getByRole('group', { name: 'Борис' })).getByText('boris-solutions.pdf')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Анна' })).getByText('anna.pdf')).toBeInTheDocument();
  });

  it('preserves personal solutions when a worksheet response omits the optional answer fields', async () => {
    vi.mocked(lessonPreparationApi.personalWorkbooks).mockResolvedValue({ enabled: true, students: [{ ...alice, hasAnswers: true, answersFilename: 'anna-solutions.pdf', answersVersion: 3 }] });
    vi.mocked(lessonPreparationApi.uploadPersonalWorkbook).mockResolvedValue({ ...alice, filename: 'new-anna.pdf', version: 4 });
    mount();
    await userEvent.upload(await screen.findByLabelText('Лист для Анна'), new File(['%PDF-1.7'], 'new-anna.pdf', { type: 'application/pdf' }));
    await screen.findByText('new-anna.pdf');
    expect(screen.getByText('anna-solutions.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Посмотреть решения' })).toBeInTheDocument();
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
