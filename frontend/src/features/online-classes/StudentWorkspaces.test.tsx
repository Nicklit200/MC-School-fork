import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { NotebookCamera } from '../../api/notebookCameras';
import { StudentWorkspaces } from './StudentWorkspaces';
import { personalBoardId } from './boards';

const viewers = vi.hoisted(() => ({ props: new Map<string, { compact: boolean; onVideoAvailableChange: (value: boolean) => void }>() }));
vi.mock('../notebook-camera/NotebookCameraViewer', () => ({
  NotebookCameraViewer: (props: { cameraId: string; compact: boolean; title: string; onVideoAvailableChange: (value: boolean) => void }) => {
    viewers.props.set(props.cameraId, props);
    return <div><iframe title={props.title} data-testid={`camera-${props.cameraId}`} data-compact={String(props.compact)} />
      <div role="alert">Ошибка подключения <button>Повторить</button></div></div>;
  },
}));

const pupils = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина'].map((displayName, index) => ({ userId: `p${index + 1}`, displayName }));
function camera(ownerId: string, cameraId = `camera-${ownerId}`): NotebookCamera {
  return { cameraId, ownerId, ownerName: ownerId, eventId: 'event-1', classId: 'class-1', status: 'CONNECTED',
    pairingExpiresAt: '2030-01-01T00:00:00Z', sessionExpiresAt: '2030-01-01T00:00:00Z' };
}
function surface(props: Partial<ComponentProps<typeof StudentWorkspaces>> = {}) {
  return <StudentWorkspaces students={pupils} camerasByOwner={new Map([['p1', camera('p1')], ['p3', camera('p3')]])}
    activeBoard="all-student-boards" overview visible onSelect={vi.fn()} onOverview={vi.fn()}
    renderBoard={(id, active, compact) => <div data-testid={`board-${id}`} data-active={String(active)} data-compact={String(compact)}>Доска {id}</div>}
    {...props} />;
}
const available = (cameraId: string, value: boolean) => act(() => viewers.props.get(cameraId)!.onVideoAvailableChange(value));
beforeEach(() => viewers.props.clear());

describe('pupil board and camera surfaces', () => {
  it('shows four pupils with their own camera or board, without a fifth tile', () => {
    render(surface());
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(4);
    expect(screen.queryByRole('region', { name: 'Работа ученика: Дина' })).not.toBeInTheDocument();
    available('camera-p1', true); available('camera-p3', true);
    for (const name of ['Анна', 'Вера']) {
      const region = screen.getByRole('region', { name: `Работа ученика: ${name}` });
      expect(within(region).getByText('Камера тетради')).toBeInTheDocument();
    }
    expect(screen.getByTestId('board-p1').parentElement).toHaveAttribute('hidden');
    expect(screen.getByTestId('board-p3').parentElement).toHaveAttribute('hidden');
    expect(screen.getByTestId('board-p2').parentElement).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('board-p4').parentElement).not.toHaveAttribute('hidden');
  });

  it('keeps the same processor and board when going from the overview to a pupil and back', async () => {
    const onSelect = vi.fn(); const onOverview = vi.fn();
    const view = render(surface({ onSelect, onOverview }));
    available('camera-p1', true);
    const processor = screen.getByTestId('camera-camera-p1');
    const board = screen.getByTestId('board-p1');
    await userEvent.click(within(screen.getByRole('region', { name: 'Работа ученика: Анна' })).getByRole('button', { name: 'Открыть' }));
    expect(onSelect).toHaveBeenCalledWith(personalBoardId('p1'));
    view.rerender(surface({ overview: false, activeBoard: personalBoardId('p1'), onOverview }));
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(processor).toHaveAttribute('data-compact', 'false');
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики' }));
    expect(onOverview).toHaveBeenCalledOnce();
    view.rerender(surface());
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(processor).toHaveAttribute('data-compact', 'true');
  });

  it('falls back to the board when the phone stops and automatically resumes its camera', () => {
    render(surface());
    const processor = screen.getByTestId('camera-camera-p1');
    const board = screen.getByTestId('board-p1');
    available('camera-p1', true);
    expect(board.parentElement).toHaveAttribute('hidden');
    available('camera-p1', false);
    expect(board.parentElement).not.toHaveAttribute('hidden');
    expect(processor).toBeInTheDocument();
    expect(processor.closest('.student-workspace__camera')).toHaveClass('student-workspace__camera--waiting');
    expect(within(screen.getByRole('region', { name: 'Работа ученика: Анна' })).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    available('camera-p1', true);
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(board.parentElement).toHaveAttribute('hidden');
  });

  it('removes a revoked camera and keeps its board, ignoring camera owners outside the roster', () => {
    const cameras = new Map([['p1', camera('p1')], ['outsider', camera('outsider')]]);
    const view = render(surface({ camerasByOwner: cameras }));
    available('camera-p1', true);
    expect(screen.queryByTestId('camera-camera-outsider')).not.toBeInTheDocument();
    const board = screen.getByTestId('board-p1');
    view.rerender(surface({ camerasByOwner: new Map() }));
    expect(screen.queryByTestId('camera-camera-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(board.parentElement).not.toHaveAttribute('hidden');
  });

  it('listens for a camera before opening a pupil and retains it while the shared board is shown', () => {
    const view = render(surface({ visible: false, overview: false, activeBoard: 'board-1' }));
    const processor = screen.getByTestId('camera-camera-p1');
    expect(screen.queryByTestId('board-p1')).not.toBeInTheDocument();
    available('camera-p1', true);
    view.rerender(surface({ overview: false, activeBoard: personalBoardId('p1') }));
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(screen.queryByTestId('board-p1')).not.toBeInTheDocument();
    view.rerender(surface({ visible: false, overview: false, activeBoard: 'board-1' }));
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    view.rerender(surface({ overview: false, activeBoard: personalBoardId('p1') }));
    expect(within(screen.getByRole('region', { name: 'Работа ученика: Анна' })).queryByText('Доска')).not.toBeInTheDocument();
  });

  it('can open a pupil beyond the four-person overview and never mixes their cameras', () => {
    const cameras = new Map([['p1', camera('p1')], ['p5', camera('p5')]]);
    const view = render(surface({ camerasByOwner: cameras }));
    available('camera-p1', true); available('camera-p5', true);
    view.rerender(surface({ camerasByOwner: cameras, overview: false, activeBoard: personalBoardId('p5') }));
    const dina = screen.getByRole('region', { name: 'Работа ученика: Дина' });
    expect(within(dina).getByTitle('Тетрадь ученика: Дина')).toBeInTheDocument();
    expect(within(dina).queryByTitle('Тетрадь ученика: Анна')).not.toBeInTheDocument();
  });
});
