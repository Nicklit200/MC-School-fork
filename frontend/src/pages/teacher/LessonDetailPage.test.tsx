import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { completedLessonApi, lessonPreparationApi, type CompletedLessonDocument } from '../../api/lessonPreparation';
import type { LessonPreparation } from '../../api/types';
import { I18nProvider } from '../../i18n/I18nContext';
import { LessonDetailPage } from './LessonDetailPage';

const currentUser = vi.hoisted(() => ({ id: 'regular-teacher' }));

vi.mock('../../api/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api,
    lessons: { ...actual.api.lessons, groupLessons: vi.fn() },
    students: { ...actual.api.students, list: vi.fn() },
  } };
});
vi.mock('../../api/lessonPreparation', async importOriginal => {
  const actual = await importOriginal<typeof import('../../api/lessonPreparation')>();
  return { ...actual, lessonPreparationApi: { ...actual.lessonPreparationApi, get: vi.fn(), update: vi.fn() },
    completedLessonApi: { ...actual.completedLessonApi, list: vi.fn(), uploadManual: vi.fn(), open: vi.fn() } };
});
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: currentUser.id, role: 'TEACHER' } }) }));
vi.mock('./GoogleDrivePdfPicker', () => ({ GoogleDrivePdfPicker: () => null }));
vi.mock('../../api/aiPilot', () => ({ aiPilotApi: { status: vi.fn(async () => ({ configured: false, model: '' })) } }));
vi.mock('../../features/online-classes/LessonClassArtifacts', () => ({ LessonClassArtifacts: () => null }));
vi.mock('../../features/online-classes/StartOnlineClassButton', () => ({ StartOnlineClassButton: () => <button type="button">Начать онлайн-урок</button> }));

const archived: CompletedLessonDocument = { id: 'board-pdf', classId: 'class-1', boardId: 'board-1', filename: 'Записи общей доски.pdf', savedAt: '2026-10-23T15:00:00Z' };
const uploaded: CompletedLessonDocument = { ...archived, id: 'manual-pdf', boardId: 'manual-shared', filename: 'Тетрадь.pdf' };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); localStorage.setItem('language', 'RU');
  currentUser.id = 'regular-teacher';
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
afterEach(() => vi.unstubAllEnvs());
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
    expect(await screen.findByText(/02:00/)).toBeInTheDocument();
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
  it('loads and saves covered material through the existing lesson preparation endpoint', async () => {
    const preparation = { eventId: 'local-trial', coveredMaterial: 'Повторили дроби', hasWorkbook: false, hasAnswers: false, hasTranscript: false } as LessonPreparation;
    vi.mocked(lessonPreparationApi.get).mockResolvedValue(preparation);
    vi.mocked(lessonPreparationApi.update).mockResolvedValue({ ...preparation, coveredMaterial: 'Дроби и уравнения' });
    mount();
    const material = await screen.findByRole('textbox', { name: 'Пройденный материал' });
    expect(material).toHaveValue('Повторили дроби');
    fireEvent.change(material, { target: { value: 'Дроби и уравнения' } });
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить информацию' }));
    await waitFor(() => expect(lessonPreparationApi.update).toHaveBeenCalledWith('local-trial', {
      coveredMaterial: 'Дроби и уравнения', homeworkNotes: '', difficulties: '', lessonPlan: '', transcriptText: '',
    }));
    expect(await screen.findByText('Информация для урока сохранена.')).toBeInTheDocument();
  });
  it('keeps the board available but requires an assigned pupil before starting trial video', async () => {
    currentUser.id = '14e3c7c1-1fc8-41bd-858a-6c20efdd957a';
    vi.stubEnv('VITE_MINDCRAFTI_LIVEKIT_ENABLED', 'true');
    vi.stubEnv('VITE_MINDCRAFTI_ONLINE_ENABLED', 'true');
    mount();
    expect(await screen.findByText('Для подключения ученика назначьте его этому уроку')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать онлайн-урок' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mindcrafti доска (тест)' })).toHaveAttribute('href', '/lesson-board/local-trial');
  });
});
