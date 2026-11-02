import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Suspense } from 'react';
import { DocumentWhiteboardPanel } from './DocumentWhiteboardPanel';
import { useBoardDocument } from './useBoardDocument';

const fixtures = vi.hoisted(() => ({ panels: [] as Record<string, any>[] }));
vi.mock('./useBoardDocument', () => ({ useBoardDocument: vi.fn() }));
vi.mock('./WhiteboardPanel', () => ({ WhiteboardPanel: (props: Record<string, any>) => {
  fixtures.panels.push(props);
  return <div data-testid={props.targetId} />;
} }));
const shared = { pageCount: 4, renderPage: vi.fn(), destroy: vi.fn() };
const worksheet = { pageCount: 1, renderPage: vi.fn(), destroy: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); fixtures.panels.length = 0; vi.mocked(useBoardDocument).mockReturnValue(worksheet); });
afterEach(cleanup);

describe('classroom PDF sharing', () => {
  it('reuses one parsed common PDF across the shared board and ordinary pupil boards', async () => {
    render(<Suspense fallback={null}>{['board-1', 'personal-a', 'personal-b', 'personal-c', 'personal-d'].map(targetId =>
      <DocumentWhiteboardPanel key={targetId} classId="class-1" actorId="teacher" isHost targetId={targetId} sharedDocument={shared} />)}</Suspense>);
    await screen.findByTestId('personal-d');
    expect(useBoardDocument).not.toHaveBeenCalled();
    expect(fixtures.panels).toHaveLength(5);
    expect(fixtures.panels.every(panel => panel.document === shared)).toBe(true);
  });

  it('loads only the worksheet’s own private PDF with its own active state', async () => {
    render(<Suspense fallback={null}><DocumentWhiteboardPanel classId="class-1" actorId="teacher" isHost targetId="personal-workbook-a" sharedDocument={shared} active={false} /></Suspense>);
    await screen.findByTestId('personal-workbook-a');
    expect(useBoardDocument).toHaveBeenCalledWith('class-1', 'personal-workbook-a', false);
    expect(fixtures.panels.at(-1)?.document).toBe(worksheet);
  });
});
