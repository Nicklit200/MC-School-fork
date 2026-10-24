import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/I18nContext';
import { MAX_WIDTH_PERMILLE, MIN_WIDTH_PERMILLE, TOOL_DEFINITIONS, hasSettings, type ToolSettings } from './boardTools';
import type { InputMode } from './inputPolicy';
import type { EraserMode, Tool } from './WhiteboardCanvas';
import { TEXT_FONT_PRESETS, clampTextSize, type TextFont } from './textStyles';
import { BoardToolbarIcon } from './BoardToolbarIcon';
export { BoardToolbarIcon } from './BoardToolbarIcon';

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
  /** The caller supplies authorized actions; this component never infers a role. */
  hostActions?: ReactNode;
  sharedActions?: ReactNode;
  /** Optional upload action between the main tools and More. */
  fileAction?: ReactNode;
  /** Compact actions such as teacher answers and saving lesson documents. */
  primaryActions?: ReactNode;
}

const MAIN_TOOLS: Tool[] = ['pan', 'pen', 'erase', 'highlighter'];
const MORE_TOOLS: Tool[] = ['select', 'text', 'line', 'arrow', 'rect', 'ellipse', 'laser'];
const PALETTE = ['#202b37', '#df6835', '#287764', '#2459a6', '#a74556', '#8b5bb4', '#e7bb45', '#ffffff'];
const HOLD_MS = 400;

/** One compact island with contextual tool settings below it. */
export function BoardToolbar({ tool, onToolChange, settings, onSettingsChange, eraserMode, onEraserModeChange,
  inputMode, onInputModeChange, canUndo, canRedo, onUndo, onRedo, onClearMine, hostActions, sharedActions, fileAction, primaryActions }: Props) {
  const { t, language } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorMenuPosition, setColorMenuPosition] = useState({ top: 64, left: 12 });
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const colorTrigger = useRef<HTMLButtonElement>(null);
  const toolButtons = useRef<Partial<Record<Tool, HTMLButtonElement | null>>>({});
  const focusPalette = useRef(false);
  const focusMore = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  const holdOpened = useRef(false);
  const moreId = useId(), settingsId = useId(), paletteId = useId();
  const activeSettings = settings[tool];
  const definition = TOOL_DEFINITIONS.find(entry => entry.tool === tool);
  const moreLabel = language === 'DE' ? 'Weitere Werkzeuge' : 'Другие инструменты';
  const toolLabel = (value: Tool) => value === 'pan' ? (language === 'DE' ? 'Verschieben' : 'Перемещение')
    : t(TOOL_DEFINITIONS.find(entry => entry.tool === value)!.labelKey);
  const cancelHold = () => { clearTimeout(holdTimer.current); holdTimer.current = undefined; holdStart.current = null; };
  const closeMenus = () => { setMenuOpen(false); setMoreOpen(false); setColorsOpen(false); cancelHold(); };

  useEffect(() => () => clearTimeout(holdTimer.current), []);
  useEffect(() => {
    if (colorsOpen && focusPalette.current) {
      paletteRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); focusPalette.current = false;
    }
  }, [colorsOpen]);
  useEffect(() => {
    if (moreOpen && focusMore.current) { toolButtons.current.select?.focus(); focusMore.current = false; }
  }, [moreOpen]);
  useEffect(() => {
    if (!menuOpen && !colorsOpen && !moreOpen) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !paletteRef.current?.contains(event.target as Node)) closeMenus();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); closeMenus();
      if (moreOpen || !MAIN_TOOLS.includes(tool)) moreRef.current?.focus();
      else toolButtons.current[tool]?.focus();
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  }, [menuOpen, colorsOpen, moreOpen, tool]);

  const chooseTool = (value: Tool) => {
    if (value !== tool) onToolChange(value);
    setMenuOpen(hasSettings(value) && !(value === tool && menuOpen));
    setMoreOpen(false); setColorsOpen(false); cancelHold();
    if (MORE_TOOLS.includes(value)) moreRef.current?.focus();
  };
  const renderTool = (value: Tool) => <button key={value} ref={button => { toolButtons.current[value] = button; }} type="button"
    className={`board-toolbar__tool${value === tool ? ' is-active' : ''}`} aria-pressed={value === tool}
    aria-label={toolLabel(value)} title={toolLabel(value)} aria-controls={hasSettings(value) ? settingsId : undefined}
    aria-expanded={hasSettings(value) ? value === tool && menuOpen : undefined} onClick={() => chooseTool(value)}>
    <BoardToolbarIcon name={value} />
  </button>;
  const openPalette = (keyboard = false) => {
    const rect = colorTrigger.current?.getBoundingClientRect();
    if (rect) setColorMenuPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 250)) });
    focusPalette.current = keyboard; setColorsOpen(true);
  };
  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  };
  const hasColor = definition && !['none', 'eraser'].includes(definition.settings);
  const hasWidth = definition?.settings === 'ink' || tool === 'erase';

  return <div ref={rootRef} className="board-toolbar board-toolbar--original" role="toolbar" aria-label={t('onlineClass.whiteboard')}>
    <div className="board-toolbar__island">
      <button className="board-toolbar__tool" type="button" aria-label={t('onlineClass.whiteboard.undo')} title={t('onlineClass.whiteboard.undo')}
        disabled={!canUndo} onClick={() => { closeMenus(); onUndo(); }}><BoardToolbarIcon name="undo" /></button>
      <button className="board-toolbar__tool" type="button" aria-label={t('onlineClass.whiteboard.redo')} title={t('onlineClass.whiteboard.redo')}
        disabled={!canRedo} onClick={() => { closeMenus(); onRedo(); }}><BoardToolbarIcon name="redo" /></button>
      <span className="board-toolbar__divider" aria-hidden="true" />
      {MAIN_TOOLS.map(renderTool)}
      {fileAction && <span className="board-toolbar__file-action">{fileAction}</span>}
      {primaryActions && <span className="board-toolbar__primary-actions">{primaryActions}</span>}
      <div className="board-toolbar__more">
        <button ref={moreRef} className={`board-toolbar__tool${MORE_TOOLS.includes(tool) ? ' is-active' : ''}`} type="button"
          aria-label={moreLabel} title={moreLabel} aria-expanded={moreOpen} aria-controls={moreId}
          onClick={() => { setMoreOpen(!moreOpen); setMenuOpen(false); setColorsOpen(false); cancelHold(); }}
          onKeyDown={event => { if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (moreOpen) toolButtons.current.select?.focus();
            else { focusMore.current = true; setMoreOpen(true); }
            setMenuOpen(false); setColorsOpen(false);
          } }}>
          <BoardToolbarIcon name="more" />
        </button>
        {moreOpen && <div id={moreId} className="board-toolbar__more-menu" role="group" aria-label={moreLabel} onKeyDown={navigateMenu}>
          <div className="board-toolbar__extra-tools">{MORE_TOOLS.map(renderTool)}</div>
          <div className="board-toolbar__more-actions" onClick={event => { if ((event.target as Element).closest('button')) { setMoreOpen(false); moreRef.current?.focus(); } }}>
            <button type="button" onClick={onClearMine}><BoardToolbarIcon name="clear" />{t('onlineClass.whiteboard.clearMine')}</button>
            {hostActions}{sharedActions}
          </div>
        </div>}
      </div>
    </div>

    {menuOpen && definition && hasSettings(tool) && <div id={settingsId} className="board-toolbar__settings board-toolbar__menu"
      data-tool={tool} role="group" aria-label={t('onlineClass.board.settings')}>
      <span className="board-toolbar__settings-name">{toolLabel(tool)}</span>
      {hasColor && <div className="board-toolbar__color-picker">
        <button ref={colorTrigger} type="button" className="board-toolbar__color-trigger" aria-label="Выбрать цвет / Farbe wählen"
          aria-haspopup="dialog" aria-expanded={colorsOpen} aria-controls={paletteId} title="Удерживайте, чтобы выбрать цвет / Für Farbauswahl gedrückt halten"
          onClick={() => { if (holdOpened.current) { holdOpened.current = false; return; } if (colorsOpen) setColorsOpen(false); else openPalette(); }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            cancelHold(); holdOpened.current = false; holdStart.current = { x: event.clientX, y: event.clientY };
            holdTimer.current = setTimeout(() => { holdOpened.current = true; holdTimer.current = undefined; holdStart.current = null; openPalette(); }, HOLD_MS);
          }}
          onPointerMove={event => { if (holdStart.current && Math.hypot(event.clientX - holdStart.current.x, event.clientY - holdStart.current.y) > 12) cancelHold(); }}
          onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
          onContextMenu={event => { event.preventDefault(); cancelHold(); openPalette(); }}
          onKeyDown={event => { if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); openPalette(true); } }}>
          <span className="board-toolbar__color-preview" style={{ backgroundColor: activeSettings.color }} />
        </button>
      </div>}
      {hasWidth && <label className="board-toolbar__size">
        <span>{tool === 'erase' ? (language === 'DE' ? 'Radierergröße' : 'Размер ластика') : t('onlineClass.board.size')}</span>
        <output>{Math.round(activeSettings.width * 1000)}</output>
        <input type="range" aria-label={tool === 'erase' ? 'Размер ластика' : 'Толщина инструмента'} min={MIN_WIDTH_PERMILLE} max={MAX_WIDTH_PERMILLE}
          value={Math.round(activeSettings.width * 1000)} onChange={event => onSettingsChange(tool, { width: Number(event.target.value) / 1000 })} />
      </label>}
      {tool === 'erase' && <div className="board-toolbar__eraser-modes" role="radiogroup" aria-label={t('onlineClass.board.eraserMode')}>
        {(['partial', 'stroke'] as const).map(mode => <button key={mode} type="button" role="radio" aria-checked={eraserMode === mode}
          className={eraserMode === mode ? 'is-active' : undefined} onClick={() => onEraserModeChange(mode)}>
          {t(mode === 'partial' ? 'onlineClass.board.eraser.partial' : 'onlineClass.board.eraser.stroke')}
        </button>)}
      </div>}
      {tool === 'text' && <div className="board-toolbar__text-style" role="group" aria-label={t('onlineClass.whiteboard.text')}>
        <label className="board-toolbar__text-control"><span>Шрифт / Schrift</span>
          <select aria-label="Шрифт / Schriftart" value={activeSettings.font ?? 'clean'} onChange={event => onSettingsChange('text', { font: event.target.value as TextFont })}>
            {TEXT_FONT_PRESETS.map(preset => <option key={preset.value} value={preset.value} style={{ fontFamily: preset.fontFamily }}>{preset.labelRu} / {preset.labelDe}</option>)}
          </select>
        </label>
        <label className="board-toolbar__text-control"><span>Размер / Größe</span>
          <input type="number" aria-label="Размер текста / Schriftgröße" min={10} max={64} step={1} value={activeSettings.fontSize ?? 24}
            onChange={event => onSettingsChange('text', { fontSize: clampTextSize(Number(event.target.value)) })} />
        </label>
        <button type="button" className={`board-toolbar__text-bold${activeSettings.bold ? ' is-active' : ''}`} aria-label="Полужирный / Fett"
          aria-pressed={Boolean(activeSettings.bold)} onClick={() => onSettingsChange('text', { bold: !activeSettings.bold })}>B</button>
      </div>}
      <div className="board-toolbar__input-mode" role="group" aria-label={t('onlineClass.board.inputMode')}>
        {(['stylus', 'finger'] as const).map(mode => <button key={mode} type="button" aria-pressed={inputMode === mode}
          className={inputMode === mode ? 'is-active' : undefined} onClick={() => onInputModeChange(mode)}>
          {t(mode === 'stylus' ? 'onlineClass.board.input.stylus' : 'onlineClass.board.input.finger')}
        </button>)}
      </div>
    </div>}

    {colorsOpen && menuOpen && hasColor && createPortal(<div ref={paletteRef} id={paletteId} className="board-toolbar__color-popover board-toolbar__color-popover--original"
      style={{ top: colorMenuPosition.top, left: colorMenuPosition.left }} role="dialog" aria-label="Выбор цвета / Farbauswahl">
      <div className="board-toolbar__swatches" role="radiogroup" aria-label={t('onlineClass.whiteboard.color')}>
        {PALETTE.map(value => <button key={value} type="button" role="radio" aria-checked={activeSettings.color === value} aria-label={value}
          className={activeSettings.color === value ? 'is-active' : undefined} style={{ backgroundColor: value }}
          onClick={() => { onSettingsChange(tool, { color: value }); setColorsOpen(false); colorTrigger.current?.focus(); }} />)}
      </div>
      <label className="board-toolbar__custom-color">Свой цвет / Eigene Farbe
        <input type="color" aria-label="Свой цвет / Eigene Farbe" value={activeSettings.color}
          onChange={event => onSettingsChange(tool, { color: event.target.value })} />
      </label>
    </div>, document.body)}
  </div>;
}
