import crypto from 'node:crypto';

export const normalizeOrderIdentity = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
export function transOrderKey(orderNumber, company) {
  return crypto.createHash('sha256').update(JSON.stringify([normalizeOrderIdentity(orderNumber), normalizeOrderIdentity(company)])).digest('hex');
}

export function migrateTransOrderIdentity(db) {
  if (db.prepare('PRAGMA table_info(trans_orders)').all().some(c => c.name === 'capture_key')) return false;
  const rows = db.prepare('SELECT * FROM trans_orders').all();
  const columns = ['id','order_number','status_text','view_mode','vehicle_plate','price_amount','currency','distance_km','load_text','unload_text','load_window_text','unload_window_text','company','raw_text','source_url','first_seen_at','last_seen_at','seen_count'];
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE trans_orders_identity_migration (
      id TEXT PRIMARY KEY, order_number TEXT NOT NULL, capture_key TEXT NOT NULL UNIQUE,
      status_text TEXT NOT NULL DEFAULT '', view_mode TEXT NOT NULL DEFAULT '', vehicle_plate TEXT NOT NULL DEFAULT '',
      price_amount REAL, currency TEXT NOT NULL DEFAULT '', distance_km INTEGER,
      load_text TEXT NOT NULL DEFAULT '', unload_text TEXT NOT NULL DEFAULT '',
      load_window_text TEXT NOT NULL DEFAULT '', unload_window_text TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '', raw_text TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, seen_count INTEGER NOT NULL DEFAULT 1
    )`);
    const insert = db.prepare(`INSERT INTO trans_orders_identity_migration (${columns.join(',')},capture_key) VALUES (${columns.map(()=>'?').join(',')},?)`);
    for (const row of rows) insert.run(...columns.map(c=>row[c]),transOrderKey(row.order_number,row.company));
    db.exec(`DROP TABLE trans_orders;
      ALTER TABLE trans_orders_identity_migration RENAME TO trans_orders;
      CREATE INDEX idx_trans_orders_number ON trans_orders(order_number);
      CREATE INDEX idx_trans_orders_last_seen ON trans_orders(last_seen_at);
      CREATE INDEX idx_trans_orders_vehicle ON trans_orders(vehicle_plate);
      CREATE INDEX idx_trans_orders_company ON trans_orders(company);`);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
