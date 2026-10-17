import type { TranslationKey } from '../../i18n/translations';
import type { Tool } from './WhiteboardCanvas';
import { DEFAULT_TEXT_FONT, DEFAULT_TEXT_SIZE, type TextFont } from './textStyles';

export interface ToolDefinition {
  tool: Tool;
  labelKey: TranslationKey;
  glyph: string;
  /** What the second click opens. Tools with `none` just stay selected. */
  settings: 'ink' | 'color' | 'eraser' | 'none';
}

/** Order mirrors a notebook toolbar: write, mark up, shape, erase, select, point. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { tool: 'pan', labelKey: 'onlineClass.board.select', glyph: '✋', settings: 'none' },
  { tool: 'pen', labelKey: 'onlineClass.whiteboard.pen', glyph: '✎', settings: 'ink' },
  { tool: 'highlighter', labelKey: 'onlineClass.whiteboard.highlighter', glyph: '▌', settings: 'ink' },
  { tool: 'erase', labelKey: 'onlineClass.whiteboard.eraser', glyph: '⌫', settings: 'eraser' },
  { tool: 'select', labelKey: 'onlineClass.board.select', glyph: '⬚', settings: 'none' },
  { tool: 'text', labelKey: 'onlineClass.whiteboard.text', glyph: 'T', settings: 'color' },
  { tool: 'line', labelKey: 'onlineClass.whiteboard.line', glyph: '／', settings: 'ink' },
  { tool: 'arrow', labelKey: 'onlineClass.whiteboard.arrow', glyph: '→', settings: 'ink' },
  { tool: 'rect', labelKey: 'onlineClass.whiteboard.rect', glyph: '▭', settings: 'ink' },
  { tool: 'ellipse', labelKey: 'onlineClass.whiteboard.ellipse', glyph: '◯', settings: 'ink' },
  { tool: 'laser', labelKey: 'onlineClass.whiteboard.laser', glyph: '◉', settings: 'none' },
];

export const COLORS = ['#111111', '#d62828', '#0353a4', '#2a9d8f', '#e9c46a'];

export interface ToolSettings {
  color: string;
  /** Normalized to the board width, like the stroke width on the wire. */
  width: number;
  /** Text-only options, stored with each annotation. */
  font?: TextFont;
  fontSize?: number;
  bold?: boolean;
}

/** Each tool remembers its own colour and thickness, like a physical pen tray. */
export const DEFAULT_TOOL_SETTINGS: Record<Tool, ToolSettings> = {
  pan: { color: COLORS[0], width: 0.004 },
  pen: { color: COLORS[0], width: 0.004 },
  highlighter: { color: COLORS[4], width: 0.016 },
  erase: { color: COLORS[0], width: 0.012 },
  select: { color: COLORS[0], width: 0.004 },
  text: { color: COLORS[0], width: 0.004, font: DEFAULT_TEXT_FONT, fontSize: DEFAULT_TEXT_SIZE, bold: false },
  line: { color: COLORS[0], width: 0.004 },
  arrow: { color: COLORS[0], width: 0.004 },
  rect: { color: COLORS[0], width: 0.004 },
  ellipse: { color: COLORS[0], width: 0.004 },
  laser: { color: COLORS[1], width: 0.004 },
};

export const MIN_WIDTH_PERMILLE = 1;
export const MAX_WIDTH_PERMILLE = 30;

export function hasSettings(tool: Tool): boolean {
  return TOOL_DEFINITIONS.find((entry) => entry.tool === tool)?.settings !== 'none';
}

/**
 * What a tool click does: a different tool is selected; the already active one
 * toggles its settings menu (and does nothing when it has none).
 */
export function clickTool(
  active: Tool,
  clicked: Tool,
  menuOpen: boolean,
): { tool: Tool; menuOpen: boolean } {
  if (clicked !== active) return { tool: clicked, menuOpen: false };
  return { tool: active, menuOpen: hasSettings(clicked) ? !menuOpen : false };
}
