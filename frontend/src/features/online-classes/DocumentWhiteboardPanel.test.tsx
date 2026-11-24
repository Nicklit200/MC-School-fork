import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense, useEffect } from 'react';
import { I18nProvider } from '../../i18n/I18nContext';
import { DocumentWhiteboardPanel } from './DocumentWhiteboardPanel';
import { useBoardDocumentState } from './useBoardDocument';
import { kolinApi } from '../../api/kolin';
import { PageAnalysisFeedback, useSavedPageAnalyses } from './SavedPageAnalysis';

const fixtures = vi.hoisted(() => ({ panels: [] as Record<string, any>[], unmounts: vi.fn() }));
vi.mock('../../api/kolin', () => ({ kolinApi: { savedPageAnalyses: vi.fn() } }));
vi.mock('./useBoardDocument', () => ({ useBoardDocumentState: vi.fn() }));
vi.mock('./WhiteboardPanel', () => ({ WhiteboardPanel: (props: Record<string, any>) => {
  fixtures.panels.push(props);
  useEffect(() => () => fixtures.unmounts(props.targetId), []);
  return <div data-testid={props.targetId} />;
} }));
const shared = { pageCount: 4, renderPage: vi.fn(), destroy: vi.fn() };
const worksheet = { pageCount: 1, renderPage: vi.fn(), destroy: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); fixtures.panels.length = 0;
  vi.mocked(kolinApi.savedPageAnalyses).mockResolvedValue([]);
  vi.mocked(useBoardDocumentState).mockReturnValue({ status: 'empty', document: null, version: 0 });
});
afterEach(cleanup);

const wrap = (children: React.ReactNode) => <I18nProvider><Suspense fallback={null}>{children}</Suspense></I18nProvider>;
const myBoard = (extra: Partial<React.ComponentProps<typeof DocumentWhiteboardPanel>> = {}) => <DocumentWhiteboardPanel
  classId="class-1" actorId="teacher" isHost targetId="personal-a" sharedDocument={shared} {...extra} />;

describe('unified My board PDF source', () => {
  it('reuses one parsed common PDF for pupils with no personal assignment', async () => {
    render(wrap(['board-1', 'personal-a', 'personal-b', 'personal-c', 'personal-d'].map(targetId =>
      <DocumentWhiteboardPanel key={targetId} classId="class-1" actorId="teacher" isHost targetId={targetId} sharedDocument={shared} />)));
    await screen.findByTestId('personal-d');
    expect(new Set(vi.mocked(useBoardDocumentState).mock.calls.map(call => call[1]))).toEqual(new Set([
      'personal-workbook-a', 'personal-workbook-b', 'personal-workbook-c', 'personal-workbook-d',
    ]));
    expect(fixtures.panels).toHaveLength(5);
    expect(fixtures.panels.every(panel => panel.document === shared)).toBe(true);
  });

  it('opens the existing private PDF and ink source through the canonical My board', async () => {
    vi.mocked(useBoardDocumentState).mockReturnValue({ status: 'ready', document: worksheet, version: 2 });
    render(wrap(myBoard({ active: false, followStudent: true, observedPages: { 'personal-a': 9, 'personal-workbook-a': 2 } })));
    await screen.findByTestId('personal-workbook-a');
    expect(useBoardDocumentState).toHaveBeenCalledWith('class-1', 'personal-workbook-a', false);
    expect(fixtures.panels.at(-1)).toMatchObject({ document: worksheet, targetId: 'personal-workbook-a', observedPage: 2, followStudent: true });
    expect(screen.queryByTestId('personal-a')).not.toBeInTheDocument();
  });

  it.each(['loading', 'error'] as const)('does not mount or flash the shared source while the personal source is %s', async status => {
    vi.mocked(useBoardDocumentState).mockReturnValue({ status, document: null, version: null });
    render(wrap(myBoard()));
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(fixtures.panels).toHaveLength(0);
  });

  it('changes source with a fresh panel, without forwarding an ordinary page to the assigned PDF', async () => {
    const view = render(wrap(myBoard({ observedPages: { 'personal-a': 8 } })));
    await screen.findByTestId('personal-a');
    vi.mocked(useBoardDocumentState).mockReturnValue({ status: 'ready', document: worksheet, version: 1 });
    view.rerender(wrap(myBoard({ observedPages: { 'personal-a': 8 } })));
    await screen.findByTestId('personal-workbook-a');
    expect(fixtures.unmounts).toHaveBeenCalledWith('personal-a');
    expect(fixtures.panels.at(-1)?.observedPage).toBeUndefined();
    const unmounts = fixtures.unmounts.mock.calls.length;
    vi.mocked(useBoardDocumentState).mockReturnValue({ status: 'ready', document: { ...worksheet, pageCount: 2 }, version: 2 });
    view.rerender(wrap(myBoard()));
    expect(fixtures.unmounts).toHaveBeenCalledTimes(unmounts);
  });

  it('keeps My board blank when there is no shared or personal PDF', async () => {
    render(wrap(myBoard({ sharedDocument: null })));
    await screen.findByTestId('personal-a');
    expect(fixtures.panels.at(-1)?.document).toBeNull();
  });

  it.each([shared, null])('overrides only the assigned pupil’s My board, preserving the others’ shared or blank source', async sharedDocument => {
    vi.mocked(useBoardDocumentState).mockImplementation((_classId, boardId) => boardId === 'personal-workbook-a'
      ? { status: 'ready', document: worksheet, version: 1 }
      : { status: 'empty', document: null, version: 0 });
    render(wrap(<>{myBoard({ sharedDocument })}{myBoard({ targetId: 'personal-b', sharedDocument })}</>));
    await screen.findByTestId('personal-b');
    expect(fixtures.panels.find(panel => panel.targetId === 'personal-workbook-a')?.document).toBe(worksheet);
    expect(fixtures.panels.find(panel => panel.targetId === 'personal-b')?.document).toBe(sharedDocument);
  });

  it('retains shared inheritance outside the pilot and never resolves camera ink as a worksheet', async () => {
    render(wrap(<>{myBoard({ personalWorkbooksEnabled: false })}
      {myBoard({ targetType: 'NOTEBOOK_CAMERA', targetId: 'personal-b' })}</>));
    await screen.findByTestId('personal-b');
    expect(useBoardDocumentState).toHaveBeenCalledExactlyOnceWith('class-1', 'personal-workbook-a', false);
    expect(fixtures.panels.every(panel => panel.document === shared)).toBe(true);
    expect(fixtures.panels.at(-1)?.targetType).toBe('NOTEBOOK_CAMERA');
  });
  it('passes the review capability to the actual private page rail, not an outer pane', async () => {
    render(wrap(myBoard({ automaticPageAnalysisEnabled: true })));
    await screen.findByTestId('personal-a');
    expect(fixtures.panels.at(-1)).toMatchObject({ targetId: 'personal-a', automaticPageAnalysisEnabled: true });
    expect(kolinApi.savedPageAnalyses).not.toHaveBeenCalled();
  });

  it('renders two independent page results from a single authorized workbook poll', async () => {
    vi.mocked(kolinApi.savedPageAnalyses).mockResolvedValue([
      { id: 'one', studentId: 'a', boardId: 'personal-a', pageNumber: 1,
        revision: 5, documentVersion: 0, sharedDocumentVersion: 0, state: 'READY',
        text: '✅ Правильно: $\\frac{1}{2}$\n❌ Ошибка: пропущен знак',
        failureCode: null, capturedAt: '2026-11-24T16:00:00Z', finishedAt: '2026-11-24T16:00:01Z' },
      { id: 'two', studentId: 'a', boardId: 'personal-a', pageNumber: 2,
        revision: 8, documentVersion: 0, sharedDocumentVersion: 0, state: 'READY',
        text: '💡 Совет: проверь вторую строку', failureCode: null,
        capturedAt: '2026-11-24T16:01:00Z', finishedAt: '2026-11-24T16:01:01Z' },
      { id: 'foreign', studentId: 'b', boardId: 'personal-b', pageNumber: 1,
        revision: 1, documentVersion: 0, sharedDocumentVersion: 0, state: 'READY',
        text: 'Foreign private page', failureCode: null,
        capturedAt: '2026-11-24T16:00:00Z', finishedAt: '2026-11-24T16:00:00Z' },
    ]);
    function WorkbookReview() {
      const current = useSavedPageAnalyses('class-1', 'a', 'personal-a', true);
      return <>{[1, 2].map(pageNumber => <article key={pageNumber}>
        <PageAnalysisFeedback current={current} pageNumber={pageNumber} de={false} inline />
      </article>)}</>;
    }
    render(<WorkbookReview />);
    const first = await screen.findByRole('complementary', { name: 'Проверка листа · 1' });
    const second = await screen.findByRole('complementary', { name: 'Проверка листа · 2' });
    await within(first).findByText(/пропущен знак/);
    await within(second).findByText(/проверь вторую строку/);
    expect(first.querySelector('.kolin-rich__callout--correct .mfrac')).not.toBeNull();
    expect(first.querySelector('.kolin-rich__callout--incorrect')).not.toBeNull();
    expect(first).not.toHaveTextContent('Foreign private page');
    expect(second).not.toHaveTextContent('пропущен знак');
    expect(kolinApi.savedPageAnalyses).toHaveBeenCalledTimes(1);
    expect(kolinApi.savedPageAnalyses).toHaveBeenCalledWith('class-1', 'a');
  });

  it('does not enable polling in an unauthorized workbook', () => {
    function DisabledReview() {
      const current = useSavedPageAnalyses('class-1', 'a', 'personal-a', false);
      return <div>{current ? 'Unexpected result' : 'Disabled'}</div>;
    }
    render(<DisabledReview />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(kolinApi.savedPageAnalyses).not.toHaveBeenCalled();
  });

});
