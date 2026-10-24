import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { completedLessonApi, lessonPreparationApi, type CompletedLessonDocument } from '../../api/lessonPreparation';
import type { LessonPreparation } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { LessonDetailPage } from './LessonDetailPage';

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api,
    lessons: { ...actual.api.lessons, groupLessons: vi.fn() },
    students: { ...actual.api.students, list: vi.fn() },
  } };
});
vi.mock('../../api/lessonPreparation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/lessonPreparation')>();
  return { ...actual, lessonPreparationApi: { ...actual.lessonPreparationApi, get: vi.fn() },
    completedLessonApi: { ...actual.completedLessonApi, list: vi.fn(), uploadManual: vi.fn(), open: vi.fn() } };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'regular-teacher', role: 'TEACHER' } }) }));
vi.mock('./GoogleDrivePdfPicker', () => ({ GoogleDrivePdfPicker: () => null }));

const archived: CompletedLessonDocument = { id: 'board-pdf', classId: 'class-1', boardId: 'board-1', filename: 'Записи общей доски.pdf', savedAt: '2026-10-23T15:00:00Z' };
const uploaded: CompletedLessonDocument = { ...archived, id: 'manual-pdf', boardId: 'manual-shared', filename: 'Тетрадь.pdf' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('language', 'RU');
  vi.mocked(api.lessons.groupLessons).mockResolvedValue([{
    eventId: 'local-trial', bindingKey: 'local-trial', title: 'Пробный урок', groupId: null, groupName: null, studentId: null, studentName: null, participantStudentIds: [],
    startsAt: '2026-10-23T00:00:00Z', endsAt: '2026-10-23T01:00:00Z', meetUrl: null, calendarUrl: null,
  }]);
  vi.mocked(api.students.list).mockResolvedValue([]);
  vi.mocked(lessonPreparationApi.get).mockResolvedValue({ eventId: 'local-trial', hasWorkbook: false, hasAnswers: false, hasTranscript: false } as LessonPreparation);
  vi.mocked(completedLessonApi.list).mockResolvedValue([archived]);
  vi.mocked(completedLessonApi.uploadManual).mockResolvedValue(uploaded);
  vi.mocked(completedLessonApi.open).mockResolvedValue(undefined);
});
function mount() {
  return render(<I18nProvider><MemoryRouter initialEntries={['/teacher/lessons/local-trial']}><Routes>
    <Route path="/teacher/lessons/:eventId" element={<LessonDetailPage />} />
  </Routes></MemoryRouter></I18nProvider>);
}
async function uploadInput(): Promise<HTMLInputElement> {
  const headings = await screen.findAllByRole('heading', { name: 'Пройденный урок' });
  return headings[0].closest('section')!.querySelector<HTMLInputElement>('input[type=file]')!;
}
describe('native lesson details preserve completed documents', () => {
  it('shows native duration and opens the saved classroom archive', async () => {
    mount();
    expect(await screen.findByText(/· 60 мин/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Открыть PDF ↗' }));
    expect(completedLessonApi.open).toHaveBeenCalledWith('local-trial', 'board-pdf');
    expect(screen.getAllByText(/Записи общей доски\.pdf/).length).toBeGreaterThan(0);
  });
  it('verifies a manual PDF on the existing archive API before reporting success', async () => {
    vi.mocked(completedLessonApi.list).mockResolvedValueOnce([archived]).mockResolvedValue([archived, uploaded]);
    mount(); const file = new File(['%PDF-1.7'], 'Тетрадь.pdf', { type: 'application/pdf' });
    fireEvent.change(await uploadInput(), { target: { files: [file] } });
    await waitFor(() => expect(completedLessonApi.uploadManual).toHaveBeenCalledWith('local-trial', file));
    expect(await screen.findByRole('status')).toHaveTextContent('Файл «Тетрадь.pdf» сохранён');
    expect(completedLessonApi.list).toHaveBeenCalledTimes(2);
  });
  it('keeps an unconfirmed PDF upload as an error', async () => {
    mount(); fireEvent.change(await uploadInput(), { target: { files: [new File(['%PDF-1.7'], 'Тетрадь.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить PDF:');
    expect(completedLessonApi.list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
