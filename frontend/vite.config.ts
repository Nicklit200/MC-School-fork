import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPenLabSyncStatus, schedulePenLabSync } from './pen-lab-sync';

const LOG_DIR = join(process.cwd(), '.pen-lab-logs');
const MAX_POST_BYTES = 400_000;
const SESSION_PATTERN = /^penlab-[A-Za-z0-9-]{12,95}$/;

/** Development-only LAN endpoint; nothing is added to the production build. */
function localPenLabDiagnostics(): Plugin {
  return {
    name: 'mindcrafti-local-pen-lab-diagnostics',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__pen-lab-diagnostics', (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        const session = url.searchParams.get('session');

        if (req.method === 'GET' && url.searchParams.has('sync-status')) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(getPenLabSyncStatus()));
          return;
        }

        if (req.method === 'GET') {
          if (!session || !SESSION_PATTERN.test(session)) {
            res.writeHead(400); res.end('Invalid session'); return;
          }
          const filename = join(LOG_DIR, session + '.ndjson');
          if (!existsSync(filename)) {
            res.writeHead(404); res.end('No recorded events yet'); return;
          }

          if (url.searchParams.get('format') === 'report') {
            const events = readFileSync(filename, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
              try { return [JSON.parse(line) as { kind: string; wallTime: string; details: Record<string, unknown> }]; }
              catch { return []; }
            });
            const tests = events.filter((event) => event.kind === 'test_end');
            const markers = events.filter((event) => event.kind === 'FREEZE_MARKED_BY_USER');
            const anomalies = events.filter((event) =>
              ['pointercancel', 'pointer_gap', 'frame_gap', 'event_loop_pause', 'javascript_error',
               'lostpointercapture', 'pen_down_outside_sheet', 'pen_finished_without_start'].includes(event.kind));
            const lines = [
              '# Mindcrafti Pen Lab - Apple Pencil diagnostic report',
              '',
              'Session: ' + session,
              'Events: ' + events.length,
              'Recorded tests: ' + tests.length,
              'Manual missed-line markers: ' + markers.length,
              '',
              '## Tests',
              ...(tests.length ? tests.flatMap((event) => [
                '### ' + String(event.details.testId ?? '?') + ' - ' + String(event.details.title ?? ''),
                ...Object.entries(event.details).map(([key, value]) => '- ' + key + ': ' + String(value)),
                '',
              ]) : ['No test_end events yet', '']),
              '## Marked problems with nearby events (+/- 1500 ms)',
              ...markers.flatMap((marker) => {
                const target = Date.parse(marker.wallTime);
                const around = events.filter((event) => Math.abs(Date.parse(event.wallTime) - target) <= 1500);
                return [
                  '### ' + marker.wallTime,
                  ...around.map((event) => '- ' + event.wallTime + ' ' + event.kind + ' ' + JSON.stringify(event.details)),
                  '',
                ];
              }),
              '## Recent anomalies (up to 200)',
              ...anomalies.slice(-200).map((event) =>
                '- ' + event.wallTime + ' ' + event.kind + ' ' + JSON.stringify(event.details)),
              '',
              '## Caveats',
              '- Missing pointerdown relative to expected strokes is evidence of a discrepancy, not definitive proof Safari dropped an event.',
              '- Lost pointer capture after pointerup is normal.',
              '- Drawing pixels themselves are not measured by this input event collector.',
              '- Browser input may not report attempted strokes which never produced any event.',
            ];
            const output = lines.join('\n');
            res.writeHead(200, {
              'Content-Type': 'text/markdown; charset=utf-8',
              'Content-Disposition': 'attachment; filename="' + session + '.report.md"',
              'Cache-Control': 'no-store',
            });
            res.end(output);
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Content-Disposition': 'attachment; filename="' + session + '.ndjson"',
            'Cache-Control': 'no-store',
          });
          res.end(readFileSync(filename));
          return;
        }

        if (req.method !== 'POST') { next(); return; }

        // Prevent anonymous network clients from writing arbitrary files.
        // Access is still restricted to the developer's trusted LAN.
        const origin = req.headers.origin;
        if (origin) {
          try {
            if (new URL(origin).host !== req.headers.host) {
              res.writeHead(403); res.end('Origin mismatch'); return;
            }
          } catch {
            res.writeHead(403); res.end('Invalid origin'); return;
          }
        }

        let bytes = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_POST_BYTES) {
            res.writeHead(413); res.end('Too much diagnostic data');
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on('end', () => {
          if (bytes > MAX_POST_BYTES) return;
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              sessionId?: string;
              events?: unknown[];
            };
            if (!json.sessionId || !SESSION_PATTERN.test(json.sessionId) ||
                !Array.isArray(json.events) || json.events.length > 250) {
              res.writeHead(400); res.end('Invalid telemetry'); return;
            }
            // Store one compact JSON object per line; session and sequence
            // make all events easy to order, grep or analyze by Codex.
            mkdirSync(LOG_DIR, { recursive: true });
            const target = join(LOG_DIR, json.sessionId + '.ndjson');
            const writable = createWriteStream(target, { flags: 'a' });
            for (const item of json.events) {
              if (!item || typeof item !== 'object') continue;
              writable.write(JSON.stringify(item) + '\n');
            }
            writable.end();
            writable.on('finish', () => {
              const completedTest = json.events!.some((item) =>
                item && typeof item === 'object' &&
                (item as { kind?: string }).kind === 'test_end');
              // Non-blocking Git synchronization; local logging succeeds even
              // when Windows Git authentication is not available.
              schedulePenLabSync(LOG_DIR, json.sessionId!, completedTest);
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end('{"ok":true,"savedLocally":true}');
            });
            writable.on('error', () => {
              if (!res.headersSent) res.writeHead(500);
              res.end('Could not write log');
            });
          } catch {
            res.writeHead(400); res.end('Invalid JSON');
          }
        });
      });
    },
  };
}

// Dev server runs on 5173 (allowed by the backend CORS defaults).
export default defineConfig({
  plugins: [react(), localPenLabDiagnostics()],
  server: {
    port: 5173,
  },
});
