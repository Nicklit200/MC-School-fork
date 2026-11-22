import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { requestBlob } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { WorkbookDraftPreviewPage } from './WorkbookDraftPreviewPage';

vi.mock('../../api/client', () => ({ requestBlob: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));

function renderPreview() {
  return render(
    <MemoryRouter initialEntries={['/workbook-drafts/teacher-id/draft-id']}>
      <Routes>
        <Route path="/workbook-drafts/:teacherId/:draftId" element={<WorkbookDraftPreviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('stable in-site workbook draft PDF preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true, value: vi.fn(() => 'blob:mindcrafti-pdf'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true, value: vi.fn(),
    });
    vi.mocked(requestBlob).mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'teacher-id', role: 'TEACHER' },
      initializing: false,
    } as ReturnType<typeof useAuth>);
  });

  it('fetches PDFs using the authenticated API each time the stable page opens', async () => {
    renderPreview();
    expect(await screen.findByTitle('PDF рабочей тетради')).toBeInTheDocument();
    await waitFor(() => expect(requestBlob).toHaveBeenCalledTimes(2));
    expect(requestBlob).toHaveBeenNthCalledWith(1, '/workbook-drafts/teacher-id/draft-id/workbook');
    expect(requestBlob).toHaveBeenNthCalledWith(2, '/workbook-drafts/teacher-id/draft-id/answers');
    await userEvent.click(screen.getByRole('button', { name: 'Ответы' }));
    expect(screen.getByTitle('PDF ответов преподавателя')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Скачать PDF' })).toHaveAttribute('download', 'Mindcrafti_Lehrerloesungen.pdf');
  });

  it('does not fetch another teachers private draft', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'different-teacher', role: 'TEACHER' },
      initializing: false,
    } as ReturnType<typeof useAuth>);
    renderPreview();
    expect(screen.getByRole('alert')).toHaveTextContent('доступен только');
    expect(requestBlob).not.toHaveBeenCalled();
  });
});
