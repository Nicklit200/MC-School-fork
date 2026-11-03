import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const ids = { teacher: '33333333-3333-4333-8333-333333333333', owner: '11111111-1111-4111-8111-111111111111', peer: '22222222-2222-4222-8222-222222222222' };
const ownerTarget = `personal-workbook-${ids.owner}`;
const navigation = page => page.locator('.page-nav__label').first();

async function worksheetServer(context) {
  const documents = new Map(), operations = new Map();
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const role = new URL(request.frame().url()).searchParams.get('role') || 'teacher';
    const actorId = ids[role], target = `personal-workbook-${role === 'peer' ? ids.peer : ids.owner}`;
    const allowed = targetId => role === 'teacher' || targetId === target;
    if (url.pathname.endsWith('/participants')) return route.fulfill({ json: Object.entries(ids).map(([role, userId]) => ({
      userId, displayName: role, classRole: role === 'teacher' ? 'HOST' : 'STUDENT', admissionState: 'ADMITTED',
    })) });
    if (url.pathname.endsWith('/annotations/documents')) {
      if (request.method() === 'GET') return route.fulfill({ json: [...documents.values()].filter(doc => allowed(doc.targetId)) });
      const targetId = url.searchParams.get('targetId');
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
  return { documents, operations };
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
