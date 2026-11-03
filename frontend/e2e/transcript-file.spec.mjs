import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const eventId = 'local-transcript:browser-fixture';
const teacher = {
  id: '22222222-2222-4222-8222-222222222222', role: 'TEACHER',
  fullName: 'Transcript Browser Teacher', email: 'teacher@example.invalid', preferredLanguage: 'RU',
};
const automaticTranscript = '  [00:00:01] Ученица: Привет! Grüße — дроби ½.\n'
  + '[00:00:03] Teacher: <script>window.__transcriptExecuted = true</script>\n'
  + '[00:00:04] Teacher: <img src=x onerror="window.__transcriptExecuted = true"> & "literal text"\n\n';

async function openLesson(page, transcript) {
  await page.addInitScript(user => {
    localStorage.setItem('language', 'RU');
    localStorage.setItem('accessToken', 'browser-fixture-only');
    localStorage.setItem('authUser', JSON.stringify(user));
  }, teacher);
  await page.route('**/api/v1/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/auth/me')) return route.fulfill({ json: teacher });
    if (path.endsWith('/lessons/groups')) return route.fulfill({ json: [{
      eventId, bindingKey: eventId, title: 'Транскрипция — проверка файла',
      groupId: null, groupName: null, studentId: null, studentName: null, participantStudentIds: [],
      startsAt: '2026-11-03T12:00:00Z', endsAt: '2026-11-03T13:00:00Z', meetUrl: null, calendarUrl: null,
    }] });
    if (path.endsWith(`/lesson-preparations/${eventId}`)) return route.fulfill({ json: {
      eventId, hasWorkbook: false, hasAnswers: false, hasTranscript: Boolean(transcript?.trim()),
      transcriptText: transcript, manualTranscriptText: null, sonioxTranscriptText: transcript,
      transcriptFilename: null, sonioxTranscriptUpdatedAt: '2026-11-03T13:00:00Z',
    } });
    if (path.endsWith('/personal-workbooks')) return route.fulfill({ json: { enabled: false, students: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/teacher/lessons/${encodeURIComponent(eventId)}`);
  const card = page.locator('section.panel').filter({ has: page.getByRole('heading', { name: 'Транскрипция урока', exact: true }) });
  await expect(card).toBeVisible();
  return card;
}

test('automatic transcript opens as a separate UTF-8 text file and downloads exact content', async ({ page }) => {
  const card = await openLesson(page, automaticTranscript);
  const open = card.getByRole('link', { name: 'Открыть файл ↗', exact: true });
  const downloadLink = card.getByRole('link', { name: 'Скачать TXT', exact: true });
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', /\bnoopener\b/);
  await expect(open).toHaveAttribute('rel', /\bnoreferrer\b/);
  const transcriptFilename = await downloadLink.getAttribute('download');
  expect(transcriptFilename).toMatch(/^transcript-.*\.txt$/);
  expect(transcriptFilename).toContain('2026-11-03');
  expect(transcriptFilename).toContain('Транскрипция');
  expect(transcriptFilename).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
  await expect(page.getByRole('region', { name: 'Текст транскрипции урока' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Открыть транскрипцию', exact: true })).toHaveCount(0);
  await expect(page.getByText(/Ученица: Привет! Grüße/)).toHaveCount(0);

  const originalUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await open.click();
  const popup = await popupPromise;
  await expect.poll(() => popup.locator('body').textContent()).toBe(automaticTranscript);
  expect(await popup.evaluate(() => document.contentType)).toBe('text/plain');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(await popup.evaluate(() => window.__transcriptExecuted)).toBeUndefined();
  await expect(popup.locator('script, img')).toHaveCount(0);
  await expect(page).toHaveURL(originalUrl);
  await expect(card.getByRole('link', { name: 'Открыть файл ↗', exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(transcriptFilename);
  expect(await download.failure()).toBeNull();
  expect(await readFile(await download.path())).toEqual(Buffer.from(automaticTranscript, 'utf8'));
  await expect(page.getByRole('region', { name: 'Текст транскрипции урока' })).toHaveCount(0);
  await popup.close();
});

for (const [label, transcript] of [['missing', null], ['blank', ' \n\t ']]) {
  test(`${label} automatic transcript has no file links or inline viewer`, async ({ page }) => {
    const card = await openLesson(page, transcript);
    await expect(card.getByRole('link', { name: 'Открыть файл ↗', exact: true })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Скачать TXT', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Текст транскрипции урока' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Открыть транскрипцию', exact: true })).toHaveCount(0);
    await expect(card.getByText('готово', { exact: true })).toHaveCount(0);
  });
}
