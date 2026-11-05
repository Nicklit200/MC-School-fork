import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';

// Anonymous fixtures only. These identities and PDFs are unrelated to real pupils.
const ids = {
  teacher: '33333333-3333-4333-8333-333333333333',
  owner: '11111111-1111-4111-8111-111111111111',
  peer: '22222222-2222-4222-8222-222222222222',
  third: '44444444-4444-4444-8444-444444444444',
};
const pupilRoles = ['owner', 'peer', 'third'];
const names = { owner: 'Owner', peer: 'Peer', third: 'Third' };
const colors = { owner: [242, 178, 178], peer: [178, 230, 178], third: [242, 217, 153] };
const blue = [221, 238, 255];
const target = role => `personal-workbook-${ids[role]}`;
const navigation = page => page.locator('.page-nav__label:visible').first();
const background = page => page.evaluate(() => window.boardPagesFixture.backgroundColor());
const ink = (page, index = 0) => page.evaluate(index => window.boardPagesFixture.visibleInkCount(index), index);

function worksheetPdf(label, color, pageCount = 1) {
  const stream = `${color.map(value => value / 255).join(' ')} rg\n0 0 595 842 re f\n0 0 0 rg\nBT /F1 24 Tf 50 760 Td (QA WORKSHEET ${label}) Tj ET\n`;
  const fontId = 3 + pageCount * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`,
  ];
  for (let index = 0; index < pageCount; index++) objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  );
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function testServer() {
  const files = new Map(), documents = new Map(), operations = new Map();
  const requests = [], uploads = [], delivered = [];
  const metadata = role => ({
    studentId: ids[role], studentName: names[role], hasWorkbook: files.has(target(role)),
    filename: files.get(target(role))?.filename ?? null, version: files.get(target(role))?.version ?? 0,
    hasAnswers: false, answersFilename: null, answersVersion: 0,
  });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' };
  async function attach(context, role) {
    const actorId = ids[role];
    const allowed = boardId => role === 'teacher' || boardId === 'board-1' || boardId === target(role) || boardId === `personal-${actorId}`;
    await context.route('**/api/v1/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const fulfill = options => route.fulfill({ headers: cors, ...options });
      if (request.method() === 'OPTIONS') return fulfill({ status: 204 });
      requests.push({ role, method: request.method(), path: url.pathname, boardId: url.searchParams.get('boardId') });
      if (url.pathname.endsWith('/personal-workbooks') && request.method() === 'GET') {
        return role === 'teacher' ? fulfill({ json: { enabled: true, students: pupilRoles.map(metadata) } }) : fulfill({ status: 403 });
      }
      const upload = url.pathname.match(/\/personal-workbooks\/([^/]+)$/);
      if (upload && request.method() === 'POST') {
        if (role !== 'teacher') return fulfill({ status: 403 });
        const pupil = pupilRoles.find(pupil => ids[pupil] === upload[1]);
        if (!pupil) return fulfill({ status: 404 });
        const multipart = request.postDataBuffer();
        const start = multipart.indexOf('%PDF-'), end = multipart.lastIndexOf('%%EOF');
        if (start < 0 || end < start) return fulfill({ status: 400 });
        const filename = request.postData().match(/filename="([^"]+)"/)?.[1] ?? 'worksheet.pdf';
        files.set(target(pupil), { bytes: multipart.subarray(start, end + 5), filename, version: (files.get(target(pupil))?.version ?? 0) + 1 });
        uploads.push({ role, pupil, filename });
        return fulfill({ json: metadata(pupil) });
      }
      if (url.pathname.includes('/personal-answers/') || url.pathname.endsWith('/answers')) {
        return fulfill({ status: role === 'teacher' ? 404 : 403 });
      }
      if (url.pathname.endsWith('/document/version') || url.pathname.endsWith('/document')) {
        const boardId = url.searchParams.get('boardId') || 'board-1';
        if (!allowed(boardId)) return fulfill({ status: 404 });
        const file = files.get(boardId);
        if (url.pathname.endsWith('/version')) return fulfill({ json: { version: file?.version ?? 0 } });
        return file ? fulfill({ contentType: 'application/pdf', body: file.bytes }) : fulfill({ status: 404 });
      }
      if (url.pathname.endsWith('/participants')) return fulfill({ json: Object.entries(ids).map(([participantRole, userId]) => ({
        userId, displayName: participantRole, classRole: participantRole === 'teacher' ? 'HOST' : 'STUDENT', admissionState: 'ADMITTED',
      })) });
      if (url.pathname.endsWith('/annotations/documents')) {
        if (request.method() === 'GET') return fulfill({ json: [...documents.values()].filter(doc => allowed(doc.targetId)) });
        const targetId = url.searchParams.get('targetId');
        if (!allowed(targetId)) return fulfill({ status: 404 });
        const targetType = url.searchParams.get('targetType'), pageIndex = Number(url.searchParams.get('pageIndex'));
        let doc = [...documents.values()].find(doc => doc.targetId === targetId && doc.targetType === targetType && doc.pageIndex === pageIndex);
        if (!doc) {
          doc = { id: randomUUID(), targetId, targetType, pageIndex, sourceWidth: null, sourceHeight: null, revision: 0, snapshotSavedAt: null };
          documents.set(doc.id, doc); operations.set(doc.id, []);
        }
        return fulfill({ json: doc });
      }
      const match = url.pathname.match(/\/annotations\/documents\/([^/]+)\/operations$/);
      if (match) {
        const doc = documents.get(match[1]);
        if (!doc || !allowed(doc.targetId)) return fulfill({ status: 404 });
        const rows = operations.get(doc.id);
        if (request.method() === 'GET') return fulfill({ json: rows.filter(row => row.sequence > Number(url.searchParams.get('afterSequence') || 0)) });
        const input = request.postDataJSON();
        const previous = rows.find(row => row.operationId === input.operationId);
        if (previous) return fulfill({ json: previous });
        const row = { ...input, id: randomUUID(), sequence: rows.length + 1, actorId, layerOwnerId: actorId, createdAt: new Date().toISOString() };
        rows.push(row); doc.revision++;
        return fulfill({ json: row });
      }
      return fulfill({ json: [] });
    });
  }
  const rows = (role, pageIndex = 0) => [...documents.values()].filter(doc => doc.targetId === target(role) && doc.pageIndex === pageIndex)
    .flatMap(doc => operations.get(doc.id));
  return { attach, files, documents, requests, uploads, delivered, rows };
}

async function write(page, offset = 0) {
  const surface = page.locator('.whiteboard__page[aria-current="page"] .whiteboard__surface:visible');
  const box = await surface.boundingBox(), x = box.x + box.width * .35, y = box.y + box.height * (.35 + offset);
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 55, y + 25, { steps: 8 }); await page.mouse.up();
}

test('three isolated pupils receive separate PDFs, solve concurrently and restore private work after reload', async ({ browser }, testInfo) => {
  const server = testServer(), clients = [], errors = [];
  try {
    for (const role of ['teacher', ...pupilRoles]) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, hasTouch: true });
      await server.attach(context, role);
      const client = { role, context, page: null };
      clients.push(client);
      await context.exposeBinding('group1QaPublish', async (_source, packet) => {
        for (const recipient of clients) {
          if (!recipient.page || recipient.role === role || (packet.destinations && !packet.destinations.includes(`${ids[recipient.role]}|browser`))) continue;
          server.delivered.push({ sender: role, recipient: recipient.role, event: JSON.parse(new TextDecoder().decode(new Uint8Array(packet.bytes))) });
          await recipient.page.evaluate(packet => window.group1QaReceive?.(packet), packet).catch(() => undefined);
        }
      });
      const page = client.page = await context.newPage();
      page.on('pageerror', error => errors.push(`${role}: ${error.message}`));
      await page.goto(`http://127.0.0.1:4175/e2e/fixtures/board-pages.html?unified=1&trio=1&role=${role}`);
      await expect(page.locator('.whiteboard__surface:visible').first()).toBeVisible();
      await expect.poll(() => background(page)).toEqual(blue);
    }
    const teacher = clients[0].page;
    const pupils = clients.slice(1).map(client => client.page);
    const preparation = await clients[0].context.newPage();
    await preparation.goto('http://127.0.0.1:4175/e2e/fixtures/board-pages.html?trio=1&role=teacher&prep=1');
    await expect(preparation.getByRole('heading', { name: 'Листы учеников', exact: true })).toBeVisible();
    for (const [index, role] of pupilRoles.entries()) {
      await preparation.getByLabel(`Лист для ${names[role]}`, { exact: true }).setInputFiles({
        name: `worksheet-${index + 1}.pdf`, mimeType: 'application/pdf', buffer: worksheetPdf(String(index + 1), colors[role]),
      });
      await expect(preparation.getByRole('group', { name: names[role], exact: true })).toContainText(`worksheet-${index + 1}.pdf`);
      await expect(preparation.getByLabel(`Лист для ${names[role]}`, { exact: true })).toBeEnabled();
    }
    await Promise.all(pupils.map((page, index) => expect.poll(() => background(page), { timeout: 10000 }).toEqual(colors[pupilRoles[index]])));
    for (const page of pupils) await expect(page.locator('#source-switcher button')).toHaveCount(2);
    await Promise.all(pupils.map(page => write(page)));
    for (const [index, role] of pupilRoles.entries()) {
      await expect.poll(() => server.rows(role).length).toBe(1);
      expect(server.rows(role)[0].actorId).toBe(ids[role]);
      await expect.poll(() => ink(pupils[index])).toBe(1);
      await teacher.locator('#source-switcher select').selectOption(`personal-${ids[role]}`);
      await expect.poll(() => background(teacher)).toEqual(colors[role]);
      await expect.poll(() => ink(teacher)).toBe(1);
    }
    await teacher.locator('#source-switcher select').selectOption(`personal-${ids.owner}`);
    await expect.poll(() => background(teacher)).toEqual(colors.owner);
    await write(teacher, .1);
    await expect.poll(() => server.rows('owner').length).toBe(2);
    await expect.poll(() => ink(pupils[0])).toBe(2);
    expect(server.rows('peer')).toHaveLength(1); expect(server.rows('third')).toHaveLength(1);
    expect(server.delivered.filter(row => row.event.targetId === target('owner')).every(row => row.recipient === 'teacher' || row.recipient === 'owner')).toBe(true);

    // Simulate lost realtime packets for a reload, then recover durable REST state.
    await Promise.all(pupils.map(page => page.reload()));
    for (const [index, role] of pupilRoles.entries()) {
      await expect.poll(() => background(pupils[index]), { timeout: 10000 }).toEqual(colors[role]);
      await expect.poll(() => ink(pupils[index])).toBe(role === 'owner' ? 2 : 1);
    }
    await teacher.locator('#source-switcher select').selectOption(`personal-${ids.peer}`);
    await expect.poll(() => background(teacher)).toEqual(colors.peer);
    await teacher.getByRole('button', { name: 'Добавить страницу', exact: true }).first().click();
    await expect(navigation(pupils[1])).toHaveText('1 / 2', { timeout: 10000 });
    await expect(navigation(pupils[0])).toHaveText('1 / 1'); await expect(navigation(pupils[2])).toHaveText('1 / 1');
    await pupils[1].getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
    await write(pupils[1]);
    await expect.poll(() => server.rows('peer', 1).length).toBe(1);
    await pupils[1].reload();
    await expect(navigation(pupils[1])).toHaveText('1 / 2', { timeout: 10000 });
    await pupils[1].getByRole('button', { name: 'Следующая страница', exact: true }).first().click();
    await expect.poll(() => ink(pupils[1], 1)).toBe(1);

    // A same-name replacement affects one private PDF, not peers or saved ink.
    const revisedColor = [204, 178, 242];
    await preparation.getByLabel('Лист для Third', { exact: true }).setInputFiles({
      name: 'worksheet-3.pdf', mimeType: 'application/pdf', buffer: worksheetPdf('3 REVISED', revisedColor),
    });
    await expect.poll(() => background(pupils[2]), { timeout: 10000 }).toEqual(revisedColor);
    await expect.poll(() => ink(pupils[2])).toBe(1);
    expect(server.files.get(target('owner')).version).toBe(1);
    expect(server.files.get(target('peer')).version).toBe(1);
    expect(server.files.get(target('third')).version).toBe(2);
    for (const [index, role] of pupilRoles.entries()) {
      const page = pupils[index];
      await page.getByRole('button', { name: 'Общая доска', exact: true }).click();
      await expect.poll(() => background(page)).toEqual(blue);
      await expect.poll(() => ink(page)).toBe(0);
      await page.getByRole('button', { name: 'Моя доска', exact: true }).click();
      if (role === 'peer') {
        await expect(navigation(page)).toHaveText('2 / 2');
        await expect.poll(() => ink(page, 1)).toBe(1);
        await page.getByRole('button', { name: 'Предыдущая страница', exact: true }).first().click();
      }
      await expect.poll(() => background(page)).toEqual(role === 'third' ? revisedColor : colors[role]);
    }
    const pupilRequests = server.requests.filter(row => row.role !== 'teacher');
    expect(pupilRequests.filter(row => row.path.includes('/answers'))).toHaveLength(0);
    expect(pupilRequests.filter(row => row.boardId?.startsWith('personal-workbook-')).every(row => row.boardId === target(row.role))).toBe(true);
    expect(server.uploads.map(row => row.pupil)).toEqual(['owner', 'peer', 'third', 'third']);
    expect(errors).toEqual([]);

    const output = process.env.GROUP1_QA_OUTPUT_DIR || testInfo.outputPath('proof');
    await mkdir(output, { recursive: true });
    for (const [index, page] of pupils.entries()) await page.screenshot({ path: join(output, `group1-pupil-${index + 1}.png`) });
    await teacher.locator('#source-switcher select').selectOption('board-1');
    await expect.poll(() => background(teacher)).toEqual(blue);
    await teacher.screenshot({ path: join(output, 'group1-teacher-shared.png') });
  } finally {
    await Promise.all(clients.map(client => client.context.close()));
  }
});

async function parallelTouchSwipe(page, dy, jitter = 0, vertical = false) {
  const session = await page.context().newCDPSession(page);
  const points = (progress, spanJitter) => vertical ? [
    { x: 480, y: 370 + dy * progress - spanJitter / 2, id: 1 },
    { x: 480, y: 490 + dy * progress + spanJitter / 2, id: 2 },
  ] : [
    { x: 420 - spanJitter / 2, y: 430 + dy * progress, id: 1 },
    { x: 540 + spanJitter / 2, y: 430 + dy * progress, id: 2 },
  ];
  const zooms = [], widths = [];
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0, 0) });
    for (let step = 1; step <= 10; step++) {
      const progress = step / 10;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: points(progress, -jitter * Math.sin(progress * Math.PI)),
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      zooms.push(await page.locator('.whiteboard__zoom-label:visible').innerText());
      widths.push(await page.locator('.whiteboard__page:visible').first().evaluate(node => node.getBoundingClientRect().width));
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return { zooms, widths };
  } finally { await session.detach(); }
}

for (const enlarged of [false, true]) test(`tablet parallel two-finger swipes scroll a private PDF without zoom or ink ${enlarged ? 'when enlarged' : 'at fit'}`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const server = testServer(), errors = [];
  try {
    await server.attach(context, 'owner');
    server.files.set(target('owner'), { bytes: worksheetPdf('TABLET', colors.owner, 3), filename: 'tablet.pdf', version: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4175/e2e/fixtures/board-pages.html?unified=1&trio=1&role=owner&layout=continuous');
    await expect.poll(() => background(page), { timeout: 10000 }).toEqual(colors.owner);
    if (enlarged) {
      for (let step = 0; step < 4; step++) await page.getByRole('button', { name: 'Увеличить', exact: true }).click();
      await expect.poll(async () => parseFloat(await page.locator('.whiteboard__zoom-label:visible').innerText())).toBeGreaterThan(200);
    }
    const root = page.locator('.whiteboard__pages:visible');
    await root.evaluate(node => { node.scrollTop = 220; });
    const beforeZoom = await page.locator('.whiteboard__zoom-label:visible').innerText();
    const beforeWidth = await page.locator('.whiteboard__page:visible').first().evaluate(node => node.getBoundingClientRect().width);
    for (const { jitter, vertical } of [{ jitter: 0, vertical: false }, { jitter: 0, vertical: true }, { jitter: 1.5, vertical: false }]) {
      const before = await root.evaluate(node => node.scrollTop);
      const up = await parallelTouchSwipe(page, -100, jitter, vertical);
      await expect.poll(() => root.evaluate(node => node.scrollTop)).toBeGreaterThan(before + 30);
      const afterUp = await root.evaluate(node => node.scrollTop);
      const down = await parallelTouchSwipe(page, 80, jitter, vertical);
      await expect.poll(() => root.evaluate(node => node.scrollTop)).toBeLessThan(afterUp - 20);
      expect([...up.zooms, ...down.zooms], `Parallel swipe: ${JSON.stringify({ jitter, vertical, beforeZoom })}`)
        .toEqual(Array(up.zooms.length + down.zooms.length).fill(beforeZoom));
      expect([...up.widths, ...down.widths].every(value => Math.abs(value - beforeWidth) < .5)).toBe(true);
      expect(await page.locator('.whiteboard__zoom-label:visible').innerText()).toBe(beforeZoom);
    }
    expect([...server.documents.values()].flatMap(doc => server.rows('owner', doc.pageIndex))).toHaveLength(0);
    expect(await page.evaluate(() => window.visualViewport.scale)).toBe(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(errors).toEqual([]);
    const output = process.env.GROUP1_QA_OUTPUT_DIR || testInfo.outputPath('proof');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, `group1-tablet-${enlarged ? 'enlarged' : 'fit'}.png`) });
  } finally { await context.close(); }
});
