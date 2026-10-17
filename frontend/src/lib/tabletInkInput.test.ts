import { describe, expect, it } from 'vitest';
import { detectTabletInkBackend } from './tabletInkInput';

describe('cross-platform ink backend selection', () => {
  it('uses Touch Events on classic iPads with Apple Pencil', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      maxTouchPoints: 5, supportsPointer: true, supportsTouch: true,
    })).toBe('ios-touch');
  });
  it('recognizes iPadOS desktop Safari user agent', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 5, supportsPointer: true, supportsTouch: true,
    })).toBe('ios-touch');
  });
  it('uses Pointer Events for Samsung Android tablets and S Pen', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 Chrome/130',
      maxTouchPoints: 10, supportsPointer: true, supportsTouch: true,
    })).toBe('pointer');
  });
  it('uses Pointer Events for desktop browser mice', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
      maxTouchPoints: 0, supportsPointer: true, supportsTouch: false,
    })).toBe('pointer');
  });
  it('falls back to Touch Events on older mobile browsers', () => {
    expect(detectTabletInkBackend({
      userAgent: 'Mozilla/5.0 (Linux; Android 7; Tablet)',
      maxTouchPoints: 5, supportsPointer: false, supportsTouch: true,
    })).toBe('legacy-touch');
  });
});
