const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const filename = path.resolve(__dirname, '../../backend/src/main/resources/mcp/ui-diagnostic.html');
const html = fs.readFileSync(filename, 'utf8');
assert.ok(html.includes('HTML открыт.'), 'The static body must remain visible before JavaScript');
const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(source);
const compiled = new vm.Script(source, { filename });

function environment(options = {}) {
  const elements = Object.fromEntries(['status', 'bridge', 'extensions'].map(id => [id, { textContent: '' }]));
  const events = {}, messages = [], logs = [], timers = new Map();
  let sequence = 0;
  const parent = { postMessage(message, origin) { assert.equal(origin, '*'); messages.push(message); } };
  const window = { parent, openai: { toolOutput: { mode: 'legacy', ignored: 'PRIVATE-URL' },
    getFileDownloadUrl() { throw new Error('Forbidden'); }, selectFiles() { throw new Error('Forbidden'); },
    callTool() { throw new Error('Forbidden'); }, setWidgetState() { throw new Error('Forbidden'); } },
    addEventListener(name, handler) { events[name] = handler; } };
  if (options.noHost) window.parent = window;
  const document = { getElementById(id) { return elements[id]; }, body: { scrollHeight: 500 } };
  compiled.runInNewContext({ window, document, console: { info(...args) { logs.push(args.join(' ')); } },
    setTimeout(fn, milliseconds) { const id = ++sequence; timers.set(id, { fn, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  return { elements, messages, logs, timers,
    deliver(data, source = parent) { events.message({ data, source }); },
    text() { return Object.values(elements).map(element => element.textContent).join('\n'); } };
}

test('diagnostic initializes with the trusted parent and exposes only fixed safe observations', () => {
  const env = environment();
  assert.equal(env.messages.length, 1);
  const request = env.messages[0];
  assert.equal(request.method, 'ui/initialize');
  assert.equal(request.params.protocolVersion, '2026-01-26');
  const result = { protocolVersion: '2026-01-26', hostInfo: { name: 'PRIVATE-NAME', version: 'PRIVATE-VERSION' },
    hostCapabilities: { serverTools: {}, ignored: 'PRIVATE-URL' }, hostContext: {} };
  env.deliver({ jsonrpc: '2.0', id: request.id, result }, {});
  env.deliver({ jsonrpc: '2.0', id: 'wrong-id', result });
  assert.equal(env.messages.length, 1);
  env.deliver({ jsonrpc: '2.0', id: request.id, result });
  assert.deepEqual(env.messages.slice(1).map(message => message.method), ['ui/notifications/initialized', 'ui/notifications/size-changed']);
  env.deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: { mode: 'modern', url: 'PRIVATE-URL' } } });
  assert.match(env.text(), /initialized sent: true/);
  assert.match(env.text(), /host serverTools: true/);
  assert.match(env.text(), /tool-result mode: modern/);
  assert.match(env.text(), /getFileDownloadUrl: true/);
  assert.doesNotMatch(env.text() + env.logs.join(' '), /PRIVATE/);
  assert.equal(env.timers.size, 0);
  assert.equal(env.logs.length, 1);
});

test('host errors and timeout remain visible without exposing raw responses or calling tools', () => {
  const env = environment();
  env.deliver({ jsonrpc: '2.0', id: env.messages[0].id, error: { code: -32000, message: 'PRIVATE-TOKEN', data: 'PRIVATE-URL' } });
  assert.match(env.text(), /state: host-error/);
  assert.doesNotMatch(env.text(), /PRIVATE/);
  assert.equal(env.messages.length, 1);
  assert.equal(env.timers.size, 0);
  const silent = environment();
  const timeout = [...silent.timers.values()][0];
  assert.equal(timeout.milliseconds, 10000);
  timeout.fn();
  assert.match(silent.text(), /state: timeout/);
  assert.equal(silent.messages.length, 1);
});

test('opening without an MCP host keeps the static diagnostic usable', () => {
  const env = environment({ noHost: true });
  assert.match(env.text(), /state: no-host/);
  assert.match(env.text(), /window.openai: true/);
  assert.equal(env.messages.length, 0);
  assert.equal(env.timers.size, 0);
});
