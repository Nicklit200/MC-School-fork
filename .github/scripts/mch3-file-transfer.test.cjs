const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const filename = path.resolve(__dirname, '../../backend/src/main/resources/mcp/lesson-file-transfer.html');
const html = fs.readFileSync(filename, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'The UI resource must contain its self-contained script');
const compiled = new vm.Script(script, { filename });

class Element {
  constructor() { this.textContent = ''; this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false; this.disabled = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  click() { this.listeners.click?.(); }
  text() { return this.textContent + this.children.map(child => child.text()).join(''); }
}

const clone = value => JSON.parse(JSON.stringify(value));
const base = {
  operation: 'prepare_lesson', teacherId: 'teacher-id', eventId: 'technical-event',
  idempotencyKey: 'same-stable-upload-key', confirm: true,
  workbookFileId: 'file_workbook', answersFileId: 'file_answers',
  workbookFilename: 'Рабочий лист.pdf', answersFilename: 'Ответы.pdf'
};
const savedPreparation = {
  eventId: base.eventId, hasWorkbook: true, workbookFilename: base.workbookFilename, workbookSizeBytes: 2048, workbookVersion: 1,
  hasAnswers: true, answersFilename: base.answersFilename, answersSizeBytes: 1800, answersVersion: 1
};

function environment(context = base, options = {}) {
  const elements = Object.fromEntries(['status', 'documents', 'choose', 'retry', 'verify'].map(id => [id, new Element()]));
  const events = {}, calls = [], downloads = [], states = [];
  const openai = {
    toolOutput: clone(context), widgetState: options.widgetState || null,
    notifyIntrinsicHeight() {},
    setWidgetState(value) { this.widgetState = clone(value); states.push(clone(value)); },
    async getFileDownloadUrl(args) {
      downloads.push(clone(args));
      if (options.download) return options.download(args);
      return { downloadUrl: `https://files.oaiusercontent.com/${args.fileId}?sig=URL-SECRET` };
    },
    async selectFiles() { return options.selection || []; },
    async callTool(name, args) {
      calls.push({ name, args: clone(args) });
      if (options.tool) return options.tool(name, args);
      return { structuredContent: clone(savedPreparation) };
    }
  };
  const window = { openai, addEventListener(name, listener) { events[name] = listener; } };
  const document = { getElementById(id) { return elements[id]; }, createElement() { return new Element(); } };
  const sandbox = { window, document, URL, Date, Promise, Set, Error, JSON, Number, Array, Object, String,
    setTimeout(fn, delay) { const timer = setTimeout(fn, delay); timer.unref(); return timer; }, clearTimeout };
  compiled.runInNewContext(sandbox);
  return { elements, window, calls, downloads, states,
    emit() { events['openai:set_globals']?.({ detail: { globals: { toolOutput: openai.toolOutput } } }); },
    rendered() { return Object.values(elements).map(element => element.text()).join('\n'); } };
}

async function settled() { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); }

test('waits for explicit confirmation before accessing files or writing', async () => {
  const env = environment({ ...base, confirm: false });
  await settled();
  assert.equal(env.downloads.length, 0);
  assert.equal(env.calls.length, 0);
  env.window.openai.toolOutput = clone(base);
  env.emit();
  await settled();
  assert.equal(env.calls.filter(call => call.name === 'complete_lesson_file_transfer').length, 1);
});

test('resolves both real IDs, completes with canonical objects, then verifies saved metadata', async () => {
  const env = environment();
  await settled();
  assert.deepEqual(env.downloads.map(item => item.fileId), [base.workbookFileId, base.answersFileId]);
  assert.deepEqual(env.calls.map(call => call.name), ['complete_lesson_file_transfer', 'get_lesson_preparation']);
  const args = env.calls[0].args;
  assert.equal(args.confirm, true);
  assert.equal(args.idempotencyKey, base.idempotencyKey);
  assert.equal(args.workbookFile.file_id, base.workbookFileId);
  assert.equal(args.answersFile.file_id, base.answersFileId);
  assert.equal(args.workbookFile.mime_type, 'application/pdf');
  assert.equal(args.workbookFile.file_name, base.workbookFilename);
  assert.match(args.workbookFile.download_url, /^https:\/\/files\.oaiusercontent\.com\//);
  assert.ok(!Object.keys(args).some(key => key.endsWith('FileId')));
  assert.equal(env.elements.status.dataset.tone, 'success');
  assert.match(env.rendered(), /Рабочий лист\.pdf/);
  assert.match(env.rendered(), /Версия 1/);
  assert.ok(!env.rendered().includes('URL-SECRET'));
  assert.ok(!JSON.stringify(env.states).includes('URL-SECRET'));
  assert.ok(!JSON.stringify(env.states).includes('download_url'));
});

test('global updates do not duplicate an in-flight upload', async () => {
  const waiting = [];
  const env = environment(base, { download: args => new Promise(resolve => waiting.push(() => resolve({
    downloadUrl: `https://files.oaiusercontent.com/${args.fileId}?sig=URL-SECRET`
  }))) });
  env.emit(); env.emit(); env.emit();
  assert.equal(env.downloads.length, 2);
  assert.equal(env.calls.length, 0);
  waiting.forEach(resolve => resolve());
  await settled();
  env.emit(); await settled();
  assert.equal(env.calls.filter(call => call.name === 'complete_lesson_file_transfer').length, 1);
});

test('a remounted confirmed upload rereads the server without reposting files', async () => {
  const first = environment(); await settled();
  const replay = environment(base, { widgetState: first.window.openai.widgetState });
  await settled();
  assert.equal(replay.downloads.length, 0);
  assert.deepEqual(replay.calls.map(call => call.name), ['get_lesson_preparation']);
  assert.equal(replay.elements.status.dataset.tone, 'success');
});

test('missing saved files never produce a success message after completion', async () => {
  const env = environment(base, { tool: async name => ({ structuredContent: name === 'get_lesson_preparation'
    ? { ...savedPreparation, hasAnswers: false, answersSizeBytes: 0 } : savedPreparation }) });
  await settled();
  assert.equal(env.elements.status.dataset.tone, 'error');
  assert.match(env.rendered(), /проверить результат пока не удалось/);
  assert.equal(env.elements.verify.hidden, false);
  assert.equal(env.elements.retry.hidden, true);
});

test('host failure exposes safe library selection and never renders signed URL errors', async () => {
  const authorized = new Set(['file_authorized_book', 'file_authorized_answers']);
  const env = environment(base, {
    download: async args => {
      if (!authorized.has(args.fileId)) throw new Error('denied https://files.oaiusercontent.com/?sig=URL-SECRET');
      return { downloadUrl: `https://files.oaiusercontent.com/${args.fileId}?sig=URL-SECRET` };
    },
    selection: [
      { fileId: 'file_authorized_answers', fileName: base.answersFilename, mimeType: 'application/pdf' },
      { fileId: 'file_authorized_book', fileName: base.workbookFilename, mimeType: 'application/pdf' }
    ]
  });
  await settled();
  assert.equal(env.calls.length, 0);
  assert.equal(env.elements.choose.hidden, false);
  assert.ok(!env.rendered().includes('URL-SECRET'));
  env.elements.choose.click(); await settled();
  assert.equal(env.calls[0].args.workbookFile.file_id, 'file_authorized_book');
  assert.equal(env.calls[0].args.answersFile.file_id, 'file_authorized_answers');
  assert.equal(env.calls[0].args.idempotencyKey, base.idempotencyKey);
  assert.equal(env.elements.status.dataset.tone, 'success');
});

test('ambiguous library filenames cannot silently swap the two document roles', async () => {
  const env = environment(base, { download: async () => { throw new Error('not authorized'); }, selection: [
    { fileId: 'file_a', fileName: base.workbookFilename, mimeType: 'application/pdf' },
    { fileId: 'file_b', fileName: base.workbookFilename, mimeType: 'application/pdf' }
  ] });
  await settled(); env.elements.choose.click(); await settled();
  assert.equal(env.calls.length, 0);
  assert.equal(env.elements.status.dataset.tone, 'error');
  assert.match(env.rendered(), /Одинаковые имена/);
});

test('personal verification only displays and persists the requested student metadata', async () => {
  const context = { operation: 'upload_personal_lesson_answers', teacherId: base.teacherId, eventId: base.eventId,
    studentId: 'selected-pupil', idempotencyKey: base.idempotencyKey, confirm: true, pdfFileId: 'file_private', filename: 'Личные ответы.pdf' };
  const env = environment(context, { tool: async name => ({ structuredContent: name === 'list_personal_lesson_workbooks'
    ? { enabled: true, students: [
      { studentId: 'another-pupil', studentName: 'OTHER-PUPIL-SECRET', answersFilename: 'OTHER-PDF-SECRET.pdf' },
      { studentId: context.studentId, hasAnswers: true, answersFilename: context.filename, answersVersion: 3, answersSizeBytes: 1800 }
    ] } : { hasAnswers: true } }) });
  await settled();
  assert.equal(env.calls[0].args.pdfFile.file_id, context.pdfFileId);
  assert.equal(env.calls[1].name, 'list_personal_lesson_workbooks');
  assert.equal(env.elements.status.dataset.tone, 'success');
  assert.ok(!env.rendered().includes('OTHER-'));
  assert.ok(!JSON.stringify(env.states).includes('OTHER-'));
});

test('a changed target waits for the previous upload and never mixes its files or metadata', async () => {
  const waiting = [];
  let defer = true;
  const env = environment(base, {
    download: args => defer ? new Promise(resolve => waiting.push(() => resolve({ downloadUrl:
      `https://files.oaiusercontent.com/${args.fileId}?sig=URL-SECRET` })))
      : Promise.resolve({ downloadUrl: `https://files.oaiusercontent.com/${args.fileId}?sig=URL-SECRET` }),
    tool: async (_name, args) => ({ structuredContent: { ...savedPreparation, eventId: args.eventId } })
  });
  env.window.openai.toolOutput = { ...base, eventId: 'another-technical-event',
    workbookFileId: 'file_another_book', answersFileId: 'file_another_answers' };
  env.emit();
  assert.equal(env.downloads.length, 2);
  defer = false; waiting.forEach(resolve => resolve());
  await settled();
  const writes = env.calls.filter(call => call.name === 'complete_lesson_file_transfer');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].args.eventId, base.eventId);
  assert.equal(writes[0].args.workbookFile.file_id, base.workbookFileId);
  assert.equal(writes[1].args.eventId, 'another-technical-event');
  assert.equal(writes[1].args.workbookFile.file_id, 'file_another_book');
});

test('server errors do not claim completion or expose their private payload', async () => {
  const env = environment(base, { tool: async () => ({ isError: true,
    content: [{ type: 'text', text: 'https://files.oaiusercontent.com/?sig=URL-SECRET' }] }) });
  await settled();
  assert.deepEqual(env.calls.map(call => call.name), ['complete_lesson_file_transfer']);
  assert.equal(env.elements.status.dataset.tone, 'error');
  assert.equal(env.elements.verify.hidden, true);
  assert.equal(env.elements.retry.hidden, false);
  assert.ok(!env.rendered().includes('URL-SECRET'));
  assert.ok(!JSON.stringify(env.states).includes('URL-SECRET'));
});

test('saved widget state excludes lesson notes and remains compact', async () => {
  const secretNote = 'PRIVATE-LESSON-NOTE-'.repeat(800);
  const env = environment({ ...base, lessonPlan: secretNote });
  await settled();
  assert.equal(env.calls[0].args.lessonPlan, secretNote);
  const state = JSON.stringify(env.states.at(-1));
  assert.ok(!state.includes('PRIVATE-LESSON-NOTE-'));
  assert.ok(state.length < 4096);
});

for (const [operation, expectedKind] of [
  ['lesson_preparation.uploadWorkbook', 'workbook'],
  ['lesson_preparation.uploadAnswers', 'answers'],
  ['upload_personal_lesson_workbook', 'workbook']
]) test(`${operation} uses its fixed document role and correct readback`, async () => {
  const context = { operation, teacherId: base.teacherId, eventId: base.eventId,
    idempotencyKey: base.idempotencyKey, confirm: true, pdfFileId: 'file_single', filename: 'Один документ.pdf',
    ...(operation.startsWith('upload_personal') ? { studentId: 'selected-pupil' } : {}) };
  const metadata = expectedKind === 'workbook'
    ? { ...savedPreparation, workbookFilename: context.filename, filename: context.filename, version: 1 }
    : { ...savedPreparation, answersFilename: context.filename };
  const env = environment(context, { tool: async name => ({ structuredContent:
    name === 'list_personal_lesson_workbooks' ? { students: [{ ...metadata, studentId: context.studentId }] } : metadata }) });
  await settled();
  assert.equal(env.calls[0].args.operation, operation);
  assert.equal(env.calls[0].args.pdfFile.file_id, context.pdfFileId);
  assert.equal(env.calls[0].args.pdfFile.file_name, context.filename);
  assert.equal(env.calls[1].name, operation.startsWith('upload_personal') ? 'list_personal_lesson_workbooks' : 'get_lesson_preparation');
  assert.equal(env.elements.status.dataset.tone, 'success');
});
