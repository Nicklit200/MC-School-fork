import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const server = readFileSync(path.join(dirname, '../server.mjs'), 'utf8');
const html = readFileSync(path.join(dirname, '../app.html'), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline, 'app.html must have a JS script');
const browserValidatorSource = inline.match(/function isValidRechnungUrl\(value\)\{[\s\S]*?\n\}/)?.[0];
const serverValidatorSource = server.match(/function normalizeFakturowniaUrl\(value\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(browserValidatorSource && serverValidatorSource, 'URL validation functions must be present');
const browserValidate = runInNewContext(browserValidatorSource + '\nisValidRechnungUrl;', { URL });
const serverNormalize = runInNewContext(serverValidatorSource + '\nnormalizeFakturowniaUrl;', { URL });

test('Accept user supplied Fakturownia invoice link and persistable URL', () => {
  const url = 'https://obersztdawid.fakturownia.pl/invoices/577890716?a=created';
  assert.equal(browserValidate(url), true);
  assert.equal(serverNormalize(url), url);
  assert.equal(serverNormalize(''), '');
});
test('Reject external sites, unsafe schemes, and deceptive hostnames', () => {
  for(const url of [
    'https://fakturownia.pl.evil.example/invoices/577890716',
    'https://evil.example/',
    'http://obersztdawid.fakturownia.pl/invoices/577890716',
    'javascript:alert(1)',
    'https://obersztdawid.fakturownia.pl@evil.example/',
    'https://user:pass@obersztdawid.fakturownia.pl/invoices/577890716'
  ]){
    assert.equal(browserValidate(url), false, url);
    assert.throws(() => serverNormalize(url), undefined, url);
  }
});
test('Trip responses and PATCH route support independently saved invoice links', () => {
  assert.match(server,/rechnung_url TEXT NOT NULL DEFAULT/);
  assert.match(server,/ALTER TABLE trips ADD COLUMN rechnung_url/);
  assert.match(server,/rechnungUrl: row\.rechnung_url/);
  assert.match(server,/rechnungUrl: b\.rechnungUrl === undefined/);
  assert.match(server,/rechnung_code=\?,rechnung_url=\?,updated_at=\?/);
  assert.match(inline,/window\.editRechnungLink=async id=>/);
  assert.match(inline,/target="_blank" rel="noopener noreferrer"/);
  assert.match(inline,/invoiceLinkControls\(t\)/);
  assert.match(html,/id="tripRechnungUrl"/);
});
