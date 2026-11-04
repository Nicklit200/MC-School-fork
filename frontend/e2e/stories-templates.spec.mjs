import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';

const admin = { id: '88888888-8888-4888-8888-888888888888', role: 'ADMIN',
  fullName: 'Stories Browser Admin', email: 'stories@example.invalid', preferredLanguage: 'RU' };
const studio = page => page.frameLocator('iframe[title="Mindcrafti Stories Studio"]');
const rendered = page => studio(page).frameLocator('#storyFrame');

async function openStudio(page) {
  // Only the public, shipped bootstrap is used. A real pupil's cloud project
  // and transcript never enter this browser fixture or the repository.
  const html = await readFile(new URL('../src/pages/admin/mindcrafti-studio.html', import.meta.url), 'utf8');
  const boot = JSON.parse(html.match(/<script\b[^>]*id=["']bootstrap-data["'][^>]*>([\s\S]*?)<\/script>/i)[1]);
  const initial = { schema: 'mindcrafti.story-studio/1', story: { ...boot.story,
    headline_1: 'Новости из облака', customBrowserField: { preserved: true } },
    css: boot.storyCSS, html: boot.storyHTML, assets: { logoSrc: boot.logoSrc } };
  const cloud = { project: initial, version: 7, writes: [], errors: [] };
  const snapshot = () => {
    const projectJson = JSON.stringify(cloud.project), sizeBytes = Buffer.byteLength(projectJson);
    return { configured: true, version: cloud.version,
      sha256: createHash('sha256').update(projectJson).digest('hex'), sizeBytes,
      chunkCount: Math.ceil(sizeBytes / 65536), updatedAt: '2026-11-04T12:00:00Z', projectJson };
  };
  page.on('pageerror', error => cloud.errors.push(error.message));
  await page.addInitScript(user => {
    // Auth belongs to the application document. The editor deliberately has
    // an opaque sandbox origin and must not access the parent's storage.
    if (window.top !== window) return;
    localStorage.setItem('language', 'RU');
    localStorage.setItem('accessToken', 'browser-fixture-only');
    localStorage.setItem('authUser', JSON.stringify(user));
  }, admin);
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: admin });
    if (path.endsWith('/admin/stories/master')) return route.fulfill({ json: { configured: false } });
    if (path.endsWith('/admin/stories/studio')) {
      if (route.request().method() === 'GET') return route.fulfill({ json: snapshot() });
      const body = route.request().postDataJSON();
      cloud.writes.push(body);
      if (body.expectedVersion !== cloud.version) return route.fulfill({ status: 409, json: { message: 'Version changed' } });
      cloud.project = JSON.parse(body.projectJson);
      cloud.version++;
      return route.fulfill({ json: snapshot() });
    }
    return route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/admin/stories');
  await expect(studio(page).locator('#templateTabs [role="tab"]')).toHaveCount(2);
  await expect(rendered(page).locator('.headline').first()).toHaveText('Новости из облака');
  return cloud;
}

async function selectTemplate(page, id) {
  await studio(page).locator(`[data-template="${id}"]`).click();
  await expect(studio(page).locator(`[data-template="${id}"]`)).toHaveAttribute('aria-selected', 'true');
}

test('a legacy cloud Story becomes two renameable independent templates and saves the complete v2 collection', async ({ page }) => {
  const cloud = await openStudio(page);
  await studio(page).locator('#templateName').fill('Школьные новости');
  await studio(page).locator('#renameTemplateBtn').click();
  await studio(page).locator('#tabContent').click();
  await studio(page).locator('[data-content="headline_1"]').fill('Мои школьные новости');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Мои школьные новости');

  await selectTemplate(page, 'template-2');
  await studio(page).locator('#templateName').fill('Результаты за период');
  await studio(page).locator('#renameTemplateBtn').click();
  await studio(page).locator('#tabContent').click();
  await studio(page).locator('[data-content="student_label"]').fill('Ученица-пример');
  await studio(page).locator('[data-content="problem_text"]').fill('Разбираем учебный пример с дробями');
  await studio(page).locator('[data-content="narrative"]').fill('В учебном примере сопоставляем два сохранённых значения по каждому навыку. Поля этой карточки можно менять независимо от других шаблонов.');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Ученица-пример');
  await expect(rendered(page).locator('.pill-label')).toHaveText('Результаты учеников');
  await expect(rendered(page).locator('.skill-delta')).toHaveText(['+27%', '+8%']);
  await expect(rendered(page).locator('.tube-value')).toHaveText(['55%', '70%', '65%', '70%']);
  expect(await rendered(page).locator('.story').innerText()).not.toMatch(/[\u2013\u2014]|п\.п\./u);
  const geometry = await rendered(page).locator('.progress-intro').evaluate(intro => {
    const box = intro.getBoundingClientRect(), style = getComputedStyle(intro);
    return { bottom: box.bottom, maxChildBottom: Math.max(...[...intro.children].map(child => child.getBoundingClientRect().bottom)),
      contentBottom: box.bottom - parseFloat(style.paddingBottom),
      clipped: [...intro.children].some(child => child.scrollHeight > child.clientHeight + 1),
      nextTop: document.querySelector('.skill-card').getBoundingClientRect().top,
      finalBottom: [...document.querySelectorAll('.skill-card')].at(-1).getBoundingClientRect().bottom };
  });
  expect(geometry.maxChildBottom).toBeLessThanOrEqual(geometry.contentBottom + 1);
  expect(geometry.clipped).toBe(false);
  expect(geometry.nextTop).toBeGreaterThan(geometry.bottom + 10);
  expect(geometry.finalBottom).toBeLessThanOrEqual(1570);

  await selectTemplate(page, 'template-1');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Мои школьные новости');
  await expect(studio(page).locator('#templateName')).toHaveValue('Школьные новости');
  await selectTemplate(page, 'template-2');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Ученица-пример');
  await expect.poll(() => cloud.project.schema).toBe('mindcrafti.story-studio/2');
  await expect.poll(() => cloud.project.activeTemplateId).toBe('template-2');
  await expect.poll(() => cloud.project.templates?.map(template => template.name)).toEqual(['Школьные новости', 'Результаты за период']);
  await expect.poll(() => cloud.project.templates?.[1].story.student_label).toBe('Ученица-пример');
  expect(cloud.project.templates[0].story.customBrowserField).toEqual({ preserved: true });
  expect(cloud.writes[0].expectedVersion).toBe(7);
  expect(cloud.project.assets.logoSrc).toBeTruthy();
  expect(cloud.project.templates[0].css).toContain('--accent: #FF6A00');

  await page.reload();
  await expect(studio(page).locator('[data-template="template-2"]')).toHaveAttribute('aria-selected', 'true');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Ученица-пример');
  await expect(studio(page).locator('#templateName')).toHaveValue('Результаты за период');
  await selectTemplate(page, 'template-1');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Мои школьные новости');
  expect(cloud.errors).toEqual([]);
});

async function download(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  return { filename: result.suggestedFilename(), bytes: await readFile(await result.path()) };
}

test('compiled HTML and PNG export the active renamed template while the whole project retains both designs', async ({ page }) => {
  const cloud = await openStudio(page);
  await selectTemplate(page, 'template-2');
  await studio(page).locator('#templateName').fill('Результаты примера');
  await studio(page).locator('#renameTemplateBtn').click();
  await studio(page).locator('#tabContent').click();
  await studio(page).locator('[data-content="student_label"]').fill('Публичный пример');
  await studio(page).locator('[data-content="narrative"]').fill('Шаг первый — знакомимся с примером. Шаг второй – сравниваем оценки.');
  await expect(rendered(page).locator('.headline').first()).toHaveText('Публичный пример');
  const resultsHtml = await download(page, () => studio(page).locator('#exportHtmlBtn').click());
  expect(resultsHtml.filename).toContain('Результаты примера');
  expect(resultsHtml.filename).toMatch(/\.html$/);
  const output = resultsHtml.bytes.toString('utf8');
  expect(output).toContain('Публичный пример');
  expect(output).toContain('Результаты учеников');
  expect(output).toContain('+27%');
  expect(output).not.toMatch(/\{\{(?:student_label|skill_1_)|[\u2013\u2014]|п\.п\./u);
  const resultsPng = await download(page, () => studio(page).locator('#exportPngBtn').click());
  expect(resultsPng.filename).toContain('Результаты примера');
  expect(resultsPng.filename).toMatch(/\.png$/);
  expect(resultsPng.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(resultsPng.bytes.readUInt32BE(16)).toBe(1080);
  expect(resultsPng.bytes.readUInt32BE(20)).toBe(1920);
  expect(resultsPng.bytes.length).toBeGreaterThan(1000);

  await selectTemplate(page, 'template-1');
  const newsHtml = await download(page, () => studio(page).locator('#exportHtmlBtn').click());
  expect(newsHtml.bytes.toString('utf8')).toContain('Новости из облака');
  expect(newsHtml.bytes.toString('utf8')).not.toContain('Публичный пример');
  expect(newsHtml.filename).not.toBe(resultsHtml.filename);
  const project = await download(page, () => studio(page).locator('#saveProjectBtn').click());
  const saved = JSON.parse(project.bytes.toString('utf8'));
  expect(saved.schema).toBe('mindcrafti.story-studio/2');
  expect(saved.activeTemplateId).toBe('template-1');
  expect(saved.templates).toHaveLength(2);
  expect(saved.templates[1].story.student_label).toBe('Публичный пример');
  expect(cloud.errors).toEqual([]);
});

test('full-scale change survives a cloud save and reload and exports the same compiled labels', async ({ page }) => {
  const cloud = await openStudio(page);
  await selectTemplate(page, 'template-2');
  await studio(page).locator('[data-code="json"]').click();
  const editor = studio(page).locator('#codeEditor');
  const story = JSON.parse(await editor.inputValue());
  story.assessment = { ...story.assessment, growthMetric: 'scale_percent' };
  await editor.fill(JSON.stringify(story, null, 2));
  await expect(rendered(page).locator('.skill-delta')).toHaveText(['+15% шкалы', '+5% шкалы']);
  await expect.poll(() => cloud.project.templates?.[1].story.assessment?.growthMetric).toBe('scale_percent');
  expect(cloud.project.templates[1].story.skills.map(({ before, after }) => [before, after])).toEqual([[55,70],[65,70]]);
  const savedVersion = cloud.version;

  await page.reload();
  await expect(studio(page).locator('[data-template="template-2"]')).toHaveAttribute('aria-selected', 'true');
  await expect(rendered(page).locator('.skill-delta')).toHaveText(['+15% шкалы', '+5% шкалы']);
  expect(cloud.version).toBeGreaterThanOrEqual(savedVersion);
  const exported = await download(page, () => studio(page).locator('#exportHtmlBtn').click());
  const labels = await page.evaluate(output => {
    const document = new DOMParser().parseFromString(output, 'text/html');
    return [...document.querySelectorAll('.skill-delta')].map(node => node.textContent);
  }, exported.bytes.toString('utf8'));
  expect(labels).toEqual(['+15% шкалы', '+5% шкалы']);
  expect(exported.bytes.toString('utf8')).not.toMatch(/\{\{skill_\d_change_percent\}\}/u);
  expect(cloud.errors).toEqual([]);
});
