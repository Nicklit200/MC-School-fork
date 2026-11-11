// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminWorkbookStudioPage } from './AdminWorkbookStudioPage';
import { workbookStudioApi } from '../../api/workbookStudio';

vi.mock('../../api/workbookStudio', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/workbookStudio')>();
  return { ...original, workbookStudioApi: {
    get: vi.fn(), example: vi.fn(), save: vi.fn(), render: vi.fn(),
  }};
});

const makeDocument = (title: string) => ({
  meta: { school: 'MINDCRAFTI SCHOOL', durationMinutes: 60 },
  workbookPages: [{ title, blocks: [{ type: 'exercise', number: '01', title: 'Aufgabe', rows: [{ label: 'a.', math: ['1', '+', '1', '='] }] }] }],
  teacherPages: [{ title: 'Lehrerloesungen', blocks: [{ type: 'solutions', items: [{ label: '1a', math: ['1', '+', '1', '=', '2'] }] }] }],
});

beforeEach(() => {
  vi.mocked(workbookStudioApi.get).mockResolvedValue({ configured: true, version: 2, updatedAt: null, projectJson: JSON.stringify({
    schema: 'mindcrafti.workbook-studio/1',
    activeTemplateId: 'math',
    templates: [{ id: 'math', name: 'Mathematik', document: makeDocument('Alter Titel') }],
  }) });
  vi.mocked(workbookStudioApi.render).mockImplementation(() => new Promise(() => {}));
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Workbook Studio apply behavior', () => {
  it('shows saved JSON on the left before PDF generation', async () => {
    render(<AdminWorkbookStudioPage />);
    expect(await screen.findByText('Alter Titel')).toBeTruthy();
    expect(workbookStudioApi.render).not.toHaveBeenCalled();
  });

  it('applies new code to immediate outline and starts PDF render with the new document', async () => {
    render(<AdminWorkbookStudioPage />);
    await screen.findByText('Alter Titel');
    const input = screen.getByLabelText('JSON тетради') as HTMLTextAreaElement;
    const next = makeDocument('Новый заголовок');
    await act(async () => { fireEvent.change(input, { target: { value: JSON.stringify(next) } }); });
    fireEvent.click(screen.getByRole('button', { name: 'Применить код и показать тетрадь' }));
    expect(await screen.findByText('Новый заголовок')).toBeTruthy();
    expect(screen.queryByText('Alter Titel')).toBeNull();
    await waitFor(() => expect(workbookStudioApi.render).toHaveBeenCalledWith(JSON.stringify(next)));
  });

  it('reports invalid JSON and never starts a render', async () => {
    render(<AdminWorkbookStudioPage />);
    await screen.findByText('Alter Titel');
    fireEvent.change(screen.getByLabelText('JSON тетради'), { target: { value: '{not-json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Применить код и показать тетрадь' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(workbookStudioApi.render).not.toHaveBeenCalled();
    expect(screen.getByText('Alter Titel')).toBeTruthy();
  });
});
