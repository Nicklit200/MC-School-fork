import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CompletedLessonReportDialog } from './CompletedLessonReportDialog';
import { onlineClassesApi, type CompletedLessonReportJob } from '../../api/onlineClasses';

vi.mock('../../api/onlineClasses', () => ({
  onlineClassesApi: {
    findByEvent: vi.fn(), completedLessonReportRecipients: vi.fn(), completedLessonReports: vi.fn(),
    createCompletedLessonReport: vi.fn(), completedLessonReportPdf: vi.fn(),
  },
}));
const completed: CompletedLessonReportJob = {
  id: 'report-1', state: 'DONE', createdAt: '2026-11-24T17:00:00Z',
  report: { studentId: 'mark', studentName: 'Марк', state: 'READY', detail: '',
    archivedPdfs: 1, verifiedInkPages: 2, verifiedSpeech: true,
    observations: [{ skillId: 's1', skillTitle: 'Дроби', autonomy: 'INDEPENDENT', correctness: 'CORRECT',
      origin: 'WRITING', correctExamples: 2, confidence: 98, explanation: 'Решил пример самостоятельно.',
      excerpt: '1/4 + 1/6 = 5/12', sourceBoardId: 'personal-mark', pageNumber: 4 }] },
};
beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  vi.mocked(onlineClassesApi.findByEvent).mockResolvedValue([
    { id: 'old', status: 'ENDED', scheduledEndAt: '2026-11-23T17:00:00Z' },
    { id: 'latest', status: 'ENDED', scheduledEndAt: '2026-11-24T17:00:00Z' },
  ] as never);
  vi.mocked(onlineClassesApi.completedLessonReportRecipients).mockResolvedValue([{ id: 'mark', name: 'Марк' }]);
  vi.mocked(onlineClassesApi.completedLessonReports).mockResolvedValue([]);
  vi.mocked(onlineClassesApi.createCompletedLessonReport).mockResolvedValue(completed);
});
const mount = () => render(<CompletedLessonReportDialog eventId="event-1" title="Математика" de={false} onClose={vi.fn()}/>);
describe('manual completed lesson report', () => {
  it('uses the most recent completed room, selected pupil and optional prompt', async () => {
    mount();
    await screen.findByRole('option', { name: 'Марк' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Создать документ' })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox', { name: 'Промпт генератора' }), { target: { value: 'Покажи ошибки' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать документ' }));
    await waitFor(() => expect(onlineClassesApi.createCompletedLessonReport)
      .toHaveBeenCalledWith('latest', 'mark', expect.any(String), 'Покажи ошибки'));
    expect(await screen.findByText('1/4 + 1/6 = 5/12')).toBeInTheDocument();
    expect(screen.getByText(/Личная доска, страница 4/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать PDF' })).toBeInTheDocument();
  });
  it('shows the existing pending job and does not enqueue a duplicate', async () => {
    vi.mocked(onlineClassesApi.completedLessonReports).mockResolvedValue([{ id: 'running', state: 'RUNNING', createdAt: completed.createdAt }]);
    mount();
    await screen.findByText('Анализируется урок');
    expect(screen.getByRole('button', { name: 'Создать новый отчёт' })).toBeDisabled();
    expect(onlineClassesApi.createCompletedLessonReport).not.toHaveBeenCalled();
  });
  it('does not allow generation for an unfinished room', async () => {
    vi.mocked(onlineClassesApi.findByEvent).mockResolvedValue([{ id: 'live', status: 'ACTIVE' }] as never);
    mount();
    expect(await screen.findByText('Сначала завершите онлайн-урок.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Создать документ' })).toBeDisabled();
    expect(onlineClassesApi.completedLessonReportRecipients).not.toHaveBeenCalled();
  });
});
