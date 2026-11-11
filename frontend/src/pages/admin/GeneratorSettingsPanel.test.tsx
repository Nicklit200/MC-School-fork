// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorSettingsPanel } from './GeneratorSettingsPanel';
import { generatorLayoutApi, type GeneratorLayoutState } from '../../api/generatorLayout';

vi.mock('../../api/generatorLayout', () => ({
  generatorLayoutApi: { get: vi.fn(), saveDraft: vi.fn(), test: vi.fn(), activate: vi.fn(), rollback: vi.fn() },
}));

const draft = {
  schema: 'mindcrafti.generator-layout/1', graphHeightMm: 68, graphWidthPercent: 100,
  graphPlotScalePercent: 100, graphAlignment: 'center', blockGapMm: 3.6,
  answerSpacePercent: 100, taskTitleFontPx: 14,
};
const saved: GeneratorLayoutState = {
  draftRevision: 2, activeRevision: 3, testedRevision: -1,
  draftJson: JSON.stringify(draft), activeJson: JSON.stringify(draft),
  canActivate: false, canRollback: true, updatedAt: '2026-11-11T09:00:00Z',
};
const doc = {
  meta: { school: 'MINDCRAFTI SCHOOL', durationMinutes: 60 },
  workbookPages: [{ blocks: [{ type: 'exercise', rows: [{ math: ['1','+','2'] }] }] }],
  teacherPages: [{ blocks: [{ type: 'solutions',items: [{ math: ['1','+','2','=','3'] }] }] }],
};

beforeEach(() => {
  vi.mocked(generatorLayoutApi.get).mockResolvedValue(saved);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('global generator profile controls', () => {
  it('does not activate a draft merely because a slider is changed', async () => {
    render(<GeneratorSettingsPanel currentDocument={doc} />);
    await screen.findByText('Высота графика');
    fireEvent.change(screen.getByLabelText('Высота графика'), { target: { value: '78' } });
    expect(screen.getByText('78 мм')).toBeTruthy();
    expect(generatorLayoutApi.activate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Утвердить для будущих генераций' }).hasAttribute('disabled')).toBe(true);
  });

  it('saves the draft separately from future lesson activation', async () => {
    vi.mocked(generatorLayoutApi.saveDraft).mockResolvedValue({
      ...saved, draftRevision: 3, draftJson: JSON.stringify({ ...draft, graphHeightMm: 78 }),
    });
    render(<GeneratorSettingsPanel currentDocument={doc} />);
    await screen.findByText('Высота графика');
    fireEvent.change(screen.getByLabelText('Высота графика'), { target: { value: '78' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(generatorLayoutApi.saveDraft).toHaveBeenCalledWith(
      2, expect.objectContaining({ graphHeightMm: 78 })));
    expect(generatorLayoutApi.activate).not.toHaveBeenCalled();
  });

  it('requires current PDF test before enabling approval', async () => {
    vi.mocked(generatorLayoutApi.test).mockResolvedValue({
      studentPdfBase64: 'JVBERg==', teacherPdfBase64: 'JVBERg==', studentPages: 1,
      teacherPages: 1, qa: { mathPassed: true, layoutPassed: true },
      settings: { ...saved, testedRevision: 2, canActivate: true,
        activeJson: JSON.stringify({ ...draft, graphHeightMm: 74 }) },
    });
    render(<GeneratorSettingsPanel currentDocument={doc} />);
    await screen.findByText('Высота графика');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Проверить на тетради' }));
    });
    expect(generatorLayoutApi.test).toHaveBeenCalledWith(2, JSON.stringify(doc));
    expect(screen.getByRole('button', { name: 'Утвердить для будущих генераций' }).hasAttribute('disabled')).toBe(false);
  });
});
