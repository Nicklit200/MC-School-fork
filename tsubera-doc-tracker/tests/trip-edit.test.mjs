import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appHtml = readFileSync(path.join(dir, 'app.html'), 'utf8');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function launch(dataDir, port) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      SITE_PASSWORD: '',
      CONNECTOR_TOKEN: '',
      FAKTUROWNIA_API_TOKEN: '',
      FAKTUROWNIA_BASE_URL: ''
    },
    stdio: ['ignore','pipe','pipe']
  });
  let diagnostics = '';
  child.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
  child.stdout.on('data', chunk => { diagnostics += chunk.toString(); });
  const base = 'http://127.0.0.1:' + port;
  for (let attempt=0; attempt<80; attempt++) {
    if(child.exitCode !== null) throw new Error('Server exited during start: '+diagnostics);
    try {
      const response = await fetch(base+'/health', { signal:AbortSignal.timeout(400) });
      if(response.ok) return {child,base};
    } catch {}
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error('Timed out starting server: '+diagnostics);
}
async function stop(child) {
  if(!child || child.exitCode !== null) return;
  const exited=once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited,delay(4000)]);
}
async function request(base,method,url,payload) {
  const response = await fetch(base+url,{
    method,headers:{'content-type':'application/json'},
    body:payload===undefined?undefined:JSON.stringify(payload)
  });
  return {status:response.status,data:await response.json()};
}

test('All trip fields can be edited and edits survive server restart without Excel reseeding', {timeout:45000}, async t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'tsubera-edit-'));
  const port=await availablePort();
  let runtime;
  t.after(async()=>{
    await stop(runtime?.child);
    rmSync(folder,{recursive:true,force:true});
  });
  runtime=await launch(folder,port);
  const initial=await request(runtime.base,'GET','/api/trips');
  assert.equal(initial.status,200);
  const trips=initial.data.trips;
  assert.ok(trips.length>=2,'Seed tours should be initialized');
  const before=trips.find(x=>x.trip==='2026/09/24/137');
  assert.ok(before,'Power&Light sample tour must exist');
  const other=trips.find(x=>x.id!==before.id);
  const originalCount=trips.length;
  const url='https://obersztdawid.fakturownia.pl/invoices/577890716?a=created';

  const changed=await request(runtime.base,'PATCH','/api/trips/'+encodeURIComponent(before.id),{
    date:'2026-09-23',
    internalTripId:'TS-CUSTOM-987',
    trip:'CUSTOM-ORDER-987',
    customer:'Edited Test Logistics GmbH',
    loadingPlace:'DE 11111 New Loading',
    unloadingPlace:'DE 22222 New Unloading',
    priceEur:377.55,
    rechnungUrl:url,
    statusOverride:'rechnung_created',
    vehiclePlates:['MM TEST 123']
  });
  assert.equal(changed.status,200,JSON.stringify(changed.data));
  const stored=changed.data.trip;
  assert.equal(stored.internalTripId,'TS-CUSTOM-987');
  assert.equal(stored.trip,'CUSTOM-ORDER-987');
  assert.equal(stored.customer,'Edited Test Logistics GmbH');
  assert.equal(stored.date,'2026-09-23');
  assert.equal(stored.loadingPlace,'DE 11111 New Loading');
  assert.equal(stored.unloadingPlace,'DE 22222 New Unloading');
  assert.equal(stored.priceEur,377.55);
  assert.equal(stored.rechnungUrl,url);
  assert.equal(stored.statusOverride,'rechnung_created');
  assert.deepEqual(stored.vehiclePlates,['MM TEST 123']);

  const readiness=await request(runtime.base,'GET','/api/trips?readiness=rechnung_created');
  assert.ok(readiness.data.trips.some(x=>x.id===before.id),'Manual invoice status should feed filters');

  const duplicate=await request(runtime.base,'PATCH','/api/trips/'+encodeURIComponent(before.id),{internalTripId:other.internalTripId});
  assert.equal(duplicate.status,409,'Duplicate Tsubera Tour-IDs should be rejected');
  const invalidDate=await request(runtime.base,'PATCH','/api/trips/'+encodeURIComponent(before.id),{date:'2026-02-30'});
  assert.equal(invalidDate.status,400);
  const invalidStatus=await request(runtime.base,'PATCH','/api/trips/'+encodeURIComponent(before.id),{statusOverride:'custom_bad_value'});
  assert.equal(invalidStatus.status,400);
  const invalidCustomer=await request(runtime.base,'PATCH','/api/trips/'+encodeURIComponent(before.id),{customer:''});
  assert.equal(invalidCustomer.status,400);

  const uninvoice=await request(runtime.base,'PATCH','/api/trips/'+encodeURIComponent(before.id),{statusOverride:'not_invoiced'});
  assert.equal(uninvoice.status,200);
  assert.equal(uninvoice.data.trip.statusOverride,'not_invoiced');

  await stop(runtime.child);
  runtime=await launch(folder,port);
  const after=await request(runtime.base,'GET','/api/trips');
  assert.equal(after.status,200);
  const found=after.data.trips.find(x=>x.id===before.id);
  assert.ok(found,'Same database row should survive restart');
  assert.equal(found.internalTripId,'TS-CUSTOM-987');
  assert.equal(found.trip,'CUSTOM-ORDER-987');
  assert.equal(found.date,'2026-09-23');
  assert.equal(found.customer,'Edited Test Logistics GmbH');
  assert.equal(found.loadingPlace,'DE 11111 New Loading');
  assert.equal(found.unloadingPlace,'DE 22222 New Unloading');
  assert.equal(found.priceEur,377.55);
  assert.equal(found.rechnungUrl,url);
  assert.equal(found.statusOverride,'not_invoiced');
  assert.equal(after.data.trips.length,originalCount,'Old Excel seed must not recreate a renamed order');
  assert.equal(after.data.trips.filter(x=>x.trip==='2026/09/24/137').length,0,'Old order ref should not reappear');
});

test('All displayed details have editable controls and a visible Save button',()=>{
  for(const name of ['tripDate','tripInternalId','tripCustomerRef','tripCustomer','tripLoadingPlace','tripUnloadingPlace','tripPrice','tripRechnungUrl','tripStatusOverride','saveTripTop']){
    assert.ok(appHtml.includes('id="'+name+'"'),'Missing editable control '+name);
  }
  assert.match(appHtml,/async function saveTripProperties\(/);
  assert.match(appHtml,/All changes are saved|Все изменения сохранены/);
  assert.match(appHtml,/window\.editRechnungLink/);
});
