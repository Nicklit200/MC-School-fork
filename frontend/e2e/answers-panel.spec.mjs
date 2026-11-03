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
