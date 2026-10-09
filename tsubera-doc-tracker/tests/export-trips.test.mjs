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
import ExcelJS from 'exceljs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(path.join(root,'app.html'),'utf8');

async function randomPort(){
  const listener=net.createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve)});
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return port;
}
async function start(dataDir,port){
  const p=spawn(process.execPath,['server.mjs'],{
    cwd:root,
    env:{...process.env,PORT:String(port),DATA_DIR:dataDir,SITE_PASSWORD:'',CONNECTOR_TOKEN:'',FAKTUROWNIA_API_TOKEN:'',FAKTUROWNIA_BASE_URL:''},
    stdio:['ignore','pipe','pipe']
  });
  let logs='';
  p.stdout.on('data',chunk=>logs+=chunk.toString());
  p.stderr.on('data',chunk=>logs+=chunk.toString());
  const base='http://127.0.0.1:'+port;
  for(let i=0;i<100;i++){
    if(p.exitCode!==null)throw new Error('Server exited: '+logs);
    try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(400)})).ok)return {p,base}}catch{}
    await delay(100);
  }
  p.kill('SIGTERM');
  throw new Error('Server timeout: '+logs);
}
test('Excel button downloads exactly filtered trips, with clickable Rechnung URL and without internal tour IDs', {timeout:45000},async t=>{
  const folder=mkdtempSync(path.join(os.tmpdir(),'tsubera-export-'));
  const {p,base}=await start(folder,await randomPort());
  t.after(async()=>{if(p.exitCode===null){const exit=once(p,'exit');p.kill('SIGTERM');await Promise.race([exit,delay(4000)])}rmSync(folder,{recursive:true,force:true})});
  const tripRes=await fetch(base+'/api/trips');
  assert.equal(tripRes.status,200);
  const all=(await tripRes.json()).trips;
  const power=all.find(t=>t.trip==='2026/09/24/137');
  const nardo=all.find(t=>t.trip==='2026/10/06/291');
  assert.ok(power&&nardo,'Example trips should exist');

  const invoiceUrl='https://obersztdawid.fakturownia.pl/invoices/577890716?a=created';
  const update=await fetch(base+'/api/trips/'+power.id,{
    method:'PATCH',headers:{'content-type':'application/json'},
    body:JSON.stringify({rechnungUrl:invoiceUrl,statusOverride:'rechnung_created'})
  });
  assert.equal(update.status,200);
  const response=await fetch(base+'/api/trips/export.xlsx',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({tripIds:[power.id,nardo.id]})
  });
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/spreadsheetml\.sheet/);
  assert.match(response.headers.get('content-disposition'),/attachment;/);
  const bin=Buffer.from(await response.arrayBuffer());
  assert.equal(bin.subarray(0,2).toString(),'PK','Excel file must be ZIP/OOXML');

  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(bin);
  const sheet=workbook.getWorksheet('Рейсы');
  assert.ok(sheet);
  assert.equal(workbook.worksheets.length,1);
  assert.equal(sheet.rowCount,3,'Only selected trips, in supplied order');
  const headers=['Дата','№ заказчика','Фирма','Ссылка на Rechnung','Маршрут','Цена (€)','Auftrag','CMR выгрузка / POD','Статус'];
  assert.deepEqual(sheet.getRow(1).values.slice(1),headers);
  assert.ok(!headers.some(x=>/Tsubera Tour-ID|internalTripId/i.test(x)));

  const row=sheet.getRow(2);
  assert.equal(row.getCell(2).value,'2026/09/24/137');
  assert.equal(row.getCell(3).value,'Power&Light Sp. z o. o.');
  assert.equal(row.getCell(4).value.hyperlink,invoiceUrl);
  assert.equal(row.getCell(4).value.text,invoiceUrl);
  assert.equal(row.getCell(6).value,360);
  assert.equal(row.getCell(9).value,'Rechnung erstellt');
  assert.equal(sheet.getRow(3).getCell(2).value,'2026/10/06/291');
  assert.equal(sheet.getRow(3).getCell(4).value,'');
  assert.ok(sheet.autoFilter,'Excel sheet must have an AutoFilter');

  for(const tab of workbook.worksheets){
    for(let i=1;i<=tab.rowCount;i++){
      for(let j=1;j<=9;j++){
        const value=tab.getRow(i).getCell(j).value;
        assert.notEqual(value,power.internalTripId,'Internal tour number leaked into export');
        assert.notEqual(value,nardo.internalTripId,'Internal tour number leaked into export');
      }
    }
  }

  const invalid=await fetch(base+'/api/trips/export.xlsx',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tripIds:[power.id,power.id]})});
  assert.equal(invalid.status,400);
  const missing=await fetch(base+'/api/trips/export.xlsx',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tripIds:['does-not-exist']})});
  assert.equal(missing.status,404);
});

test('Excel export UI reuses exactly the same filtered list shown by table',()=>{
  assert.match(html,/id="exportTripsExcel"/);
  assert.match(html,/function filteredTripsForTable\(/);
  assert.match(html,/const list=filteredTripsForTable\(\)/);
  assert.match(html,/body:JSON\.stringify\(\{tripIds:list\.map\(t=>t\.id\)\}\)/);
  assert.match(html,/document\.createElement\('a'\)/);
  assert.match(html,/a\.download='tsubera-rechnungen-'/);
});
