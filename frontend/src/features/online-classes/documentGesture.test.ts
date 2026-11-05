import { describe, expect, it } from 'vitest';
import { TwoFingerNavigation } from './documentGesture';

describe('two-finger navigation intent', () => {
  it('waits for both pointer contacts instead of treating the first vertical swipe packet as a pinch', () => {
    const navigation = new TwoFingerNavigation();
    navigation.begin([{ x: 100, y: 200 }, { x: 100, y: 400 }]);
    expect(navigation.update([{ x: 100, y: 140 }, { x: 100, y: 400 }]))
      .toEqual({ scale: 1, anchor: { x: 100, y: 300 }, pan: { x: 0, y: 0 } });
    expect(navigation.update([{ x: 100, y: 140 }, { x: 100, y: 340 }]))
      .toEqual({ scale: 1, anchor: { x: 100, y: 300 }, pan: { x: 0, y: -60 } });
    expect(navigation.update([{ x: 101.5, y: 200 }, { x: 98.5, y: 400 }]).scale).toBe(1);
  });

  it('keeps a native parallel swipe at exactly the original zoom despite horizontal span jitter', () => {
    const navigation = new TwoFingerNavigation();
    navigation.begin([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    const up = navigation.update([{ x: 98.5, y: 140 }, { x: 301.5, y: 140 }], true);
    expect(up.scale).toBe(1); expect(up.pan).toEqual({ x: 0, y: -60 });
    const down = navigation.update([{ x: 101.5, y: 220 }, { x: 298.5, y: 220 }], true);
    expect(down.scale).toBe(1); expect(down.pan).toEqual({ x: 0, y: 80 });
  });

  it('ignores small span jitter and includes the dead zone when a genuine apart pinch becomes clear', () => {
    const navigation = new TwoFingerNavigation();
    navigation.begin([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    expect(navigation.update([{ x: 98.5, y: 200 }, { x: 301.5, y: 200 }], true).scale).toBe(1);
    expect(navigation.update([{ x: 80, y: 200 }, { x: 320, y: 200 }], true))
      .toEqual({ scale: 1.2, anchor: { x: 200, y: 200 }, pan: { x: 0, y: 0 } });
    expect(navigation.update([{ x: 80, y: 200 }, { x: 380, y: 200 }], true).scale).toBe(1.25);
  });

  it('recognizes an outward pointer pinch after both packets and then permits one finger to stay fixed', () => {
    const navigation = new TwoFingerNavigation();
    navigation.begin([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    expect(navigation.update([{ x: 50, y: 200 }, { x: 300, y: 200 }]).scale).toBe(1);
    expect(navigation.update([{ x: 50, y: 200 }, { x: 350, y: 200 }]).scale).toBe(1.5);
    expect(navigation.update([{ x: 50, y: 200 }, { x: 500, y: 200 }]).scale).toBe(1.5);
  });

  it('keeps an established swipe from switching to zoom until a new contact pair starts', () => {
    const navigation = new TwoFingerNavigation();
    navigation.begin([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    navigation.update([{ x: 100, y: 160 }, { x: 300, y: 160 }], true);
    expect(navigation.update([{ x: 0, y: 160 }, { x: 400, y: 160 }], true).scale).toBe(1);
    navigation.reset();
    navigation.begin([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
    expect(navigation.update([{ x: 0, y: 200 }, { x: 400, y: 200 }], true).scale).toBe(2);
  });
});
