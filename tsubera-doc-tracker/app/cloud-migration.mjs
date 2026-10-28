import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createOnlineAuth } from './online-auth.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const LIMIT = 160 * 1024 * 1024;
function within(root, value, allowRoot = false) {
  const relative = path.relative(root, value);
  if ((!allowRoot && !relative) || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Migration path must stay inside its dedicated data root');
  return value;
}
export async function startCloudMigration() {
  const root = path.resolve(process.env.TSUBERA_MIGRATION_ROOT || '/data');
  const source = within(root, path.resolve(process.env.TSUBERA_MIGRATION_SOURCE_DIR || root), true);
  const target = within(root, path.resolve(process.env.TSUBERA_MIGRATION_TARGET_DIR || path.join(root, 'tsubera-online-20261028')));
  const state = within(root, path.join(root, 'cloud-migration'));
  if (target === source || target === state || target.startsWith(state + path.sep) || target === path.join(source, 'documents')) throw new Error('Unsafe migration target');
  const uploads = path.join(state, 'upload');
  const packagedHelper = path.join(here, 'tools', 'prepare-cloud.py');
  const helper = fs.existsSync(packagedHelper) ? packagedHelper : path.resolve(here, '../tools/prepare-cloud.py');
  const python = process.env.TSUBERA_MIGRATION_PYTHON || '/usr/bin/python3';
  const auth = createOnlineAuth({ password: process.env.SITE_PASSWORD || '', publicBaseUrl: process.env.PUBLIC_BASE_URL || '' });
  async function prepare(arguments_) {
    const { stdout } = await run(python, [helper, ...arguments_], { maxBuffer: 4 * 1024 * 1024, timeout: 15 * 60 * 1000, windowsHide: true });
    return JSON.parse(stdout);
  }
  fs.mkdirSync(uploads, { recursive: true });
  // This completes before importing any application module or running app migrations.
  const baseline = await prepare(['backup', '--source', source, '--state', state]);
  let imported = fs.existsSync(path.join(state, 'imported.json')) ? JSON.parse(fs.readFileSync(path.join(state, 'imported.json'), 'utf8')) : null;
  let busy = false;
  function json(res, code, value) {
    const bytes = JSON.stringify(value);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(bytes), 'cache-control': 'no-store' });
    res.end(bytes);
  }
  const server = http.createServer(async (req, res) => {
    let temporary;
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (await auth.handle(req, res, pathname)) return;
      if (req.method === 'GET' && pathname === '/login') {
        const body = fs.readFileSync(path.join(here, 'login.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length }); return res.end(body);
      }
      if (!auth.authorized(req)) return json(res, 401, { error: 'Войдите в Tsubera' });
      if (req.method === 'GET' && (pathname === '/' || pathname === '/migration')) {
        const body = fs.readFileSync(path.join(here, 'migration.html'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length }); return res.end(body);
      }
      if (pathname === '/migration/status' && req.method === 'GET') return json(res, 200, { mode: 'migration', baseline, imported, busy, targetDirectory: path.relative(root, target) });
      if (pathname === '/migration/backup' && req.method === 'GET') {
        const archive = path.join(state, baseline.backupDirectory, 'Tsubera-data.zip');
        res.writeHead(200, { 'content-type': 'application/zip', 'content-length': fs.statSync(archive).size, 'content-disposition': 'attachment; filename="Tsubera-before-migration.zip"', 'x-tsubera-sha256': baseline.archiveSha256 });
        return fs.createReadStream(archive).pipe(res);
      }
      if (pathname === '/migration/upload' && req.method === 'POST') {
        if (busy) return json(res, 409, { error: 'Другой перенос уже выполняется' });
        if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/zip') return json(res, 415, { error: 'Нужен Content-Type application/zip' });
        const expected = String(req.headers['x-tsubera-sha256'] || '').toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(expected)) return json(res, 400, { error: 'Нужна контрольная сумма X-TSUBERA-SHA256' });
        if (Number(req.headers['content-length'] || 0) > LIMIT) return json(res, 413, { error: 'Максимальный размер архива 160 МБ' });
        busy = true;
        try {
          temporary = path.join(uploads, crypto.randomUUID() + '.part');
          const output = await fs.promises.open(temporary, 'wx');
          let bytes = 0; const digest = crypto.createHash('sha256');
          try {
            for await (const chunk of req) {
              bytes += chunk.length;
              if (bytes > LIMIT) throw Object.assign(new Error('Максимальный размер архива 160 МБ'), { status: 413 });
              digest.update(chunk);
              for (let offset = 0; offset < chunk.length;) {
                const result = await output.write(chunk, offset, chunk.length - offset);
                if (!result.bytesWritten) throw new Error('Could not write uploaded archive');
                offset += result.bytesWritten;
              }
            }
          } finally { await output.close(); }
          if (!bytes || digest.digest('hex') !== expected) throw Object.assign(new Error('Контрольная сумма загруженного архива не совпадает'), { status: 400 });
          imported = await prepare(['restore', '--archive', temporary, '--target', target, '--state', state, '--sha256', expected]);
          const retained = path.join(uploads, 'incoming-' + expected + '.zip');
          if (!fs.existsSync(retained)) { await fs.promises.rename(temporary, retained); temporary = undefined; }
          return json(res, 200, { ok: true, ...imported, targetDirectory: path.relative(root, target) });
        } finally { busy = false; }
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 400, { error: error.status ? error.message : 'Перенос не выполнен: проверка архива или папки назначения не пройдена. Исходная база сохранена.' });
    } finally {
      if (temporary) { try { await fs.promises.unlink(temporary); } catch {} }
    }
  });
  server.requestTimeout = 15 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0', resolve); });
  console.log('Tsubera protected migration server ready');
  return server;
}
