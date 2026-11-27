import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { NotebookCamera } from '../../api/notebookCameras';
import type { NotebookCameraVideoSource } from '../notebook-camera/NotebookCameraViewer';
import type { CameraModule } from '../notebook-camera/cameraModules';
import { StudentWorkspaces } from './StudentWorkspaces';
import { personalBoardId } from './boards';

const viewers = vi.hoisted(() => ({ props: new Map<string, {
  compact: boolean; presentation: string;
  onVideoAvailableChange: (value: boolean) => void;
  onBoardVideoChange: (value: NotebookCameraVideoSource | null) => void;
}>() }));
vi.mock('../notebook-camera/NotebookCameraViewer', () => ({
  NotebookCameraViewer: (props: { cameraId: string; compact: boolean; title: string } & ReturnType<typeof viewers.props.get>) => {
    viewers.props.set(props.cameraId, props);
    return <div><video title={props.title} data-testid={`camera-${props.cameraId}`} data-compact={String(props.compact)} />
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
    renderBoard={(id, active, compact, following) => <div data-testid={`board-${id}`}
      data-active={String(active)} data-compact={String(compact)} data-following={String(following)}>Доска {id}</div>}
    renderCameraBoard={(id, active, compact, source, following) => <div data-testid={`camera-board-${id}`}
      data-active={String(active)} data-compact={String(compact)} data-source={String(Boolean(source))}
      data-following={String(following)}>Тетрадь {id}</div>}
    {...props} />;
}
function cameraSource(overrides: Partial<NotebookCameraVideoSource> = {}): NotebookCameraVideoSource {
  return { video: document.createElement('canvas'), width: 1080, height: 1920,
    rawVideo: document.createElement('video'), rawWidth: 1920, rawHeight: 1080,
    view: { type: 'document-view', version: 1, corners: null, ratio: null, turn: 1, sourceAspect: 16 / 9 },
    renderer: {} as CameraModule, ...overrides };
}
const available = (cameraId: string, value: boolean) => act(() => {
  viewers.props.get(cameraId)!.onVideoAvailableChange(value);
  viewers.props.get(cameraId)!.onBoardVideoChange(value ? cameraSource() : null);
});
beforeEach(() => viewers.props.clear());

describe('pupil board and camera surfaces', () => {
  it('shows four pupils with their own camera or board, without a fifth tile', () => {
    render(surface());
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(4);
    expect(screen.queryByRole('region', { name: 'Работа ученика: Дина' })).not.toBeInTheDocument();
    available('camera-p1', true); available('camera-p3', true);
    for (const name of ['Анна', 'Вера']) {
      const region = screen.getByRole('region', { name: `Работа ученика: ${name}` });
      expect(within(region).getByRole('button', { name: 'Проверить тетрадь: ' + name })).toBeInTheDocument();
    }
    expect(screen.getByTestId('board-p1').parentElement).toHaveAttribute('hidden');
    expect(screen.getByTestId('board-p3').parentElement).toHaveAttribute('hidden');
    expect(screen.getByTestId('board-p2').parentElement).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('board-p4').parentElement).not.toHaveAttribute('hidden');
  });

  it('sizes the overview for one, two or four actual pupils rather than reserving empty rows', () => {
    const { container, rerender } = render(surface({ students: pupils.slice(0, 2), camerasByOwner: new Map() }));
    const overview = () => container.querySelector('.student-workspaces--overview');
    expect(overview()).toHaveAttribute('data-overview-count', '2');
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(2);
    rerender(surface({ students: pupils.slice(0, 1), camerasByOwner: new Map() }));
    expect(overview()).toHaveAttribute('data-overview-count', '1');
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(1);
    rerender(surface({ students: pupils.slice(0, 4), camerasByOwner: new Map() }));
    expect(overview()).toHaveAttribute('data-overview-count', '4');
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(4);
  });

  it('puts an individual check button in each pupil header and checks only that pupil', async () => {
    const user = userEvent.setup();
    const onCheck = vi.fn().mockResolvedValue({ checked: 2, skipped: 1, failed: 0 });
    render(surface({ camerasByOwner: new Map(), onCheck }));
    const anna = screen.getByRole('region', { name: 'Работа ученика: Анна' });
    const boris = screen.getByRole('region', { name: 'Работа ученика: Борис' });
    const button = within(anna).getByRole('button', { name: 'Проверить тетрадь: Анна' });
    expect(button.parentElement).toBe(anna.querySelector('.online-class-room__student-tile-header'));
    expect(within(anna).queryByText('Доска', { exact: true })).not.toBeInTheDocument();
    await user.click(button);
    expect(onCheck).toHaveBeenCalledExactlyOnceWith('p1');
    expect(await within(anna).findByRole('status')).toHaveTextContent('Проверено: 2, пропущено: 1');
    expect(within(boris).queryByRole('status')).not.toBeInTheDocument();
    await user.click(within(boris).getByRole('button', { name: 'Проверить тетрадь: Борис' }));
    expect(onCheck).toHaveBeenLastCalledWith('p2');
  });

  it('disables each check button while the lesson board is being archived', () => {
    render(surface({ camerasByOwner: new Map(), onCheck: vi.fn(), checkDisabled: true }));
    for (const name of ['Анна', 'Борис', 'Вера', 'Глеб']) {
      expect(screen.getByRole('button', { name: 'Проверить тетрадь: ' + name })).toBeDisabled();
    }
  });

  it('starts with independent views and toggles follow for only the selected pupil', async () => {
    const user = userEvent.setup();
    render(surface({ camerasByOwner: new Map() }));
    const anna = screen.getByRole('button', { name: 'Следовать за учеником: Анна' });
    const boris = screen.getByRole('button', { name: 'Следовать за учеником: Борис' });
    const board = screen.getByTestId('board-p1');
    for (const button of screen.getAllByRole('button', { name: /^Следовать за учеником:/ })) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
    for (const pupil of pupils.slice(0, 4)) {
      expect(screen.getByTestId(`board-${pupil.userId}`)).toHaveAttribute('data-following', 'false');
    }

    await user.click(anna);
    expect(anna).toHaveAttribute('aria-pressed', 'true');
    expect(anna).toHaveTextContent('Слежение включено');
    expect(board).toHaveAttribute('data-following', 'true');
    expect(boris).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('board-p2')).toHaveAttribute('data-following', 'false');
    await user.click(boris);
    await user.click(anna);
    expect(anna).toHaveAttribute('aria-pressed', 'false');
    expect(board).toHaveAttribute('data-following', 'false');
    expect(boris).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('board-p2')).toHaveAttribute('data-following', 'true');
    expect(screen.getByTestId('board-p1')).toBe(board);
  });

  it('retains each follow choice when opening a pupil, another pupil or the shared board', async () => {
    const user = userEvent.setup();
    const { rerender } = render(surface({ camerasByOwner: new Map() }));
    const board = screen.getByTestId('board-p1');
    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Анна' }));
    rerender(surface({ camerasByOwner: new Map(), overview: false, activeBoard: personalBoardId('p1') }));
    expect(screen.getByRole('button', { name: 'Следовать за учеником: Анна' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(board).toHaveAttribute('data-compact', 'false');

    rerender(surface({ camerasByOwner: new Map(), overview: false, activeBoard: personalBoardId('p2') }));
    expect(screen.getByRole('button', { name: 'Следовать за учеником: Борис' })).toHaveAttribute('aria-pressed', 'false');
    expect(board).toHaveAttribute('data-following', 'true');
    rerender(surface({ camerasByOwner: new Map(), visible: false, overview: false, activeBoard: 'board-1' }));
    expect(board).toHaveAttribute('data-following', 'true');

    rerender(surface({ camerasByOwner: new Map() }));
    expect(screen.getByRole('button', { name: 'Следовать за учеником: Анна' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(board).toHaveAttribute('data-compact', 'true');
    rerender(surface({ camerasByOwner: new Map(), overview: false, activeBoard: personalBoardId('p1') }));
    await user.click(screen.getByRole('button', { name: 'Следовать за учеником: Анна' }));
    expect(board).toHaveAttribute('data-following', 'false');
  });

  it('uses the same pupil follow choice for paper and camera without remounting either board', async () => {
    const user = userEvent.setup();
    render(surface());
    const board = screen.getByTestId('board-p1');
    const follow = screen.getByRole('button', { name: 'Следовать за учеником: Анна' });
    await user.click(follow);
    available('camera-p1', true);
    available('camera-p3', true);
    const cameraBoard = screen.getByTestId('camera-board-p1');
    expect(cameraBoard).toHaveAttribute('data-following', 'true');
    expect(screen.getByTestId('camera-board-p3')).toHaveAttribute('data-following', 'false');
    await user.click(follow);
    expect(cameraBoard).toHaveAttribute('data-following', 'false');
    expect(board).toHaveAttribute('data-following', 'false');
    await user.click(follow);
    available('camera-p1', false);
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(board).toHaveAttribute('data-following', 'true');
    available('camera-p1', true);
    expect(screen.getByTestId('camera-board-p1')).toBe(cameraBoard);
    expect(cameraBoard).toHaveAttribute('data-following', 'true');
  });

  it('keeps the same video, camera annotation board and ordinary board between overview and pupil views', async () => {
    const onSelect = vi.fn(); const onOverview = vi.fn();
    const view = render(surface({ onSelect, onOverview }));
    available('camera-p1', true);
    const processor = screen.getByTestId('camera-camera-p1');
    const board = screen.getByTestId('board-p1');
    const cameraBoard = screen.getByTestId('camera-board-p1');
    expect(viewers.props.get('camera-p1')!.presentation).toBe('board');
    await userEvent.click(within(screen.getByRole('region', { name: 'Работа ученика: Анна' })).getByRole('button', { name: 'Открыть' }));
    expect(onSelect).toHaveBeenCalledWith(personalBoardId('p1'));
    view.rerender(surface({ overview: false, activeBoard: personalBoardId('p1'), onOverview }));
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(processor).toHaveAttribute('data-compact', 'false');
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(screen.getByTestId('camera-board-p1')).toBe(cameraBoard);
    expect(cameraBoard).toHaveAttribute('data-active', 'true');
    expect(cameraBoard).toHaveAttribute('data-compact', 'false');
    expect(screen.getAllByRole('region', { name: /Работа ученика:/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики' }));
    expect(onOverview).toHaveBeenCalledOnce();
    view.rerender(surface());
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(processor).toHaveAttribute('data-compact', 'true');
    expect(screen.getByTestId('camera-board-p1')).toBe(cameraBoard);
  });

  it('falls back to the board when the phone stops and automatically resumes its camera', () => {
    render(surface());
    const processor = screen.getByTestId('camera-camera-p1');
    const board = screen.getByTestId('board-p1');
    available('camera-p1', true);
    const cameraBoard = screen.getByTestId('camera-board-p1');
    expect(board.parentElement).toHaveAttribute('hidden');
    available('camera-p1', false);
    expect(board.parentElement).not.toHaveAttribute('hidden');
    expect(cameraBoard.parentElement).toHaveAttribute('hidden');
    expect(cameraBoard).toHaveAttribute('data-active', 'false');
    expect(cameraBoard).toHaveAttribute('data-source', 'false');
    expect(processor).toBeInTheDocument();
    expect(processor.closest('.student-workspace__camera')).toHaveClass('student-workspace__camera--waiting');
    expect(within(screen.getByRole('region', { name: 'Работа ученика: Анна' })).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    available('camera-p1', true);
    expect(screen.getByTestId('camera-camera-p1')).toBe(processor);
    expect(board.parentElement).toHaveAttribute('hidden');
    expect(screen.getByTestId('camera-board-p1')).toBe(cameraBoard);
  });

  it('removes a revoked camera and keeps its board, ignoring camera owners outside the roster', () => {
    const cameras = new Map([['p1', camera('p1')], ['outsider', camera('outsider')]]);
    const view = render(surface({ camerasByOwner: cameras }));
    available('camera-p1', true);
    expect(screen.queryByTestId('camera-camera-outsider')).not.toBeInTheDocument();
    const board = screen.getByTestId('board-p1');
    const cameraBoard = screen.getByTestId('camera-board-p1');
    view.rerender(surface({ camerasByOwner: new Map() }));
    expect(screen.queryByTestId('camera-camera-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('board-p1')).toBe(board);
    expect(board.parentElement).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('camera-board-p1')).toBe(cameraBoard);
    expect(cameraBoard.parentElement).toHaveAttribute('hidden');
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
    expect(within(dina).getByTestId('camera-board-p5')).toHaveAttribute('data-source', 'true');
    expect(within(dina).queryByTestId('camera-board-p1')).not.toBeInTheDocument();
  });

  it('waits for an actual video frame before replacing paper and ignores a revoked camera source', () => {
    const view = render(surface());
    act(() => viewers.props.get('camera-p1')!.onVideoAvailableChange(true));
    expect(screen.getByTestId('board-p1').parentElement).not.toHaveAttribute('hidden');
    expect(screen.queryByTestId('camera-board-p1')).not.toBeInTheDocument();
    available('camera-p1', true);
    view.rerender(surface({ camerasByOwner: new Map([['p1', camera('p1', 'replacement')]]) }));
    expect(screen.getByTestId('board-p1').parentElement).not.toHaveAttribute('hidden');
    act(() => viewers.props.get('camera-p1')!.onBoardVideoChange(cameraSource()));
    expect(screen.getByTestId('camera-board-p1').parentElement).toHaveAttribute('hidden');
    available('replacement', true);
    expect(screen.getByTestId('camera-board-p1').parentElement).not.toHaveAttribute('hidden');
  });

  it('forwards each owner’s raw geometry and updates rotation when processed dimensions stay the same', () => {
    const sources = new Map<string, NotebookCameraVideoSource | null>();
    render(surface({ renderCameraBoard: (id, _active, _compact, source) => {
      sources.set(id, source); return <div data-testid={`camera-board-${id}`} />;
    } }));
    const anna = cameraSource(), vera = cameraSource();
    act(() => {
      viewers.props.get('camera-p1')!.onVideoAvailableChange(true);
      viewers.props.get('camera-p1')!.onBoardVideoChange(anna);
      viewers.props.get('camera-p3')!.onVideoAvailableChange(true);
      viewers.props.get('camera-p3')!.onBoardVideoChange(vera);
    });
    const board = screen.getByTestId('camera-board-p1');
    expect(sources.get('p1')).toBe(anna); expect(sources.get('p3')).toBe(vera);
    expect(anna.rawVideo).not.toBe(vera.rawVideo);
    const rotated = { ...anna, view: { ...anna.view, turn: 3 } };
    act(() => viewers.props.get('camera-p1')!.onBoardVideoChange(rotated));
    expect(sources.get('p1')).toBe(rotated); expect(sources.get('p3')).toBe(vera);
    expect(sources.get('p1')!.video).toBe(anna.video);
    expect(sources.get('p1')!.rawVideo).toBe(anna.rawVideo);
    expect(sources.get('p1')!.rawWidth).toBe(1920); expect(sources.get('p1')!.rawHeight).toBe(1080);
    expect(screen.getByTestId('camera-board-p1')).toBe(board);
  });
});
