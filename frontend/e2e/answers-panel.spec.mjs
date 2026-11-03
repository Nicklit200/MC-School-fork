import { test, expect } from '@playwright/test';

const teacherId = '33333333-3333-4333-8333-333333333333';
const preferenceKey = `mindcrafti:answers-panel-width:v1:${teacherId}`;
const separator = page => page.getByRole('separator', { name: 'Изменить ширину решений', exact: true });
const width = async locator => (await locator.boundingBox()).width;

async function openEmptyTrial(page) {
  const errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error('[answers fixture pageerror]', error.message);
  });
  await page.goto('/e2e/fixtures/answers-panel.html');
  const toggle = page.getByRole('button', { name: 'Ответы', exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  const panel = page.locator('#answers-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('canvas')).toHaveCount(0);
  await expect(separator(page)).toBeVisible();
  return { panel, toggle, errors };
}

async function dragGrip(page, delta) {
  const grip = separator(page).locator('.answers-panel-resizer__grip');
  const box = await grip.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  expect(await grip.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return !!target?.closest('.answers-panel-resizer');
  })).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  const targetX = Math.max(1, Math.min(page.viewportSize().width - 1, x + delta));
  await page.mouse.move(targetX, y, { steps: 12 });
  await page.mouse.up();
}

async function expectSeparatedLayout(page, panel) {
  const main = page.locator('.online-class-room__stage > .online-class-room__main');
  const camera = page.locator('.camera-card[data-host="true"]:visible').first();
  await expect(camera).toBeVisible();
  const panelBox = await panel.boundingBox(), mainBox = await main.boundingBox(), cameraBox = await camera.boundingBox();
  expect(mainBox.width).toBeGreaterThanOrEqual(259);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(mainBox.x + 1);
  expect(mainBox.x + mainBox.width).toBeLessThanOrEqual(cameraBox.x + 1);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(cameraBox.x + 1);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 900 }]) {
  test(`empty answers panel keeps a visible oval and resizes beside videos at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { panel, toggle, errors } = await openEmptyTrial(page);
    const grip = separator(page).locator('.answers-panel-resizer__grip');
    await expect(grip).toBeVisible();
    const gripBox = await grip.boundingBox();
    expect(gripBox.width).toBeGreaterThanOrEqual(20);
    expect(gripBox.height).toBeGreaterThanOrEqual(50);

    await page.locator('.online-class-room__videos-toggle').click();
    await expect(page.locator('#online-class-videos')).toHaveAttribute('aria-hidden', 'false');
    await expectSeparatedLayout(page, panel);
    const initial = await width(panel);
    await dragGrip(page, 150);
    await expect.poll(() => width(panel)).toBeGreaterThan(initial + 100);
    const expanded = await width(panel);
    await expectSeparatedLayout(page, panel);
    await dragGrip(page, -80);
    await expect.poll(() => width(panel)).toBeLessThan(expanded - 50);
    const chosen = await width(panel);
    await expect.poll(() => page.evaluate(key => Number(localStorage.getItem(key)), preferenceKey)).toBeCloseTo(chosen, 0);

    await panel.getByRole('button', { name: 'Закрыть ответы', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect.poll(() => width(panel)).toBeCloseTo(chosen, 0);

    await dragGrip(page, viewport.width * 2);
    const maximum = Number(await separator(page).getAttribute('aria-valuemax'));
    await expect.poll(() => width(panel)).toBeCloseTo(maximum, 0);
    await expectSeparatedLayout(page, panel);
    await dragGrip(page, -viewport.width * 2);
    const minimum = Number(await separator(page).getAttribute('aria-valuemin'));
    await expect.poll(() => width(panel)).toBeCloseTo(minimum, 0);
    expect(minimum).toBeGreaterThanOrEqual(180);
    await expectSeparatedLayout(page, panel);
    expect(errors).toEqual([]);
  });
}

const pdfPage = page => page.locator('#answers-panel .answers-panel__page');
const pdfScroll = page => page.locator('#answers-panel .answers-panel__scroll');
const answersZoom = page => page.locator('#answers-panel .answers-panel__zoom > span');
const boardZoom = page => page.locator('.online-class-room__main .whiteboard__zoom-label');

async function nextFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function finishRaster(page) {
  await expect.poll(() => page.evaluate(() => window.answersPanelFixture.completed)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.answersPanelFixture.pending)).toBe(0);
  await nextFrames(page);
}

async function openPdfAnswers(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/e2e/fixtures/answers-panel.html?pdf=1');
  await page.getByRole('button', { name: 'Ответы', exact: true }).click();
  await expect(pdfPage(page)).toBeVisible();
  // The HTML canvas default is 300px. The real 560px pane at 200% needs a
  // raster over 600px; this cannot pass before pdf.js has completed and drawn it.
  await expect.poll(() => pdfPage(page).evaluate(canvas => canvas.width)).toBeGreaterThan(600);
  await finishRaster(page);
  await expect(answersZoom(page)).toHaveText('200%');
  const main = page.locator('.online-class-room__main');
  await main.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect(boardZoom(page)).toHaveText('125%');
  await pdfScroll(page).evaluate(element => { element.scrollLeft = 210; element.scrollTop = 350; });
  await nextFrames(page);
  return pdfScroll(page).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x + element.clientLeft + element.clientWidth * .64,
      y: box.y + element.clientTop + element.clientHeight * .46 };
  });
}

async function pagePoint(page, client) {
  return pdfPage(page).evaluate((canvas, point) => {
    const box = canvas.getBoundingClientRect();
    return { x: (point.x - box.x) / box.width, y: (point.y - box.y) / box.height };
  }, client);
}

async function expectPointAt(page, point, client, tolerance = 2.5) {
  await expect.poll(async () => pdfPage(page).evaluate((canvas, { point, client }) => {
    const box = canvas.getBoundingClientRect();
    return Math.max(Math.abs(box.x + box.width * point.x - client.x),
      Math.abs(box.y + box.height * point.y - client.y));
  }, { point, client })).toBeLessThan(tolerance);
}

async function expectZoomIsolation(page) {
  await expect(boardZoom(page)).toHaveText('125%');
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
}

test('two fingers keep off-centre PDF content under a moving midpoint before and after async raster replacement', async ({ page }) => {
  const anchor = await openPdfAnswers(page);
  const point = await pagePoint(page, anchor);
  const input = await page.context().newCDPSession(page);
  const touches = (center, distance) => [
    { id: 1, x: center.x - distance / 2, y: center.y },
    { id: 2, x: center.x + distance / 2, y: center.y },
  ];
  await page.evaluate(() => window.answersPanelFixture.hold());
  let touching = false;
  try {
    await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(anchor, 100) });
    touching = true;
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(anchor, 125) });
    await expect(answersZoom(page)).toHaveText('250%');
    await expectPointAt(page, point, anchor);
    await expect.poll(() => page.evaluate(() => window.answersPanelFixture.pending)).toBeGreaterThan(0);
    const shifted = { x: anchor.x + 24, y: anchor.y + 36 };
    // Same separation, a different midpoint: panning must work even when zoom is unchanged.
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(shifted, 125) });
    await expectPointAt(page, point, shifted);
    await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    touching = false;
    await expectZoomIsolation(page);
    await page.evaluate(() => window.answersPanelFixture.release());
    await finishRaster(page);
    await expectPointAt(page, point, shifted);
    await expectZoomIsolation(page);
  } finally {
    await page.evaluate(() => window.answersPanelFixture.release());
    if (touching) await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await input.detach();
  }
});

async function ctrlWheel(page, anchor, deltaY) {
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down('Control');
  try { await page.mouse.wheel(0, deltaY); } finally { await page.keyboard.up('Control'); }
  await nextFrames(page);
}

test('trackpad zoom stays at the cursor and safely clamps at both zoom and scroll boundaries', async ({ page }) => {
  const anchor = await openPdfAnswers(page);
  const point = await pagePoint(page, anchor);
  await ctrlWheel(page, anchor, -100);
  await expect(answersZoom(page)).not.toHaveText('200%');
  await expectPointAt(page, point, anchor);
  await finishRaster(page);
  await expectPointAt(page, point, anchor);
  for (let event = 0; event < 12; event++) await ctrlWheel(page, anchor, -300);
  await expect(answersZoom(page)).toHaveText('300%');
  await pdfScroll(page).evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = element.scrollHeight; });
  await nextFrames(page);
  for (let event = 0; event < 16; event++) await ctrlWheel(page, anchor, 300);
  await expect(answersZoom(page)).toHaveText('100%');
  await finishRaster(page);
  const bounds = await pdfScroll(page).evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop,
    maxLeft: element.scrollWidth - element.clientWidth, maxTop: element.scrollHeight - element.clientHeight }));
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.left).toBeLessThanOrEqual(bounds.maxLeft + 1);
  expect(bounds.top).toBeLessThanOrEqual(bounds.maxTop + 1);
  expect(bounds.left).toBeLessThanOrEqual(1);
  await expectZoomIsolation(page);
});

test('Safari gesture events preserve their off-centre PDF anchor and suppress page zoom', async ({ page }) => {
  const anchor = await openPdfAnswers(page);
  const point = await pagePoint(page, anchor);
  const prevented = await pdfScroll(page).evaluate((element, anchor) => {
    const send = (type, scale) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { scale, clientX: anchor.x, clientY: anchor.y });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    send('gesturestart', 1);
    const blocked = send('gesturechange', 1.25);
    send('gestureend', 1.25);
    return blocked;
  }, anchor);
  expect(prevented).toBe(true);
  await expect(answersZoom(page)).toHaveText('250%');
  await expectPointAt(page, point, anchor);
  await finishRaster(page);
  await expectPointAt(page, point, anchor);
  await expectZoomIsolation(page);
});
