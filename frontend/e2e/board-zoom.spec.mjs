import { test, expect } from '@playwright/test';

async function openBoard(page, layout = 'continuous') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/e2e/fixtures/board-zoom.html?layout=${layout}`);
  await expect(page.locator('.whiteboard__surface').first()).toBeVisible();
  await expect.poll(() => page.locator('.whiteboard__page').first().evaluate(node => node.offsetHeight)).toBeGreaterThan(100);
  await expect(page.locator('.whiteboard__notice')).not.toContainText('Загрузка');
  return errors;
}

async function zoom(page) {
  const label = await page.locator('.whiteboard__zoom-label').innerText();
  return label.includes('%') ? parseInt(label, 10) / 100 : 1;
}

async function enlarge(page) {
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect.poll(() => zoom(page)).toBeGreaterThan(2.4);
}

async function documentPoint(page, anchor) {
  return page.locator('.whiteboard__page').first().evaluate((node, point) => {
    const rect = node.getBoundingClientRect();
    return { x: (point.x - rect.left) / rect.width, y: (point.y - rect.top) / rect.height };
  }, anchor);
}

async function documentError(page, anchor, original) {
  return page.locator('.whiteboard__page').first().evaluate((node, { point, original }) => {
    const rect = node.getBoundingClientRect();
    return Math.hypot(rect.left + original.x * rect.width - point.x, rect.top + original.y * rect.height - point.y);
  }, { point: anchor, original });
}

async function burst(page, anchor, count = 12, deltaY = -4, deltaMode = 0) {
  await page.evaluate(({ anchor, count, deltaY, deltaMode }) => {
    const target = window.document.elementFromPoint(anchor.x, anchor.y);
    for (let i = 0; i < count; i++) target.dispatchEvent(new WheelEvent('wheel', {
      clientX: anchor.x, clientY: anchor.y, deltaY, deltaMode, ctrlKey: true, bubbles: true, cancelable: true,
    }));
  }, { anchor, count, deltaY, deltaMode });
}

async function pinch(page, anchor, from = 100, to = 150) {
  const session = await page.context().newCDPSession(page);
  const contacts = distance => [
    { x: anchor.x - distance / 2, y: anchor.y, id: 1 },
    { x: anchor.x + distance / 2, y: anchor.y, id: 2 },
  ];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts(from) });
  const step = to > from ? 10 : -10;
  for (let distance = from + step; step > 0 ? distance <= to : distance >= to; distance += step) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(distance) });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

test('a mouse notch changes board zoom gently and cancels native page zoom', async ({ page }) => {
  const errors = await openBoard(page);
  const anchor = { x: 500, y: 420 };
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(() => zoom(page)).toBeGreaterThan(1);
  expect(await zoom(page)).toBeLessThan(1.5);
  expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(errors).toEqual([]);
});

test('a burst on a zoomed document keeps the same point under the cursor after browser layout', async ({ page }) => {
  const errors = await openBoard(page);
  await enlarge(page);
  await page.locator('.whiteboard__pages').evaluate(node => { node.scrollTop = 260; node.scrollLeft = 100; });
  const anchor = { x: 480, y: 420 };
  const original = await documentPoint(page, anchor);
  const before = await zoom(page);
  await burst(page, anchor);
  await expect.poll(() => zoom(page)).toBeGreaterThan(before);
  await expect.poll(() => documentError(page, anchor, original)).toBeLessThan(3);
  expect(await page.evaluate(() => window.boardZoomFixture.operations.length)).toBe(0);
  expect(errors).toEqual([]);
});

test('a native two-finger pinch keeps its centre on the same document point without drawing', async ({ page }) => {
  const errors = await openBoard(page);
  await enlarge(page);
  await page.locator('.whiteboard__pages').evaluate(node => { node.scrollTop = 260; node.scrollLeft = 100; });
  const anchor = { x: 480, y: 420 };
  const original = await documentPoint(page, anchor);
  const before = await zoom(page);
  await pinch(page, anchor);
  await expect.poll(() => zoom(page)).toBeGreaterThan(before * 1.4);
  await expect.poll(() => documentError(page, anchor, original)).toBeLessThan(4);
  expect(await page.evaluate(() => window.boardZoomFixture.operations.length)).toBe(0);
  expect(errors).toEqual([]);
});

for (const fraction of [.3, .7]) test(`an off-centre pinch at ${fraction} from fit keeps the narrow page under the fingers`, async ({ page }) => {
  const errors = await openBoard(page);
  const rect = await page.locator('.whiteboard__page').first().boundingBox();
  const anchor = { x: rect.x + rect.width * fraction, y: rect.y + rect.height * .4 };
  const original = await documentPoint(page, anchor);
  await pinch(page, anchor);
  await expect.poll(() => zoom(page)).toBeGreaterThan(1.4);
  await expect.poll(() => documentError(page, anchor, original)).toBeLessThan(4);
  await pinch(page, anchor, 150, 100);
  await expect.poll(() => zoom(page)).toBeLessThan(1.02);
  await expect.poll(() => documentError(page, anchor, original)).toBeLessThan(4);
  expect(await page.evaluate(() => window.boardZoomFixture.operations.length)).toBe(0);
  expect(errors).toEqual([]);
});

test.describe('tablet touch-event input', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  test('pinch from fit keeps the touched point without duplicate pointer and touch gestures', async ({ page }) => {
    const errors = await openBoard(page);
    const rect = await page.locator('.whiteboard__page').first().boundingBox();
    const anchor = { x: rect.x + rect.width * .7, y: rect.y + rect.height * .4 };
    const original = await documentPoint(page, anchor);
    await pinch(page, anchor);
    await expect.poll(() => zoom(page)).toBeGreaterThan(1.4);
    expect(await zoom(page)).toBeLessThan(1.6);
    await expect.poll(() => documentError(page, anchor, original)).toBeLessThan(4);
    expect(await page.evaluate(() => window.boardZoomFixture.operations.length)).toBe(0);
    expect(errors).toEqual([]);
  });
});

test('paged canvas composes wheel events and keeps the cursor on the same drawing point', async ({ page }) => {
  const errors = await openBoard(page, 'paged');
  await enlarge(page);
  const anchor = { x: 480, y: 420 };
  const state = await page.locator('.whiteboard__surface').first().evaluate((node, anchor) => {
    const rect = node.getBoundingClientRect(), stage = window.boardZoomFixture.stages()[0];
    return { local: { x: anchor.x - rect.left, y: anchor.y - rect.top }, stage };
  }, anchor);
  const original = { x: (state.local.x - state.stage.x) / state.stage.scaleX, y: (state.local.y - state.stage.y) / state.stage.scaleY };
  await burst(page, anchor);
  await expect.poll(() => zoom(page)).toBeGreaterThan(2.44);
  const result = await page.evaluate(() => window.boardZoomFixture.stages()[0]);
  expect(result.scaleX).toBeGreaterThan(state.stage.scaleX * 1.05);
  expect(Math.hypot(result.x + original.x * result.scaleX - state.local.x, result.y + original.y * result.scaleY - state.local.y)).toBeLessThan(3);
  expect(errors).toEqual([]);
});

async function drawingPoint(page, layout, anchor) {
  if (layout === 'continuous') return documentPoint(page, anchor);
  return page.locator('.whiteboard__surface').first().evaluate((node, anchor) => {
    const rect = node.getBoundingClientRect(), stage = window.boardZoomFixture.stages()[0];
    return { x: (anchor.x - rect.x - stage.x) / stage.scaleX, y: (anchor.y - rect.y - stage.y) / stage.scaleY };
  }, anchor);
}

async function drawingError(page, layout, anchor, original) {
  if (layout === 'continuous') return documentError(page, anchor, original);
  return page.locator('.whiteboard__surface').first().evaluate((node, { anchor, original }) => {
    const rect = node.getBoundingClientRect(), stage = window.boardZoomFixture.stages()[0];
    return Math.hypot(rect.x + stage.x + original.x * stage.scaleX - anchor.x,
      rect.y + stage.y + original.y * stage.scaleY - anchor.y);
  }, { anchor, original });
}

async function trustedPlainBurst(page, anchor, count, deltaY) {
  const input = await page.context().newCDPSession(page);
  try {
    // CDP creates trusted wheel packets, like vertical trackpad motion. Queue
    // them together so a pending React frame cannot discard accumulated zoom.
    await Promise.all(Array.from({ length: count }, () => input.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: anchor.x, y: anchor.y, deltaX: 0, deltaY, modifiers: 0,
    })));
  } finally { await input.detach(); }
}

async function expectNoPageZoomOrInk(page) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1);
  expect(await page.evaluate(() => window.boardZoomFixture.operations.length)).toBe(0);
  const events = await page.evaluate(() => window.boardZoomFixture.wheelEvents);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every(event => event.trusted && !event.ctrl && !event.meta)).toBe(true);
}

for (const layout of ['continuous', 'paged']) {
  test(`plain trackpad wheel composes proportional zoom up and down at the cursor in ${layout} layout`, async ({ page }) => {
    const errors = await openBoard(page, layout);
    await enlarge(page);
    if (layout === 'continuous') {
      await page.locator('.whiteboard__pages').evaluate(node => { node.scrollTop = 260; node.scrollLeft = 100; });
    }
    const anchor = { x: 480, y: 420 };
    const original = await drawingPoint(page, layout, anchor);
    const before = await zoom(page);
    await trustedPlainBurst(page, anchor, 12, -4);
    await expect.poll(async () => Math.abs(await zoom(page) - before * Math.exp(48 * .002))).toBeLessThan(.025);
    await expect.poll(() => drawingError(page, layout, anchor, original)).toBeLessThan(3);

    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, 48);
    await expect.poll(async () => Math.abs(await zoom(page) - before)).toBeLessThan(.025);
    await expect.poll(() => drawingError(page, layout, anchor, original)).toBeLessThan(3);
    await expectNoPageZoomOrInk(page);
    expect(errors).toEqual([]);
  });

  test(`plain wheel also zooms from the PDF's blank margin in ${layout} layout`, async ({ page }) => {
    const errors = await openBoard(page, layout);
    const root = page.locator(layout === 'continuous' ? '.whiteboard__pages' : '.whiteboard__surface').first();
    const box = await root.boundingBox();
    let paper;
    if (layout === 'continuous') paper = await page.locator('.whiteboard__page').first().boundingBox();
    else {
      await expect.poll(() => page.evaluate(() => window.boardZoomFixture.paperBox()?.width ?? 0)).toBeGreaterThan(100);
      paper = await page.evaluate(() => window.boardZoomFixture.paperBox());
    }
    expect(paper.x - box.x).toBeGreaterThan(10);
    const anchor = { x: (box.x + paper.x) / 2, y: box.y + box.height * .45 };
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -80);
    await expect.poll(() => zoom(page)).toBeGreaterThan(1.1);
    expect(await zoom(page)).toBeLessThan(1.3);
    if (layout === 'paged') {
      // The outer gutter is outside the canvas, so the panel's own wheel
      // listener must delegate the same gesture to the active paged canvas.
      const pages = await page.locator('.whiteboard__pages').boundingBox();
      expect(box.x - pages.x).toBeGreaterThan(2);
      const before = await zoom(page);
      await page.mouse.move((pages.x + box.x) / 2, anchor.y);
      await page.mouse.wheel(0, -40);
      await expect.poll(() => zoom(page)).toBeGreaterThan(before);
    }
    await expectNoPageZoomOrInk(page);
    expect(errors).toEqual([]);
  });
}
