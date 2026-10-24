import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { BoardToolbar } from './BoardToolbar';
import { DEFAULT_TOOL_SETTINGS, clickTool, hasSettings, type ToolSettings } from './boardTools';
import type { EraserMode, Tool } from './WhiteboardCanvas';

function Harness({
  onSettings = vi.fn(),
  onEraserMode = vi.fn(),
  onInputMode = vi.fn(),
  hostActions,
  sharedActions,
  fileAction,
  onAddPage,
  addPageDisabled,
  primaryActions,
  canUndo = false,
  canRedo = false,
  onUndo = vi.fn(),
  onRedo = vi.fn(),
  onClearMine = vi.fn(),
}: {
  onSettings?: (tool: Tool, patch: unknown) => void;
  onEraserMode?: (mode: EraserMode) => void;
  onInputMode?: (mode: 'finger' | 'stylus') => void;
  hostActions?: React.ReactNode;
  sharedActions?: React.ReactNode;
  fileAction?: React.ReactNode;
  onAddPage?: () => void;
  addPageDisabled?: boolean;
  primaryActions?: React.ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onClearMine?: () => void;
}) {
  const [tool, setTool] = useState<Tool>('pen');
  const [settings, setSettings] = useState<Record<Tool, ToolSettings>>(DEFAULT_TOOL_SETTINGS);
  const [eraserMode, setEraserMode] = useState<EraserMode>('partial');
  const [inputMode, setInputMode] = useState<'stylus' | 'finger'>('stylus');
  return (
    <I18nProvider>
      <button type="button">outside</button>
      <BoardToolbar
        tool={tool}
        onToolChange={setTool}
        settings={settings}
        onSettingsChange={(target, patch) => { onSettings(target, patch); setSettings(previous => ({ ...previous, [target]: { ...previous[target], ...patch } })); }}
        eraserMode={eraserMode}
        onEraserModeChange={value => { onEraserMode(value); setEraserMode(value); }}
        inputMode={inputMode}
        onInputModeChange={value => { onInputMode(value); setInputMode(value); }}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onClearMine={onClearMine}
        hostActions={hostActions}
        sharedActions={sharedActions}
        fileAction={fileAction}
        onAddPage={onAddPage}
        addPageDisabled={addPageDisabled}
        primaryActions={primaryActions}
      />
    </I18nProvider>
  );
}

describe('clickTool', () => {
  it('selects a different tool and closes any menu', () => {
    expect(clickTool('pen', 'erase', true)).toEqual({ tool: 'erase', menuOpen: false });
  });

  it('toggles the menu of the active tool', () => {
    expect(clickTool('pen', 'pen', false)).toEqual({ tool: 'pen', menuOpen: true });
    expect(clickTool('pen', 'pen', true)).toEqual({ tool: 'pen', menuOpen: false });
  });

  it('never opens a menu for tools without settings', () => {
    expect(hasSettings('select')).toBe(false);
    expect(clickTool('select', 'select', false)).toEqual({ tool: 'select', menuOpen: false });
  });
});

describe('BoardToolbar', () => {
  beforeEach(() => { localStorage.removeItem('language'); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.removeItem('language'); });
  it('marks the selected tool as pressed, and only that one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).getByRole('button', { name: 'Перо' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(toolbar).getByRole('button', { name: 'Ластик' }));
    expect(within(toolbar).getByRole('button', { name: 'Ластик' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByRole('button', { name: 'Перо' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts with closed settings and toggles them on repeated clicks of the selected tool', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Перо' }));
    expect(screen.getByRole('group', { name: 'Настройки инструмента' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Перо' }));
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();
  });

  it('applies a colour immediately from its picker without a confirm step', async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<Harness onSettings={onSettings} />);
    await user.click(screen.getByRole('button', { name: 'Перо' }));
    await user.click(screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' }));
    await user.click(screen.getByRole('radio', { name: '#df6835' }));

    expect(onSettings).toHaveBeenCalledWith('pen', { color: '#df6835' });
    expect(screen.queryByRole('radio', { name: '#df6835' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Настройки инструмента' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ok|ок|apply|применить/i })).not.toBeInTheDocument();
  });

  it('keeps pen settings open when thickness changes', async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<Harness onSettings={onSettings} />);
    await user.click(screen.getByRole('button', { name: 'Перо' }));
    const menu = screen.getByRole('group', { name: 'Настройки инструмента' });
    fireEvent.change(within(menu).getByRole('slider'), { target: { value: '6' } });
    expect(onSettings).toHaveBeenCalledWith('pen', { width: 0.006 });
    expect(menu).toBeInTheDocument();
  });

  it('closes the menu when the user touches outside the bar or presses Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Перо' }));
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Перо' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();
  });

  it('offers the two eraser modes on the eraser menu', async () => {
    const user = userEvent.setup();
    const onEraserMode = vi.fn();
    render(<Harness onEraserMode={onEraserMode} />);
    await user.click(screen.getByRole('button', { name: 'Ластик' }));
    await user.click(screen.getByRole('radio', { name: 'Удалять штрих' }));
    expect(onEraserMode).toHaveBeenCalledWith('stroke');
    expect(screen.getByRole('radio', { name: 'Удалять штрих' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Выбрать цвет / Farbe wählen' })).not.toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Размер ластика' })).toBeInTheDocument();
  });

  it('shows a working stylus / finger switch in contextual settings', async () => {
    const user = userEvent.setup(), onInputMode = vi.fn();
    render(<Harness onInputMode={onInputMode} />);
    await user.click(screen.getByRole('button', { name: 'Перо' }));
    expect(screen.getByRole('button', { name: 'Стилус' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Рисовать пальцем' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Рисовать пальцем' }));
    expect(onInputMode).toHaveBeenCalledWith('finger');
    expect(screen.getByRole('button', { name: 'Рисовать пальцем' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders host actions in More only when they are provided', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    expect(screen.queryByRole('button', { name: 'Очистить всё' })).not.toBeInTheDocument();
    unmount();
    render(<Harness hostActions={<button type="button">Очистить всё</button>} />);
    expect(screen.queryByRole('button', { name: 'Очистить всё' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    expect(screen.getByRole('button', { name: 'Очистить всё' })).toBeInTheDocument();
  });

  it('keeps the compact island order and invokes the supplied upload, save, answers and undo callbacks', async () => {
    const user = userEvent.setup(), upload = vi.fn(), save = vi.fn(), answers = vi.fn(), undo = vi.fn(), redo = vi.fn();
    render(<Harness canUndo canRedo onUndo={undo} onRedo={redo}
      fileAction={<button role="menuitem" onClick={upload}>Добавить документ</button>}
      primaryActions={<><button onClick={answers}>Ответы</button><button onClick={save}>Сохранить документы урока</button></>} />);
    const island = screen.getByRole('toolbar').querySelector('.board-toolbar__island') as HTMLElement;
    expect(within(island).getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Отменить', 'Вернуть', 'Перемещение', 'Перо', 'Ластик', 'Маркер', 'Добавить', 'Ответы', 'Сохранить документы урока', 'Другие инструменты',
    ]);
    for (const name of ['Отменить', 'Вернуть', 'Ответы', 'Сохранить документы урока']) await user.click(screen.getByRole('button', { name }));
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    await user.click(screen.getByRole('menuitem', { name: 'Добавить документ' }));
    for (const callback of [undo, redo, upload, answers, save]) expect(callback).toHaveBeenCalledOnce();
  });

  it('chooses a document or blank page from Add and supports keyboard and dismissal', async () => {
    const user = userEvent.setup(), upload = vi.fn(), add = vi.fn();
    render(<Harness onAddPage={add} fileAction={<button role="menuitem" onClick={upload}>Добавить документ</button>} />);
    const trigger = screen.getByRole('button', { name: 'Добавить' });
    await user.click(screen.getByRole('button', { name: 'Перо' }));
    await user.click(trigger);
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitem', { name: 'Добавить документ' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(add).toHaveBeenCalledOnce(); expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(upload).toHaveBeenCalledOnce(); expect(trigger).toHaveFocus();
    await user.click(trigger); await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
    await user.click(trigger); await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(trigger); await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps an unavailable blank page disabled and omits actions not supplied by the caller', async () => {
    const user = userEvent.setup(), add = vi.fn();
    render(<Harness onAddPage={add} addPageDisabled />);
    await user.click(screen.getByRole('button', { name: 'Добавить' }));
    const item = screen.getByRole('menuitem', { name: 'Добавить пустую страницу' });
    expect(item).toBeDisabled();
    expect(screen.queryByRole('menuitem', { name: 'Добавить документ' })).not.toBeInTheDocument();
    await user.click(item); expect(add).not.toHaveBeenCalled();
  });

  it('keeps unavailable undo and redo disabled', async () => {
    const user = userEvent.setup(), undo = vi.fn(), redo = vi.fn(); render(<Harness onUndo={undo} onRedo={redo} />);
    await user.click(screen.getByRole('button', { name: 'Отменить' })); await user.click(screen.getByRole('button', { name: 'Вернуть' }));
    expect(undo).not.toHaveBeenCalled(); expect(redo).not.toHaveBeenCalled();
  });

  it('opens settings on selection of a different tool and remembers each tool’s width and color', async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Маркер' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '14' } });
    await user.click(screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' }));
    await user.click(screen.getByRole('radio', { name: '#287764' }));
    await user.click(screen.getByRole('button', { name: 'Ластик' }));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Маркер' }));
    expect(screen.getByRole('slider')).toHaveValue('14');
    expect(screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' }).firstChild).toHaveStyle({ backgroundColor: '#287764' });
  });

  it('exposes secondary tools in More and applies real text font, size, bold and custom color settings', async () => {
    const user = userEvent.setup(), onSettings = vi.fn(); render(<Harness onSettings={onSettings} />);
    expect(screen.queryByRole('button', { name: 'Текст' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    for (const name of ['Выделение', 'Текст', 'Линия', 'Стрелка', 'Прямоугольник', 'Эллипс', 'Указка']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Текст' }));
    expect(screen.queryByRole('group', { name: 'Другие инструменты' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Шрифт / Schriftart' }), { target: { value: 'serif' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Размер текста / Schriftgröße' }), { target: { value: '200' } });
    await user.click(screen.getByRole('button', { name: 'Полужирный / Fett' }));
    await user.click(screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' }));
    fireEvent.change(screen.getByLabelText('Свой цвет / Eigene Farbe'), { target: { value: '#123456' } });
    expect(onSettings).toHaveBeenCalledWith('text', { font: 'serif' }); expect(onSettings).toHaveBeenCalledWith('text', { fontSize: 64 });
    expect(onSettings).toHaveBeenCalledWith('text', { bold: true }); expect(onSettings).toHaveBeenCalledWith('text', { color: '#123456' });
    expect(screen.getByRole('button', { name: 'Полужирный / Fett' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('supports keyboard navigation in More and returns focus to its trigger on Escape', async () => {
    const user = userEvent.setup(); render(<Harness />);
    const more = screen.getByRole('button', { name: 'Другие инструменты' }); more.focus();
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('button', { name: 'Выделение' })).toHaveFocus();
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('button', { name: 'Текст' })).toHaveFocus();
    await user.keyboard('{Escape}'); expect(more).toHaveFocus(); expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Другие инструменты' })).not.toBeInTheDocument();
  });

  it('moves focus into an already open More dropdown on ArrowDown', async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Другие инструменты' }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Выделение' })).toHaveFocus();
  });

  it('invokes existing clear, host and shared actions from More and returns focus after their dropdown closes', async () => {
    const user = userEvent.setup(), clear = vi.fn(), host = vi.fn(), shared = vi.fn();
    render(<Harness onClearMine={clear} hostActions={<button onClick={host}>Очистить всё</button>} sharedActions={<button onClick={shared}>Скачать PDF</button>} />);
    const more = screen.getByRole('button', { name: 'Другие инструменты' });
    for (const name of ['Очистить мой слой', 'Очистить всё', 'Скачать PDF']) {
      await user.click(more); await user.click(screen.getByRole('button', { name }));
      expect(more).toHaveAttribute('aria-expanded', 'false'); expect(more).toHaveFocus();
    }
    expect(clear).toHaveBeenCalledOnce(); expect(host).toHaveBeenCalledOnce(); expect(shared).toHaveBeenCalledOnce();
  });

  it('supports keyboard color selection and returns focus to the active tool when settings close', async () => {
    const user = userEvent.setup(); render(<Harness />); await user.click(screen.getByRole('button', { name: 'Перо' }));
    screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' }).focus();
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('radio', { name: '#202b37' })).toHaveFocus();
    await user.keyboard('{Escape}'); expect(screen.getByRole('button', { name: 'Перо' })).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: 'Выбор цвета / Farbauswahl' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();
  });

  it('opens the palette on hold and does not close it on the synthesized click', () => {
    vi.stubGlobal('PointerEvent', MouseEvent); vi.useFakeTimers(); render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Перо' }));
    const trigger = screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' });
    fireEvent.pointerDown(trigger, { button: 0, clientX: 10, clientY: 10 }); act(() => { vi.advanceTimersByTime(410); });
    fireEvent.pointerUp(trigger); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Выбор цвета / Farbauswahl' })).toBeInTheDocument();
  });

  it('cancels a dragged color hold and clears pending hold timers on unmount', () => {
    vi.stubGlobal('PointerEvent', MouseEvent); vi.useFakeTimers(); const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Перо' })); const trigger = screen.getByRole('button', { name: 'Выбрать цвет / Farbe wählen' });
    fireEvent.pointerDown(trigger, { button: 0, clientX: 10, clientY: 10 }); fireEvent.pointerMove(trigger, { clientX: 40, clientY: 10 });
    act(() => { vi.advanceTimersByTime(500); }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.pointerDown(trigger, { button: 0 }); unmount(); act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses German labels for the changed pan and More controls', () => {
    localStorage.setItem('language', 'DE'); render(<Harness />);
    expect(screen.getByRole('button', { name: 'Verschieben' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weitere Werkzeuge' })).toBeInTheDocument();
  });
});
