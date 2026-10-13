import { describe, expect, it } from 'vitest';
import { actionFor, looksLikePalm, normalizePointerKind, shouldCancelStroke } from './inputPolicy';

describe('actionFor', () => {
  it('stylus mode: pen draws, a finger pans, a palm never draws', () => {
    expect(actionFor('pen', 'stylus', 0)).toBe('draw');
    expect(actionFor('touch', 'stylus', 1)).toBe('pan');
    expect(actionFor('touch', 'stylus', 2)).toBe('pan');
  });

  it('finger mode: one finger draws, two always move the canvas', () => {
    expect(actionFor('touch', 'finger', 1)).toBe('draw');
    expect(actionFor('touch', 'finger', 2)).toBe('pan');
    expect(actionFor('touch', 'finger', 3)).toBe('pan');
  });

  it('a mouse always draws', () => {
    expect(actionFor('mouse', 'stylus', 0)).toBe('draw');
    expect(actionFor('mouse', 'finger', 0)).toBe('draw');
  });

  it('a pen still draws in finger mode', () => {
    expect(actionFor('pen', 'finger', 0)).toBe('draw');
  });
});

describe('helpers', () => {
  it('cancels an in-progress stroke when a second finger lands', () => {
    expect(shouldCancelStroke('touch', 2)).toBe(true);
    expect(shouldCancelStroke('touch', 1)).toBe(false);
    expect(shouldCancelStroke('pen', 2)).toBe(false);
  });

  it('treats large contact areas as palms', () => {
    expect(looksLikePalm(80, 70)).toBe(true);
    expect(looksLikePalm(12, 14)).toBe(false);
    expect(looksLikePalm(undefined, undefined)).toBe(false);
  });

  it('maps unknown pointer types to a mouse', () => {
    expect(normalizePointerKind('pen')).toBe('pen');
    expect(normalizePointerKind('touch')).toBe('touch');
    expect(normalizePointerKind('')).toBe('mouse');
    expect(normalizePointerKind(undefined)).toBe('mouse');
  });
});
