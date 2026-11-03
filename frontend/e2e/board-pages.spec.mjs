import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const ids = { teacher: '33333333-3333-4333-8333-333333333333', owner: '11111111-1111-4111-8111-111111111111', peer: '22222222-2222-4222-8222-222222222222' };
const ownerTarget = `personal-workbook-${ids.owner}`;
const navigation = page => page.locator('.page-nav__label:visible').first();

function colorPdf(rgb = [.95, .7, .7]) {
  const stream = `${rgb.join(' ')} rg\n0 0 595 842 re f\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function worksheetServer(context, options = {}) {
  const documents = new Map(), operations = new Map();
  const personal = new Map(), opens = [];
  const assignPersonal = (targetId = ownerTarget) => personal.set(targetId, { bytes: colorPdf(), version: (personal.get(targetId)?.version || 0) + 1 });
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const role = new URL(request.frame().url()).searchParams.get('role') || 'teacher';
    const actorId = ids[role], target = `personal-workbook-${role === 'peer' ? ids.peer : ids.owner}`;
    const allowed = targetId => role === 'teacher' || targetId === 'board-1' || targetId === target || targetId === `personal-${actorId}`;
    if (url.pathname.endsWith('/document/version') || url.pathname.endsWith('/document')) {
      const boardId = url.searchParams.get('boardId') || 'board-1';
      if (boardId.startsWith('personal-workbook-')) {
        if (!allowed(boardId)) return route.fulfill({ status: 404, json: {} });
        if (options.probeGate && role === 'owner') await options.probeGate;
        const file = personal.get(boardId);
        if (url.pathname.endsWith('/version')) return route.fulfill({ json: { version: file?.version || 0 } });
        return file ? route.fulfill({ contentType: 'application/pdf', body: file.bytes }) : route.fulfill({ status: 404, json: {} });
      }
      if (url.pathname.endsWith('/version')) return route.fulfill({ json: { version: options.commonNone ? 0 : 1 } });
      return options.commonNone ? route.fulfill({ status: 404, json: {} }) : route.fulfill({ contentType: 'application/pdf', body: colorPdf([.87, .93, 1]) });
    }
    if (url.pathname.endsWith('/participants')) return route.fulfill({ json: Object.entries(ids).map(([role, userId]) => ({
      userId, displayName: role, classRole: role === 'teacher' ? 'HOST' : 'STUDENT', admissionState: 'ADMITTED',
    })) });
    if (url.pathname.endsWith('/annotations/documents')) {
      if (request.method() === 'GET') return route.fulfill({ json: [...documents.values()].filter(doc => allowed(doc.targetId)) });
      const targetId = url.searchParams.get('targetId');
      opens.push({ role, targetId });
      if (!allowed(targetId)) return route.fulfill({ status: 404, json: {} });
      const targetType = url.searchParams.get('targetType'), pageIndex = Number(url.searchParams.get('pageIndex'));
      let doc = [...documents.values()].find(doc => doc.targetId === targetId && doc.targetType === targetType && doc.pageIndex === pageIndex);
      if (!doc) {
        doc = { id: randomUUID(), targetId, targetType, pageIndex, sourceWidth: null, sourceHeight: null, revision: 0, snapshotSavedAt: null };
        documents.set(doc.id, doc); operations.set(doc.id, []);
      }
      return route.fulfill({ json: doc });
    }
    const match = url.pathname.match(/\/annotations\/documents\/([^/]+)\/operations$/);
    if (match) {
      const doc = documents.get(match[1]);
      if (!doc || !allowed(doc.targetId)) return route.fulfill({ status: 404, json: {} });
      const rows = operations.get(doc.id);
      if (request.method() === 'GET') return route.fulfill({ json: rows.filter(row => row.sequence > Number(url.searchParams.get('afterSequence') || 0)) });
      const input = request.postDataJSON();
      const row = { ...input, id: randomUUID(), sequence: rows.length + 1, actorId, layerOwnerId: actorId, createdAt: new Date().toISOString() };
      rows.push(row); doc.revision++;
      return route.fulfill({ json: row });
    }
    return route.fulfill({ json: [] });
  });
  const seedPage = (targetId, pageIndex, ink = false) => {
    const doc = { id: randomUUID(), targetId, targetType: 'WHITEBOARD', pageIndex, sourceWidth: null, sourceHeight: null, revision: ink ? 1 : 0, snapshotSavedAt: null };
    documents.set(doc.id, doc);
    operations.set(doc.id, ink ? [{ id: randomUUID(), operationId: randomUUID(), sequence: 1, actorId: ids.teacher, layerOwnerId: ids.teacher, operationType: 'ADD',
      payload: JSON.stringify({ kind: 'pen', color: '#123456', width: .005, points: [[.25, .3], [.5, .5]] }), createdAt: new Date().toISOString() }] : []);
    return doc;
  };
  return { documents, operations, personal, assignPersonal, seedPage, opens };
}

async function openWorksheet(context, role, packets = 'on') {
  const page = await context.newPage();
  await page.goto(`/e2e/fixtures/board-pages.html?role=${role}&packets=${packets}`);
  await expect(page.locator('.whiteboard__surface').first()).toBeVisible();
  await expect(navigation(page)).toHaveText('1 / 1');
  return page;
}

async function addPage(page) {
  await page.getByRole('button', { name: 'Добавить страницу', exact: true }).first().click();
}

async function writeOnCurrentPage(page) {
  const surface = page.locator('.whiteboard__page[aria-current="page"] .whiteboard__surface');
  const box = await surface.boundingBox(), x = box.x + box.width * .45, y = box.y + box.height * .4;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 45, y + 25, { steps: 6 }); await page.mouse.up();
}

test('an already-open pupil sees the teacher’s new blank worksheet page and its ink, while peers remain separate', async ({ context }) => {
  const server = await worksheetServer(context);
  const teacher = await openWorksheet(context, 'teacher');
  const owner = await openWorksheet(context, 'owner');
  const peer = await openWorksheet(context, 'peer');
  await owner.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect(owner.locator('.whiteboard__zoom-label')).toHaveText('125%');
  await addPage(teacher);
  await expect(navigation(teacher)).toHaveText('2 / 2');
  // Discovery adds a page without replacing the pupil's own navigation.
  await expect(navigation(owner)).toHaveText('1 / 2', { timeout: 7000 });
  await expect(owner.locator('.whiteboard__zoom-label')).toHaveText('125%');
  await expect(navigation(peer)).toHaveText('1 / 1');
  expect([...server.operations.values()].flat()).toHaveLength(0);

  await writeOnCurrentPage(teacher);
  await expect.poll(() => [...server.operations.values()].flat().length).toBe(1);
  await owner.getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
  await expect(navigation(owner)).toHaveText('2 / 2');
  await expect.poll(() => owner.evaluate(() => window.boardPagesFixture.savedInkCount(1))).toBe(1);
  await expect(navigation(peer)).toHaveText('1 / 1');
  const packets = await teacher.evaluate(targetId => window.boardPagesFixture.outgoing.filter(packet => packet.event.targetId === targetId), ownerTarget);
  expect(packets.length).toBeGreaterThan(0);
  for (const packet of packets) {
    expect(packet.destinations).toEqual([`${ids.owner}|browser`]);
  }
});

test('missed packets recover through polling and late entry preserves pupil-created blank pages', async ({ context }) => {
  const server = await worksheetServer(context);
  const teacher = await openWorksheet(context, 'teacher', 'off');
  const owner = await openWorksheet(context, 'owner', 'off');
  await addPage(teacher);
  await expect(navigation(owner)).toHaveText('1 / 2', { timeout: 7000 });
  await teacher.getByRole('button', { name: 'Увеличить', exact: true }).click();
  await expect(teacher.locator('.whiteboard__zoom-label')).toHaveText('125%');
  await addPage(owner);
  await expect(navigation(owner)).toHaveText('3 / 3');
  await expect(navigation(teacher)).toHaveText('2 / 3', { timeout: 7000 });
  await expect(teacher.locator('.whiteboard__zoom-label')).toHaveText('125%');
  expect([...server.operations.values()].flat()).toHaveLength(0);
  expect([...server.documents.values()].filter(doc => doc.targetId === ownerTarget)).toHaveLength(3);
  await owner.reload();
  await expect(navigation(owner)).toHaveText('1 / 3', { timeout: 7000 });
  await owner.getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
  await owner.getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
  await expect(navigation(owner)).toHaveText('3 / 3');
});

async function openUnified(context, role = 'owner', extra = '') {
  const page = await context.newPage();
  await page.goto(`/e2e/fixtures/board-pages.html?unified=1&role=${role}&${extra}`);
  await expect(page.locator('.whiteboard__surface:visible').first()).toBeVisible();
  return page;
}
const color = page => page.evaluate(() => window.boardPagesFixture.backgroundColor());
const blue = [221, 238, 255];
const expectPersonal = async page => expect.poll(async () => (await color(page))?.[2]).toBeLessThan(200);

test('only two pupil buttons choose a private PDF in My board while everyone keeps the common board', async ({ context }) => {
  const server = await worksheetServer(context);
  server.assignPersonal();
  const owner = await openUnified(context);
  const peer = await openUnified(context, 'peer');
  await expect(owner.locator('#source-switcher button')).toHaveCount(2);
  await expect(owner.getByRole('button', { name: 'Персональный лист', exact: true })).toHaveCount(0);
  await expectPersonal(owner);
  await expect.poll(() => color(peer)).toEqual(blue);
  await owner.getByRole('button', { name: 'Общая доска', exact: true }).click();
  await expect.poll(() => color(owner)).toEqual(blue);
  await owner.getByRole('button', { name: 'Моя доска', exact: true }).click();
  await expectPersonal(owner);
});

test('My board resolves live personal uploads and remains blank when neither document exists', async ({ context }) => {
  const server = await worksheetServer(context, { commonNone: true });
  const owner = await openUnified(context, 'owner', 'common=none');
  await expect.poll(() => owner.evaluate(() => window.boardPagesFixture.visibleStages())).toBeGreaterThan(0);
  expect(await color(owner)).toBeNull();
  server.assignPersonal();
  await expect.poll(async () => (await color(owner))?.[2], { timeout: 10000 }).toBeLessThan(200);
  const peer = await openUnified(context, 'peer', 'common=none');
  expect(await color(peer)).toBeNull();
  await expect(peer.locator('#source-switcher button')).toHaveCount(2);
});

test('a delayed private probe never flashes common ink, and existing private pages reopen through My board', async ({ context }) => {
  let release;
  const probeGate = new Promise(resolve => { release = resolve; });
  const server = await worksheetServer(context, { probeGate });
  server.assignPersonal();
  const oldOrdinary = server.seedPage(`personal-${ids.owner}`, 0, true);
  server.seedPage(ownerTarget, 2, true);
  const owner = await context.newPage();
  await owner.goto('/e2e/fixtures/board-pages.html?unified=1&role=owner');
  await expect(owner.getByText('Загружаем доску…')).toBeVisible();
  expect(server.opens.some(open => open.role === 'owner' && open.targetId === `personal-${ids.owner}`)).toBe(false);
  release();
  await expect(owner.locator('.whiteboard__surface:visible').first()).toBeVisible();
  await expectPersonal(owner);
  await expect(navigation(owner)).toHaveText('1 / 3');
  expect(await owner.evaluate(() => window.boardPagesFixture.savedInkCount(0))).toBe(0);
  await owner.getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
  await owner.getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
  await expect.poll(() => owner.evaluate(() => window.boardPagesFixture.savedInkCount(2))).toBe(1);
  expect(server.operations.get(oldOrdinary.id)).toHaveLength(1);
  const frames = await owner.evaluate(() => window.boardPagesFixture.frames);
  expect(frames.some(frame => frame && frame.join(',') === '221,238,255')).toBe(false);
  const teacher = await openUnified(context, 'teacher', 'observed=1');
  await expect(navigation(teacher)).toHaveText('3 / 3');
  await expect.poll(() => teacher.evaluate(() => window.boardPagesFixture.savedInkCount(2))).toBe(1);
});
