import fs from 'node:fs';
import path from 'node:path';

if (process.env.TSUBERA_MIGRATION === '1') {
  const { startCloudMigration } = await import('./cloud-migration.mjs');
  await startCloudMigration();
} else {
const data = process.env.DATA_DIR || '/data';
const dbPath = path.join(data, 'tsubera.sqlite');
const documents = path.join(data, 'documents');
try {
  if (!fs.statSync(dbPath).isFile() || !fs.statSync(documents).isDirectory()) throw new Error('Required restored database/documents are missing');
  const fd = fs.openSync(dbPath, 'r');
  try {
    const header = Buffer.alloc(16);
    if (fs.readSync(fd, header, 0, 16, 0) !== 16 || header.toString('binary') !== 'SQLite format 3\0') throw new Error('Invalid SQLite database');
  } finally { fs.closeSync(fd); }
  fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
  fs.accessSync(documents, fs.constants.R_OK | fs.constants.W_OK);
} catch {
  console.error('Tsubera did not start: restore the verified database and documents into the writable persistent DATA_DIR first. An empty site was not created.');
  process.exit(1);
}
await import('./server.mjs');
}
