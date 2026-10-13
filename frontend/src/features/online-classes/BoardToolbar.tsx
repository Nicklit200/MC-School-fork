import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import {
  COLORS,
  MAX_WIDTH_PERMILLE,
  MIN_WIDTH_PERMILLE,
  TOOL_DEFINITIONS,
  type ToolSettings,
  clickTool,
} from './boardTools';
import type { InputMode } from './inputPolicy';
import type { EraserMode, Tool } from './WhiteboardCanvas';

interface Props {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  settings: Record<Tool, ToolSettings>;
  onSettingsChange: (tool: Tool, patch: Partial<ToolSettings>) => void;
  eraserMode: EraserMode;
  onEraserModeChange: (mode: EraserMode) => void;
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClearMine: () => void;
  /** Host-only actions are passed in rather than inferred, so a student's bar cannot render them. */
  hostActions?: ReactNode;
  /** Available to everyone with a board, such as downloading it as a PDF. */
  sharedActions?: ReactNode;
}

/**
 * Top tool bar with notebook-style behaviour: one click selects a tool, the
 * active tool is clearly marked, and clicking it again opens a small menu next
 * to it. The menu never blocks the board — touching the board closes it and
 * the next stroke uses the new setting, with nothing to confirm.
 */
export function BoardToolbar({
  tool,
  onToolChange,
  settings,
  onSettingsChange,
  eraserMode,
  onEraserModeChange,
  inputMode,
  onInputModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClearMine,
  hostActions,
  sharedActions,
}: Props) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Touching anywhere outside the bar (the board) or pressing Escape closes the
  // menu, so the user is back to drawing without an extra "done" step.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const activeSettings = settings[tool];
  const definition = TOOL_DEFINITIONS.find((entry) => entry.tool === tool);

  const renderMenu = () => {
    if (!menuOpen || !definition) return null;
    return (
      <div className="board-toolbar__menu" role="group" aria-label={t('onlineClass.board.settings')}>
        {definition.settings === 'eraser' ? (
          <div role="radiogroup" aria-label={t('onlineClass.board.eraserMode')}>
            {(['partial', 'stroke'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={eraserMode === mode}
                className={eraserMode === mode ? 'is-active' : undefined}
                onClick={() => onEraserModeChange(mode)}
              >
                {t(mode === 'partial' ? 'onlineClass.board.eraser.partial' : 'onlineClass.board.eraser.stroke')}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="board-toolbar__swatches" role="radiogroup" aria-label={t('onlineClass.whiteboard.color')}>
              {COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={activeSettings.color === value}
                  aria-label={value}
                  className={activeSettings.color === value ? 'is-active' : undefined}
                  style={{ background: value }}
                  onClick={() => onSettingsChange(tool, { color: value })}
                />
              ))}
            </div>
            {definition.settings === 'ink' && (
              <label className="board-toolbar__size">
                {t('onlineClass.board.size')}
                <input
                  type="range"
                  min={MIN_WIDTH_PERMILLE}
                  max={MAX_WIDTH_PERMILLE}
                  value={Math.round(activeSettings.width * 1000)}
                  onChange={(event) =>
                    onSettingsChange(tool, { width: Number(event.target.value) / 1000 })
                  }
                />
              </label>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className="board-toolbar"
      role="toolbar"
      aria-label={t('onlineClass.whiteboard')}
    >
      <div className="board-toolbar__tools">
        {TOOL_DEFINITIONS.map((entry) => {
          const isActive = entry.tool === tool;
          return (
            <div key={entry.tool} className="board-toolbar__slot">
              <button
                type="button"
                className={isActive ? 'board-toolbar__tool is-active' : 'board-toolbar__tool'}
                aria-pressed={isActive}
                aria-haspopup={entry.settings === 'none' ? undefined : 'true'}
                aria-expanded={isActive && entry.settings !== 'none' ? menuOpen : undefined}
                aria-label={t(entry.labelKey)}
                title={t(entry.labelKey)}
                onClick={() => {
                  const next = clickTool(tool, entry.tool, menuOpen);
                  if (next.tool !== tool) onToolChange(next.tool);
                  setMenuOpen(next.menuOpen);
                }}
              >
                <span aria-hidden="true">{entry.glyph}</span>
              </button>
              {isActive && renderMenu()}
            </div>
          );
        })}
      </div>

      <div className="board-toolbar__group" role="group" aria-label={t('onlineClass.board.inputMode')}>
        {(['stylus', 'finger'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={inputMode === mode}
            className={inputMode === mode ? 'is-active' : undefined}
            onClick={() => onInputModeChange(mode)}
          >
            {t(mode === 'stylus' ? 'onlineClass.board.input.stylus' : 'onlineClass.board.input.finger')}
          </button>
        ))}
      </div>

      <div className="board-toolbar__group">
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          {t('onlineClass.whiteboard.undo')}
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo}>
          {t('onlineClass.whiteboard.redo')}
        </button>
        <button type="button" onClick={onClearMine}>
          {t('onlineClass.whiteboard.clearMine')}
        </button>
        {hostActions}
        {sharedActions}
      </div>
    </div>
  );
}
