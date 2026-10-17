/**
 * Typography settings shared by the live board, editor and exported PDF.
 * Persist a short preset ID, not arbitrary CSS: drawings stay portable and
 * old annotation payloads without a font still render as before.
 */
export type TextFont = 'clean' | 'rounded' | 'handwritten' | 'serif' | 'mono';

export type TextFontPreset = {
  value: TextFont;
  labelRu: string;
  labelDe: string;
  fontFamily: string;
};

export const TEXT_FONT_PRESETS: readonly TextFontPreset[] = [
  { value: 'clean', labelRu: 'Современный', labelDe: 'Modern',
    fontFamily: 'Arial, Helvetica, sans-serif' },
  { value: 'rounded', labelRu: 'Мягкий', labelDe: 'Rund',
    fontFamily: '"Avenir Next", "Trebuchet MS", Arial, sans-serif' },
  { value: 'handwritten', labelRu: 'Рукописный', labelDe: 'Handschrift',
    fontFamily: '"Noteworthy", "Segoe Print", "Bradley Hand", cursive' },
  { value: 'serif', labelRu: 'Классический', labelDe: 'Klassisch',
    fontFamily: 'Georgia, "Times New Roman", serif' },
  { value: 'mono', labelRu: 'Технический', labelDe: 'Monospace',
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' },
];

export const DEFAULT_TEXT_FONT: TextFont = 'clean';
export const DEFAULT_TEXT_SIZE = 24;
/** Relative to a reference page of 800 CSS px height. */
const REFERENCE_HEIGHT = 800;
export const MIN_TEXT_SIZE = 10;
export const MAX_TEXT_SIZE = 64;

/** Unknown values from old/imported documents always fall back to safe CSS. */
export function resolveTextFont(value?: string | null): TextFontPreset {
  return TEXT_FONT_PRESETS.find((option) => option.value === value) ?? TEXT_FONT_PRESETS[0];
}

export function clampTextSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TEXT_SIZE;
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, Math.round(value)));
}

/** Normalized font size travels with the shape and scales with PDF pages. */
export function normalizedTextSize(referencePx: number): number {
  return clampTextSize(referencePx) / REFERENCE_HEIGHT;
}

/** Existing shapes keep their legacy 0.03 default; smaller text is now allowed. */
export function shapeTextSizePx(normalized?: number, pageHeight = REFERENCE_HEIGHT): number {
  const safe = typeof normalized === 'number' && Number.isFinite(normalized) && normalized > 0
    ? normalized : 0.03;
  return Math.max(8, safe * Math.max(1, pageHeight));
}

export function textStyleFor(font: string | undefined, bold?: boolean): {
  fontFamily: string;
  fontStyle: string;
} {
  return {
    fontFamily: resolveTextFont(font).fontFamily,
    fontStyle: bold ? 'bold' : 'normal',
  };
}
