import { describe, expect, it } from 'vitest';
import { TEXT_FONT_PRESETS, clampTextSize, normalizedTextSize,
  resolveTextFont, shapeTextSizePx, textStyleFor } from './textStyles';

describe('whiteboard text typography', () => {
  it('supports five predictable font presets, including handwriting', () => {
    expect(TEXT_FONT_PRESETS).toHaveLength(5);
    expect(resolveTextFont('handwritten').value).toBe('handwritten');
    expect(textStyleFor('rounded', true)).toMatchObject({ fontStyle: 'bold' });
  });
  it('falls back safely to the legacy font', () => {
    expect(resolveTextFont('unrecognized').value).toBe('clean');
    expect(shapeTextSizePx(undefined, 800)).toBe(24);
  });
  it('allows genuinely small type while rejecting invalid sizes', () => {
    expect(clampTextSize(6)).toBe(10);
    expect(clampTextSize(70)).toBe(64);
    expect(clampTextSize(NaN)).toBe(24);
    expect(normalizedTextSize(10)).toBeCloseTo(0.0125);
    expect(shapeTextSizePx(normalizedTextSize(10), 800)).toBe(10);
  });
  it('scales printed/PDF text consistently with the page', () => {
    expect(shapeTextSizePx(normalizedTextSize(12), 1600)).toBe(24);
  });
});
