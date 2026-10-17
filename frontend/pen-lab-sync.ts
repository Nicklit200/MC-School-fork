/** Local-only sync of iPad pen session logs to a SEPARATE PRIVATE repo branch.
 * No GitHub keys are sent to Safari: use Windows Git Credential Manager.
 * This module is imported only by vite.config.ts and never bundled in the app.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const REMOTE = 'https://github.com/Nicklit200/MC-School.git';
const BRANCH = 'pen-lab-diagnostics';
const SYNC_INTERVAL_MS = 60000;
const SESSION_PATTERN = /^penlab-[A-Za-z0-9-]{12,95}$/;

export type SyncStatus = {
  state: 'waiting' | 'syncing' | 'synced' | 'error';
  lastSyncedAt: string | null;
  lastSessionId: string | null;
  lastError: string | null;
  remote: string;
};

const state: SyncStatus = {
  state: 'waiting',
  lastSyncedAt: null,
  lastSessionId: null,
  lastError: null,
  remote: 'Nicklit200/MC-School / pen-lab-diagnostics',
};

const git = async (cwd: string, ...args: string[]) => {
  const result = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    },
    windowsHide: true,
    timeout: 25000,
    maxBuffer: 1_000_000,
  });
  return result.stdout.trim();
};

let queued: { dir: string; session: string } | null = null;
let running: Promise<void> | null = null;
const lastAttemptAt = new Map<string, number>();

const stringifyReport = (events: Array<{
  kind: string; wallTime?: string; sequence?: number; details?: Record<string, unknown>;
}>, session: string) => {
  const tests = events.filter((event) => event.kind === 'test_end');
  const markers = events.filter((event) => event.kind === 'FREEZE_MARKED_BY_USER');
  const anomalies = events.filter((event) => [
    'pointercancel', 'pointer_gap', 'frame_gap', 'event_loop_pause',
    'javascript_error', 'lostpointercapture', 'pen_down_outside_sheet',
    'pen_finished_without_start',
  ].includes(event.kind));

  const lines = [
    '# Mindcrafti Apple Pencil — тестовая сессия',
    '',
    'Session: ' + session,
    'Всего событий: ' + events.length,
    'Завершённых тестов: ' + tests.length,
    'Отмеченных пропусков: ' + markers.length,
    '',
    '## Результаты тестов',
    ...tests.flatMap((item) => [
      '### ' + String(item.details?.testId ?? '?') + ' — ' + String(item.details?.title ?? ''),
      ...Object.entries(item.details ?? {}).map(([k, v]) => '- ' + k + ': ' + String(v)),
      '',
    ]),
    '## Что происходило возле отмеченных сбоев (±1500 мс)',
    ...markers.flatMap((item) => {
      const when = Date.parse(item.wallTime ?? '');
      return [
        '### ' + item.wallTime,
        ...events.filter((other) => Math.abs(Date.parse(other.wallTime ?? '') - when) <= 1500)
          .map((other) => '- ' + other.wallTime + ': ' + other.kind + ' ' + JSON.stringify(other.details ?? {})),
        '',
      ];
    }),
    '## Последние 150 проблемных событий',
    ...anomalies.slice(-150).map((item) =>
      '- ' + item.wallTime + ' ' + item.kind + ' ' + JSON.stringify(item.details ?? {})),
    '',
    '## Важно',
    '- Меньше pointerdown, чем ожидалось, не доказывает, что iPadOS пропустила касание.',
    '- lostpointercapture после pointerup — нормальное событие.',
    '- Измерение событий не показывает непосредственно число нарисованных пикселей.',
  ];
  return lines.join('\n') + '\n';
};

async function performSync(dir: string, session: string) {
  state.state = 'syncing';
  state.lastError = null;

  try {
    const source = join(dir, session + '.ndjson');
    if (!existsSync(source)) throw new Error('Local log not found');
    const repoFolder = join(dir, '.private-sync');
    if (!existsSync(join(repoFolder, '.git'))) {
      mkdirSync(dir, { recursive: true });
      await git(dir, 'clone', '--depth', '1', '--branch', BRANCH, REMOTE, repoFolder);
    }
    await git(repoFolder, 'pull', '--rebase', 'origin', BRANCH);
    const destination = join(repoFolder, 'pen-lab-logs', 'sessions');
    mkdirSync(destination, { recursive: true });
    const events = readFileSync(source, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line) as {
          kind: string; wallTime?: string; sequence?: number; details?: Record<string, unknown>;
        }];
      } catch { return []; }
    });
    if (!events.length) throw new Error('Local log has no parseable events');
    // Rebuild full snapshots on each sync. The private Git history remains
    // inspectable; never commit logs to the public Pen Lab source repository.
    copyFileSync(source, join(destination, session + '.ndjson'));
    writeFileSync(join(destination, session + '.report.md'), stringifyReport(events, session), 'utf8');
    const indexPath = join(repoFolder, 'pen-lab-logs', 'INDEX.md');
    const entry = '- ' + new Date().toISOString() + ' — [' + session + '](sessions/' +
      session + '.report.md), ' + events.length + ' events';
    const current = existsSync(indexPath)
      ? readFileSync(indexPath, 'utf8')
      : '# Pen Lab session reports (private)\n\n';
    const other = current.split('\n').filter((line) => !line.includes(session + '.report.md'));
    writeFileSync(indexPath, [entry, ...other].join('\n'), 'utf8');

    await git(repoFolder, 'add', 'pen-lab-logs/INDEX.md',
      'pen-lab-logs/sessions/' + session + '.ndjson',
      'pen-lab-logs/sessions/' + session + '.report.md');
    const changes = await git(repoFolder, 'status', '--porcelain');
    if (changes) {
      await git(repoFolder, '-c', 'user.name=Pen Lab Diagnostics',
        '-c', 'user.email=pen-lab-diagnostics@users.noreply.github.com',
        'commit', '-m', 'Pen Lab diagnostics ' + session);
      await git(repoFolder, 'push', 'origin', BRANCH);
    }
    state.state = 'synced';
    state.lastSessionId = session;
    state.lastSyncedAt = new Date().toISOString();
  } catch (error) {
    state.state = 'error';
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message.replace(/https:\/\/[^@\s]+@github\.com/g, 'https://github.com').slice(0, 280);
  }
}

export function schedulePenLabSync(dir: string, session: string, force = false) {
  if (!SESSION_PATTERN.test(session)) return;
  const previous = lastAttemptAt.get(session) ?? 0;
  if (!force && Date.now() - previous < SYNC_INTERVAL_MS) return;
  lastAttemptAt.set(session, Date.now());
  queued = { dir, session };
  if (running) return;
  const processQueue = async () => {
    while (queued) {
      const job = queued;
      queued = null;
      await performSync(job.dir, job.session);
    }
    running = null;
  };
  running = processQueue();
}

export function getPenLabSyncStatus(): SyncStatus {
  return { ...state };
}
