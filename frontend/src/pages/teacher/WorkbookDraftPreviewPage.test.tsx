import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { requestBlob } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { WorkbookDraftPreviewPage } from './WorkbookDraftPreviewPage';

vi.mock('../../api/client', () => ({ requestBlob: vi.fn() }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }));
// The canvas renderer has its own tests for real pdf.js page navigation.
// Here verify that the staff preview uses it instead of an iOS-blank iframe.
vi.mock('./PostLessonHomeworkPdfCanvas', () => ({
  PostLessonHomeworkPdfCanvas: ({ blob }: { blob: Blob }) =>
    <div data-testid="workbook-pdf-canvas" data-mime={blob.type}>Rendered PDF</div>,
}));

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
    expect(await screen.findByTestId('workbook-pdf-canvas')).toBeInTheDocument();
    expect(screen.queryByTitle('PDF рабочей тетради')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByTestId('workbook-pdf-canvas')).toHaveAttribute('data-mime', 'application/pdf');
    await waitFor(() => expect(requestBlob).toHaveBeenCalledTimes(2));
    expect(requestBlob).toHaveBeenNthCalledWith(1, '/workbook-drafts/teacher-id/draft-id/workbook');
    expect(requestBlob).toHaveBeenNthCalledWith(2, '/workbook-drafts/teacher-id/draft-id/answers');
    await userEvent.click(screen.getByRole('button', { name: 'Ответы' }));
    expect(screen.getByTestId('workbook-pdf-canvas')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
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
