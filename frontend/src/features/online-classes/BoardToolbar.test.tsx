import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { BoardToolbar } from './BoardToolbar';
import { DEFAULT_TOOL_SETTINGS, clickTool, hasSettings } from './boardTools';
import type { EraserMode, Tool } from './WhiteboardCanvas';

function Harness({
  onSettings = vi.fn(),
  onEraserMode = vi.fn(),
  hostActions,
}: {
  onSettings?: (tool: Tool, patch: unknown) => void;
  onEraserMode?: (mode: EraserMode) => void;
  hostActions?: React.ReactNode;
}) {
  const [tool, setTool] = useState<Tool>('pen');
  return (
    <I18nProvider>
      <button type="button">outside</button>
      <BoardToolbar
        tool={tool}
        onToolChange={setTool}
        settings={DEFAULT_TOOL_SETTINGS}
        onSettingsChange={onSettings}
        eraserMode="partial"
        onEraserModeChange={onEraserMode}
        inputMode="stylus"
        onInputModeChange={vi.fn()}
        canUndo={false}
        canRedo={false}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onClearMine={vi.fn()}
        hostActions={hostActions}
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
  it('marks the selected tool as pressed, and only that one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).getByRole('button', { name: 'Перо' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(toolbar).getByRole('button', { name: 'Ластик' }));
    expect(within(toolbar).getByRole('button', { name: 'Ластик' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByRole('button', { name: 'Перо' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens settings only on the second click of the active tool', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Перо' }));
    expect(screen.getByRole('group', { name: 'Настройки инструмента' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Перо' }));
    expect(screen.queryByRole('group', { name: 'Настройки инструмента' })).not.toBeInTheDocument();
  });

  it('applies a colour at once and leaves the menu open without a confirm step', async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    render(<Harness onSettings={onSettings} />);
    await user.click(screen.getByRole('button', { name: 'Перо' }));
    await user.click(screen.getByRole('radio', { name: '#d62828' }));

    expect(onSettings).toHaveBeenCalledWith('pen', { color: '#d62828' });
    expect(screen.queryByRole('button', { name: /ok|ок|apply|применить/i })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Ластик' }));
    await user.click(screen.getByRole('radio', { name: 'Удалять штрих' }));
    expect(onEraserMode).toHaveBeenCalledWith('stroke');
    expect(screen.getByRole('radio', { name: 'Стирать участок' })).toBeChecked();
  });

  it('shows an explicit stylus / finger switch', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Стилус' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Рисовать пальцем' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders host actions only when they are provided', () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Очистить всё' })).not.toBeInTheDocument();
    unmount();
    render(<Harness hostActions={<button type="button">Очистить всё</button>} />);
    expect(screen.getByRole('button', { name: 'Очистить всё' })).toBeInTheDocument();
  });
});
