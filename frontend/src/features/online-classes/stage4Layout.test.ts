import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/online-classes.css'), 'utf8');

/**
 * Declarations of the first top-level rule listing `selector` exactly. Rules
 * nested in an @media block are skipped on purpose: their captured selector
 * starts with the at-rule.
 */
function declarations(selector: string): string {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',')
      .map((entry) => entry.trim());
    if (selectors.includes(selector)) return match[2];
  }
  throw new Error(`No rule for ${selector}`);
}

describe('stage 4 layout guards', () => {
  it('camera cards are one fixed share of the column and never grow', () => {
    const card = declarations('.camera-card');
    expect(card).toMatch(/flex:\s*0 0 calc\(\(100% - 4 \* 8px\) \/ 5\)/);
  });

  it('the camera column clips rather than scrolls', () => {
    const column = declarations('.camera-column');
    expect(column).toMatch(/overflow:\s*hidden/);
    expect(column).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
  });

  it('the camera column is a permanent grid column beside the board', () => {
    expect(declarations('.online-class-room__stage')).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) var\(--camera-column-width\)/,
    );
    // No breakpoint collapses it into a single column.
    expect(css).not.toMatch(/online-class-room__stage\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it('the answers panel floats over the board with a fixed width and cannot cover the cameras', () => {
    const panel = declarations('.answers-panel');
    expect(panel).toMatch(/position:\s*absolute/);
    expect(panel).toMatch(/width:\s*clamp\(320px, 33vw, 560px\)/);
    expect(panel).not.toMatch(/resize/);
    // The panel lives inside the board stage, which sits beside the camera column.
    expect(declarations('.whiteboard__stage')).toMatch(/position:\s*relative/);
  });

  it('the answers close button sits on the panel border', () => {
    expect(declarations('.answers-panel__close')).toMatch(/right:\s*-16px/);
  });

  it('the toolbar stays in view and is never collapsed or scrolled away', () => {
    const bar = declarations('.board-toolbar');
    expect(bar).toMatch(/position:\s*relative/);
    expect(bar).not.toMatch(/display:\s*none/);
    expect(css).not.toMatch(/\.board-toolbar\[hidden\]/);
  });

  it('the board surface fills its stage and blocks browser touch gestures', () => {
    const surface = declarations('.whiteboard__surface');
    expect(surface).toMatch(/height:\s*100%/);
    expect(surface).toMatch(/touch-action:\s*none/);
  });

  it('the room takes the whole window', () => {
    expect(declarations('.online-class-room')).toMatch(/position:\s*fixed/);
    expect(declarations('.online-class-room')).toMatch(/inset:\s*0/);
  });

  it('touch devices get fingertip-sized targets on the new controls', () => {
    const coarse = css.slice(css.indexOf('/* --- Board toolbar'));
    expect(coarse).toMatch(/\(pointer: coarse\)[\s\S]*\.board-toolbar button[\s\S]*min-height:\s*44px/);
    expect(coarse).toMatch(/\(pointer: coarse\)[\s\S]*\.page-nav button[\s\S]*min-height:\s*44px/);
  });

  it('the page switcher sits bottom-left of the board', () => {
    const pages = declarations('.whiteboard__pages');
    expect(pages).toMatch(/left:\s*12px/);
    expect(pages).toMatch(/bottom:\s*12px/);
  });
});
