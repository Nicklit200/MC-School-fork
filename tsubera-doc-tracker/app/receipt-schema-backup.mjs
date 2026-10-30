import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// Run before the additive payment-tracking migration, while the application is stopped.
export function ensureReceiptSchemaBackup({dataDirectory,toolsDirectory,python=process.env.TSUBERA_PYTHON||'python3'}){
  const data=path.resolve(dataDirectory);
  const database=new DatabaseSync(path.join(data,'tsubera.sqlite'),{readOnly:true});
  let needed;
  try{
    const trips=new Set(database.prepare('PRAGMA table_info(trips)').all().map(row=>row.name));
    const companies=new Set(database.prepare('PRAGMA table_info(companies)').all().map(row=>row.name));
    needed=!trips.has('documents_received_date')||!trips.has('payment_term_days')||!companies.has('payment_term_days');
  }finally{database.close();}
  if(!needed)return {needed:false};
  const state=path.join(path.dirname(data),'receipt-tracking-backup-v1');
  const result=spawnSync(python,[path.join(toolsDirectory,'prepare-cloud.py'),'backup','--source',data,'--state',state],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:120000});
  if(result.error||result.status!==0)throw new Error('Pre-migration backup failed; existing data was preserved. '+(result.error?.message||result.stderr||'Python exited '+result.status));
  const saved=JSON.parse(result.stdout);
  const archive=path.join(state,saved.backupDirectory,'Tsubera-data.zip');
  if(!saved.verification?.ok||!saved.archiveSha256||!fs.statSync(archive).isFile())throw new Error('Pre-migration backup was not verified');
  console.log(JSON.stringify({event:'receipt-tracking-pre-migration-backup',archive,sha256:saved.archiveSha256,counts:saved.verification.rows,documents:saved.verification.documents,integrity:saved.verification.integrity}));
  return {needed:true,archive,sha256:saved.archiveSha256,verification:saved.verification};
}
