import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import ExcelJS from "exceljs";
import { transOrderKey, migrateTransOrderIdentity } from "./trans-order-key.mjs";
import { createOnlineAuth } from "./online-auth.mjs";
import { normalizePaymentTermDays, normalizeDocumentsReceivedDate, paymentDeadline } from "./payment-deadline.mjs";
import {dispatchFields,normalizeInvoiceDispatch,normalizeDispatchUrl,dispatchFromMcp,dispatchMcpProperties} from './invoice-dispatch.mjs';
import {downloadUrlToBuffer} from './safe-download.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "/data";
const DOCS_DIR = path.join(DATA_DIR, "documents");
const DB_PATH = path.join(DATA_DIR, "tsubera.sqlite");
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN || "";
const FAKTUROWNIA_BASE_URL = (process.env.FAKTUROWNIA_BASE_URL || "").trim().replace(/\/+$/, "");
const FAKTUROWNIA_API_TOKEN = (process.env.FAKTUROWNIA_API_TOKEN || "").trim();
const TRANS_CAPTURE_MAX_ROWS = 500;
const TRANS_CAPTURE_TOKEN = (process.env.TRANS_CAPTURE_TOKEN || "").trim();
const onlineAuth = createOnlineAuth({ password: SITE_PASSWORD, captureToken: TRANS_CAPTURE_TOKEN, publicBaseUrl: process.env.PUBLIC_BASE_URL || "" });

fs.mkdirSync(DOCS_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  internal_trip_id TEXT,
  date TEXT NOT NULL,
  trip_number TEXT,
  customer TEXT NOT NULL,
  auftrag INTEGER NOT NULL DEFAULT 0,
  cmr INTEGER NOT NULL DEFAULT 0,
  pod INTEGER NOT NULL DEFAULT 0,
  cmr_loaded INTEGER NOT NULL DEFAULT 0,
  cmr_unloaded INTEGER NOT NULL DEFAULT 0,
  loaded_at TEXT NOT NULL DEFAULT '',
  unloaded_at TEXT NOT NULL DEFAULT '',
  loading_place TEXT NOT NULL DEFAULT '',
  unloading_place TEXT NOT NULL DEFAULT '',
  vehicle_plates TEXT NOT NULL DEFAULT '',
  price_cents INTEGER,
  rechnung_code TEXT NOT NULL DEFAULT '',
  rechnung_url TEXT NOT NULL DEFAULT '',
  status_override TEXT NOT NULL DEFAULT '',
  documents_received_date TEXT NOT NULL DEFAULT '',
  payment_term_days INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date);
CREATE INDEX IF NOT EXISTS idx_trips_trip_number ON trips(trip_number);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  paper_available INTEGER NOT NULL DEFAULT 0,
  paper_note TEXT NOT NULL DEFAULT '',
  paper_updated_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_documents_trip_id ON documents(trip_id);
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  plate TEXT NOT NULL UNIQUE COLLATE NOCASE,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  billing_channel TEXT NOT NULL DEFAULT '',
  invoice_email TEXT NOT NULL DEFAULT '',
  invoice_subject TEXT NOT NULL DEFAULT '',
  postal_address TEXT NOT NULL DEFAULT '',
  required_documents TEXT NOT NULL DEFAULT '',
  submission_deadline TEXT NOT NULL DEFAULT '',
  special_rules TEXT NOT NULL DEFAULT '',
  rules_source TEXT NOT NULL DEFAULT '',
  rules_seeded INTEGER NOT NULL DEFAULT 0,
  payment_term_days INTEGER DEFAULT 60,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(active);
CREATE TABLE IF NOT EXISTS trans_freights (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  load_text TEXT NOT NULL DEFAULT '',
  unload_text TEXT NOT NULL DEFAULT '',
  vehicle_text TEXT NOT NULL DEFAULT '',
  weight_t REAL,
  distance_km INTEGER,
  price_amount REAL,
  currency TEXT NOT NULL DEFAULT '',
  payment_days INTEGER,
  company TEXT NOT NULL DEFAULT '',
  company_rating REAL,
  published_text TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trans_freights_last_seen ON trans_freights(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_trans_freights_route ON trans_freights(load_text, unload_text);
CREATE INDEX IF NOT EXISTS idx_trans_freights_company ON trans_freights(company);
CREATE TABLE IF NOT EXISTS trans_freight_details (
  id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL DEFAULT '',
  load_text TEXT NOT NULL DEFAULT '',
  unload_text TEXT NOT NULL DEFAULT '',
  load_window_text TEXT NOT NULL DEFAULT '',
  unload_window_text TEXT NOT NULL DEFAULT '',
  vehicle_text TEXT NOT NULL DEFAULT '',
  weight_t REAL,
  distance_km INTEGER,
  approach_km INTEGER,
  destination_offset_km INTEGER,
  price_amount REAL,
  currency TEXT NOT NULL DEFAULT '',
  price_per_km REAL,
  payment_days INTEGER,
  company TEXT NOT NULL DEFAULT '',
  company_rating REAL,
  contact_name TEXT NOT NULL DEFAULT '',
  view_mode TEXT NOT NULL DEFAULT '',
  route_text TEXT NOT NULL DEFAULT '',
  details_text TEXT NOT NULL DEFAULT '',
  company_text TEXT NOT NULL DEFAULT '',
  reviews_text TEXT NOT NULL DEFAULT '',
  negotiations_text TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trans_freight_details_last_seen ON trans_freight_details(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_trans_freight_details_route ON trans_freight_details(load_text, unload_text);
CREATE INDEX IF NOT EXISTS idx_trans_freight_details_company ON trans_freight_details(company);
CREATE TABLE IF NOT EXISTS trans_active_transports (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  status_text TEXT NOT NULL DEFAULT '',
  status_details TEXT NOT NULL DEFAULT '',
  start_text TEXT NOT NULL DEFAULT '',
  end_text TEXT NOT NULL DEFAULT '',
  eta_text TEXT NOT NULL DEFAULT '',
  next_eta_text TEXT NOT NULL DEFAULT '',
  partner TEXT NOT NULL DEFAULT '',
  vehicle_plate TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trans_active_last_seen ON trans_active_transports(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_trans_active_route ON trans_active_transports(start_text, end_text);
CREATE INDEX IF NOT EXISTS idx_trans_active_vehicle ON trans_active_transports(vehicle_plate);
CREATE TABLE IF NOT EXISTS trans_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  status_text TEXT NOT NULL DEFAULT '',
  view_mode TEXT NOT NULL DEFAULT '',
  vehicle_plate TEXT NOT NULL DEFAULT '',
  price_amount REAL,
  currency TEXT NOT NULL DEFAULT '',
  distance_km INTEGER,
  load_text TEXT NOT NULL DEFAULT '',
  unload_text TEXT NOT NULL DEFAULT '',
  load_window_text TEXT NOT NULL DEFAULT '',
  unload_window_text TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_trans_orders_last_seen ON trans_orders(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_trans_orders_vehicle ON trans_orders(vehicle_plate);
CREATE INDEX IF NOT EXISTS idx_trans_orders_company ON trans_orders(company);
`);

migrateTransOrderIdentity(db);

const tripColumns = new Set(db.prepare("PRAGMA table_info(trips)").all().map(r => r.name));
if (!tripColumns.has("internal_trip_id")) db.exec("ALTER TABLE trips ADD COLUMN internal_trip_id TEXT");
if (!tripColumns.has("cmr_loaded")) db.exec("ALTER TABLE trips ADD COLUMN cmr_loaded INTEGER NOT NULL DEFAULT 0");
if (!tripColumns.has("cmr_unloaded")) db.exec("ALTER TABLE trips ADD COLUMN cmr_unloaded INTEGER NOT NULL DEFAULT 0");
if (!tripColumns.has("loaded_at")) db.exec("ALTER TABLE trips ADD COLUMN loaded_at TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("unloaded_at")) db.exec("ALTER TABLE trips ADD COLUMN unloaded_at TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("loading_place")) db.exec("ALTER TABLE trips ADD COLUMN loading_place TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("unloading_place")) db.exec("ALTER TABLE trips ADD COLUMN unloading_place TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("vehicle_plates")) db.exec("ALTER TABLE trips ADD COLUMN vehicle_plates TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("price_cents")) db.exec("ALTER TABLE trips ADD COLUMN price_cents INTEGER");
if (!tripColumns.has("rechnung_url")) db.exec("ALTER TABLE trips ADD COLUMN rechnung_url TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("status_override")) db.exec("ALTER TABLE trips ADD COLUMN status_override TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("documents_received_date")) db.exec("ALTER TABLE trips ADD COLUMN documents_received_date TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("payment_term_days")) db.exec("ALTER TABLE trips ADD COLUMN payment_term_days INTEGER");
for(const column of Object.values(dispatchFields))if(!tripColumns.has(column))db.exec(`ALTER TABLE trips ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
db.exec(`CREATE TABLE IF NOT EXISTS trip_status_history (
  id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, status TEXT NOT NULL, status_date TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL, source TEXT NOT NULL, FOREIGN KEY(trip_id) REFERENCES trips(id) ON DELETE CASCADE
); CREATE INDEX IF NOT EXISTS idx_trip_status_history_trip ON trip_status_history(trip_id,recorded_at);`);

const documentColumns = new Set(db.prepare("PRAGMA table_info(documents)").all().map(r => r.name));
for (const [name, ddl] of [
  ["paper_available", "INTEGER NOT NULL DEFAULT 0"],
  ["paper_note", "TEXT NOT NULL DEFAULT ''"],
  ["paper_updated_at", "TEXT NOT NULL DEFAULT ''"]
]) {
  if (!documentColumns.has(name)) db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${ddl}`);
}

const companyColumns = new Set(db.prepare("PRAGMA table_info(companies)").all().map(r => r.name));
for (const [name, ddl] of [
  ["billing_channel","TEXT NOT NULL DEFAULT ''"],
  ["invoice_email","TEXT NOT NULL DEFAULT ''"],
  ["invoice_subject","TEXT NOT NULL DEFAULT ''"],
  ["postal_address","TEXT NOT NULL DEFAULT ''"],
  ["required_documents","TEXT NOT NULL DEFAULT ''"],
  ["submission_deadline","TEXT NOT NULL DEFAULT ''"],
  ["special_rules","TEXT NOT NULL DEFAULT ''"],
  ["rules_source","TEXT NOT NULL DEFAULT ''"],
  ["rules_seeded","INTEGER NOT NULL DEFAULT 0"],
  ["payment_term_days","INTEGER DEFAULT 60"]
]) {
  if (!companyColumns.has(name)) db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${ddl}`);
}

db.exec("UPDATE trips SET cmr_loaded = 1 WHERE cmr = 1 AND cmr_loaded = 0");
db.exec("UPDATE trips SET cmr_unloaded = 1 WHERE pod = 1 AND cmr_unloaded = 0");
db.exec("UPDATE documents SET doc_type = 'cmr_loading' WHERE doc_type = 'cmr'");
db.exec("UPDATE documents SET doc_type = 'cmr_unloading' WHERE doc_type = 'pod'");

const now = () => new Date().toISOString();
const bool = v => v ? 1 : 0;
const priceEurToCents = v => {
  if (v === undefined) return null;
  if (v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("price_eur must be a non-negative number");
  return Math.round(n * 100);
};
const priceCentsToEur = v => v === null || v === undefined ? null : Number((Number(v) / 100).toFixed(2));
function normalizeFakturowniaUrl(value){
  const invalid=message=>Object.assign(new Error(message),{status:400});
  if(value!=null&&typeof value!=='string')throw invalid('Неверная ссылка на Rechnung');
  const raw=String(value??'').trim();
  if(!raw)return '';
  if(raw.length>2048||/[\u0000-\u001f\u007f]/.test(raw))throw invalid('Ссылка на Rechnung слишком длинная или содержит недопустимые символы');
  let url;
  try{url=new URL(raw);}catch{throw invalid('Неверная ссылка на Rechnung');}
  const host=url.hostname.toLowerCase();
  const allowed=host==='fakturownia.pl'||host.endsWith('.fakturownia.pl')||host==='fakturownia.net'||host.endsWith('.fakturownia.net');
  if(url.protocol!=='https:'||url.username||url.password||!allowed||url.pathname.length<=1){
    throw invalid('Укажи HTTPS-ссылку на счет Fakturownia');
  }
  return url.toString();
}
const normalizePlate = v => String(v || "").trim().replace(/\s+/g," ").toUpperCase();
const normalizeCompanyName = v => String(v || "").trim().replace(/\s+/g," ");
function normalizeTripEditDate(value){
  const date=String(value??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date){
    const error=new Error('Дата рейса должна быть в формате YYYY-MM-DD');
    error.status=400;throw error;
  }
  return date;
}
function normalizeTripInternalId(value){
  const id=String(value??'').trim();
  if(id.length<3||id.length>80||/[\r\n<>]/.test(id)){
    const error=new Error('Tsubera Tour-ID должен содержать от 3 до 80 символов');
    error.status=400;throw error;
  }
  return id;
}
const editableTripStatuses=new Set([
  '', 'rechnung_created', 'invoice_sent', 'documents_received', 'payment_received', 'ready_for_rechnung', 'not_invoiced',
  'no_price', 'loaded', 'missing_auftrag', 'missing_cmr', 'missing_both', 'missing_documents'
]);
const invoicedTripStatuses=new Set(['rechnung_created', 'invoice_sent', 'documents_received', 'payment_received']);
const receiptHistoryStatuses=new Set(['documents_received','payment_received']);
function normalizeTripStatus(value){
  const status=String(value??'').trim();
  if(!editableTripStatuses.has(status)){
    const error=new Error('Недопустимый статус рейса');
    error.status=400;throw error;
  }
  return status;
}
function normalizeTripCustomer(value){
  const customer=normalizeCompanyName(value);
  if(!customer||customer.length>250){
    const error=new Error('Укажи название заказчика длиной до 250 символов');
    error.status=400;throw error;
  }
  return customer;
}
function tripPaymentInput(old={},changes={}){
  let documentsReceivedDate=changes.documentsReceivedDate===undefined?(old.documentsReceivedDate||''):normalizeDocumentsReceivedDate(changes.documentsReceivedDate);
  const paymentTermDays=changes.paymentTermDays===undefined?(old.paymentTermDays??null):normalizePaymentTermDays(changes.paymentTermDays);
  const statusOverride=changes.statusOverride===undefined?(old.statusOverride||''):normalizeTripStatus(changes.statusOverride);
  // Rolling back receipt confirmation also resets its date, including stale properties payloads.
  if(!receiptHistoryStatuses.has(statusOverride))documentsReceivedDate='';
  if(statusOverride==='documents_received'&&!documentsReceivedDate){
    const error=new Error('Укажи дату, когда фирма получила документы');error.status=400;throw error;
  }
  const customer=normalizeCompanyName(changes.customer??old.customer??'');
  const company=db.prepare("SELECT payment_term_days FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1").get(customer);
  // Validate the combined receipt and inherited/overridden term before any database write.
  paymentDeadline({documentsReceivedDate,paymentTermDays,companyPaymentTermDays:company?company.payment_term_days:60,statusOverride});
  return {documentsReceivedDate,paymentTermDays,statusOverride,...normalizeInvoiceDispatch(old,{...changes,statusOverride:changes.statusOverride===undefined?undefined:statusOverride,documentsReceivedDate}),...(changes.rechnungUrl===undefined?{}:{rechnungUrl:normalizeFakturowniaUrl(changes.rechnungUrl)})};
}
function persistTripDispatch(id,old,next,source){
  const keys=Object.keys(dispatchFields);
  db.prepare('UPDATE trips SET '+keys.map(key=>dispatchFields[key]+'=?').join(',')+' WHERE id=?').run(...keys.map(key=>next[key]||''),id);
  if(next.rechnungUrl!==undefined)db.prepare('UPDATE trips SET rechnung_url=? WHERE id=?').run(next.rechnungUrl,id);
  if((next.statusOverride||'')!==(old.statusOverride||'')||(next.statusDate||'')!==(old.statusDate||'')){
    db.prepare('INSERT INTO trip_status_history(id,trip_id,status,status_date,recorded_at,source) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(),id,next.statusOverride||'',next.statusDate||'',next.statusUpdatedAt||now(),source);
  }
}
function saveTrackedTrip(id,old,next,source,write){
  db.exec('BEGIN');
  try{write();persistTripDispatch(id,old,next,source);db.exec('COMMIT');}
  catch(error){db.exec('ROLLBACK');throw error;}
}
function statusHistory(tripId){
  return db.prepare('SELECT id,status,status_date,recorded_at,source FROM trip_status_history WHERE trip_id=? ORDER BY recorded_at,id').all(tripId)
    .map(row=>({id:row.id,status:row.status,statusDate:row.status_date,recordedAt:row.recorded_at,source:row.source}));
}
function normalizeCustomerOrder(value){
  const ref=String(value??'').trim();
  if(ref.length>160){
    const error=new Error('Номер заказчика не может быть длиннее 160 символов');
    error.status=400;throw error;
  }
  return ref;
}
const defaultCompanyActive = name => !/(^|\b)dc\s*cargo\b|(^|\b)semi\s*cargo\b/i.test(normalizeCompanyName(name));
const companyOut = row => row ? ({
  id: row.id,
  name: row.name,
  active: !!row.active,
  note: row.note || "",
  billingChannel: row.billing_channel || "",
  invoiceEmail: row.invoice_email || "",
  invoiceSubject: row.invoice_subject || "",
  postalAddress: row.postal_address || "",
  requiredDocuments: row.required_documents || "",
  submissionDeadline: row.submission_deadline || "",
  specialRules: row.special_rules || "",
  rulesSource: row.rules_source || "",
  paymentTermDays: row.payment_term_days === null ? null : Number(row.payment_term_days),
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;
function ensureCompany(name, note = "", active) {
  const n = normalizeCompanyName(name);
  if (!n) return null;
  const existing = db.prepare("SELECT * FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1").get(n);
  if (existing) {
    if (note && !existing.note) db.prepare("UPDATE companies SET note=?,updated_at=? WHERE id=?").run(String(note).trim(), now(), existing.id);
    return companyOut(db.prepare("SELECT * FROM companies WHERE id=?").get(existing.id));
  }
  const id = crypto.randomUUID(), ts = now();
  const isActive = active === undefined ? defaultCompanyActive(n) : !!active;
  db.prepare("INSERT INTO companies (id,name,active,note,billing_channel,invoice_email,invoice_subject,postal_address,required_documents,submission_deadline,special_rules,rules_source,rules_seeded,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,n,bool(isActive),String(note||"").trim(),"","","","","","","","",0,ts,ts);
  return companyOut(db.prepare("SELECT * FROM companies WHERE id=?").get(id));
}
function listCompanies() {
  const rows = db.prepare("SELECT * FROM companies ORDER BY active DESC, name COLLATE NOCASE").all();
  return rows.map(r => {
    const tripCount = db.prepare("SELECT COUNT(*) c FROM trips WHERE LOWER(customer)=LOWER(?)").get(r.name).c;
    return { ...companyOut(r), tripCount };
  });
}
function updateCompany(id, changes = {}) {
  const row = db.prepare("SELECT * FROM companies WHERE id=?").get(id);
  if (!row) return null;
  const oldName = row.name;
  const nextName = changes.name === undefined ? row.name : normalizeCompanyName(changes.name);
  if (!nextName) throw new Error("company name is required");
  const nextActive = changes.active === undefined ? !!row.active : !!changes.active;
  const nextNote = changes.note === undefined ? row.note : String(changes.note || "").trim();
  const nextBillingChannel = changes.billingChannel === undefined ? row.billing_channel : String(changes.billingChannel || "").trim();
  const nextInvoiceEmail = changes.invoiceEmail === undefined ? row.invoice_email : String(changes.invoiceEmail || "").trim();
  const nextInvoiceSubject = changes.invoiceSubject === undefined ? row.invoice_subject : String(changes.invoiceSubject || "").trim();
  const nextPostalAddress = changes.postalAddress === undefined ? row.postal_address : String(changes.postalAddress || "").trim();
  const nextRequiredDocuments = changes.requiredDocuments === undefined ? row.required_documents : String(changes.requiredDocuments || "").trim();
  const nextSubmissionDeadline = changes.submissionDeadline === undefined ? row.submission_deadline : String(changes.submissionDeadline || "").trim();
  const nextSpecialRules = changes.specialRules === undefined ? row.special_rules : String(changes.specialRules || "").trim();
  const nextRulesSource = changes.rulesSource === undefined ? row.rules_source : String(changes.rulesSource || "").trim();
  const nextPaymentTermDays = changes.paymentTermDays === undefined ? row.payment_term_days : normalizePaymentTermDays(changes.paymentTermDays);
  if(changes.paymentTermDays!==undefined){
    const inherited=db.prepare("SELECT documents_received_date FROM trips WHERE LOWER(customer)=LOWER(?) AND payment_term_days IS NULL AND documents_received_date<>'' AND status_override IN ('documents_received','payment_received')").all(row.name);
    for(const trip of inherited)paymentDeadline({documentsReceivedDate:trip.documents_received_date,companyPaymentTermDays:nextPaymentTermDays});
  }
  const duplicate = db.prepare("SELECT id FROM companies WHERE LOWER(name)=LOWER(?) AND id<>? LIMIT 1").get(nextName,id);
  if (duplicate) throw new Error("A company with this name already exists");
  db.prepare("UPDATE companies SET name=?,active=?,note=?,billing_channel=?,invoice_email=?,invoice_subject=?,postal_address=?,required_documents=?,submission_deadline=?,special_rules=?,rules_source=?,payment_term_days=?,updated_at=? WHERE id=?")
    .run(nextName,bool(nextActive),nextNote,nextBillingChannel,nextInvoiceEmail,nextInvoiceSubject,nextPostalAddress,nextRequiredDocuments,nextSubmissionDeadline,nextSpecialRules,nextRulesSource,nextPaymentTermDays,now(),id);
  if (nextName !== oldName) db.prepare("UPDATE trips SET customer=?,updated_at=? WHERE LOWER(customer)=LOWER(?)").run(nextName,now(),oldName);
  return listCompanies().find(c => c.id === id) || companyOut(db.prepare("SELECT * FROM companies WHERE id=?").get(id));
}
const vehicleOut = row => row ? ({
  id: row.id,
  plate: row.plate,
  note: row.note || "",
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;
function listVehicles() {
  const rows = db.prepare("SELECT * FROM vehicles ORDER BY plate COLLATE NOCASE").all();
  const trips = db.prepare("SELECT vehicle_plates FROM trips").all();
  return rows.map(r => {
    const plate = normalizePlate(r.plate);
    const tripCount = trips.filter(t => String(t.vehicle_plates || "").split(/\r?\n|,|;/).map(normalizePlate).filter(Boolean).includes(plate)).length;
    return { ...vehicleOut(r), tripCount };
  });
}
function ensureVehicle(plate, note = "") {
  const p = normalizePlate(plate);
  if (!p) return null;
  const existing = db.prepare("SELECT * FROM vehicles WHERE UPPER(plate)=UPPER(?) LIMIT 1").get(p);
  if (existing) {
    if (note && !existing.note) db.prepare("UPDATE vehicles SET note=?,updated_at=? WHERE id=?").run(String(note).trim(), now(), existing.id);
    return vehicleOut(db.prepare("SELECT * FROM vehicles WHERE id=?").get(existing.id));
  }
  const id = crypto.randomUUID(), ts = now();
  db.prepare("INSERT INTO vehicles (id,plate,note,created_at,updated_at) VALUES (?,?,?,?,?)").run(id,p,String(note||"").trim(),ts,ts);
  return vehicleOut(db.prepare("SELECT * FROM vehicles WHERE id=?").get(id));
}
function platesToArray(value) {
  const arr = Array.isArray(value) ? value : String(value || "").split(/\r?\n|,|;/);
  return [...new Set(arr.map(normalizePlate).filter(Boolean))];
}
function platesToText(value) {
  const arr = platesToArray(value);
  for (const p of arr) ensureVehicle(p);
  return arr.join("\n");
}
function appendVehicleToTrip(tripId, plate) {
  const p = normalizePlate(plate);
  if (!p) return getTripByAny(tripId);
  ensureVehicle(p);
  const row = db.prepare("SELECT vehicle_plates FROM trips WHERE id=?").get(tripId);
  if (!row) return null;
  const plates = platesToArray(row.vehicle_plates);
  if (!plates.includes(p)) plates.push(p);
  db.prepare("UPDATE trips SET vehicle_plates=?,updated_at=? WHERE id=?").run(plates.join("\n"),now(),tripId);
  return getTripByAny(tripId);
}

for (const row of db.prepare("SELECT vehicle_plates FROM trips WHERE TRIM(COALESCE(vehicle_plates,'')) <> ''").all()) {
  for (const p of platesToArray(row.vehicle_plates)) ensureVehicle(p);
}
for (const row of db.prepare("SELECT DISTINCT customer FROM trips WHERE TRIM(COALESCE(customer,'')) <> ''").all()) {
  ensureCompany(row.customer);
}
const knownCompanyRules = [
  {
    name: "DC Cargo Sp. z o.o.",
    billingChannel: "Только электронно. Бумажные Rechnung и документы не принимаются.",
    invoiceEmail: "invoice.gd@dccargo.pl",
    invoiceSubject: "",
    postalAddress: "",
    requiredDocuments: "Rechnung + все релевантные Ablieferungsnachweise: CMR, Lieferschein, Palettenschein и, если применимо, grenzüberschreitende Dokumente. Всё должно быть объединено в один файл на один Transportauftrag.",
    submissionDeadline: "Полный корректный комплект должен поступить в течение 10 дней после рейса.",
    specialRules: "1 Transportauftrag = 1 отдельная Rechnung. E-Rechnung только ZUGFeRD PDF с XML. Максимум 7 MB. На Rechnung и релевантных документах должны быть Tour-Nr./Fahrtnummer и Fahrer-ID. Имя файла без спецсимволов и обязательно с Tour-Nr. или Fahrtnummer.",
    rulesSource: "Transportauftrag GD26090083 · Abschnitt 3 Abrechnung"
  },
  {
    name: "SemiCargo",
    billingChannel: "Оригиналы Rechnung и документов отправляются обычной почтой или курьером. Дополнительно после разгрузки сканы/фото документов отправляются диспетчеру по email.",
    invoiceEmail: "Email диспетчера из конкретного Auftrag; для 0380/09/2026: oskar.jedrowiak@semicargo.pl",
    invoiceSubject: "",
    postalAddress: "SEMICARGO Sp. z o.o., os. Wyzwolenia 28/35, PL 62-700 Turek",
    requiredDocuments: "Rechnung + 2 оригинальных комплекта документов, подтверждённых получателем (читаемая подпись, дата разгрузки, печать) + подписанный Auftrag. CMR/DPL/PAKI, если применимо, отправляются в оригинале.",
    submissionDeadline: "Сканы/фото после разгрузки — в течение 24 часов. Rechnung с оригиналами — в течение 10 дней после разгрузки.",
    specialRules: "Rechnung должна быть выставлена в месяце выполнения услуги. Для EUR требуется двухвалютная Rechnung и два банковских счёта: PLN и EUR. При Skonto информация должна быть на Rechnung и на конверте.",
    rulesSource: "Zlecenie transportowe 0380/09/2026 · Termin i warunki płatności"
  },
  {
    name: "Simple Solutions Sp. z o.o.",
    billingChannel: "Сначала читаемый скан транспортной документации диспетчеру по email, затем оригиналы документов и Rechnung почтой.",
    invoiceEmail: "Email диспетчера, ведущего конкретный Auftrag; для ZL2900/2026/KS: k.samsel@simple-solutions.com.pl",
    invoiceSubject: "",
    postalAddress: "Simple Solutions Sp. z o.o., Warmińska 21/1, PL 10-545 Olsztyn",
    requiredDocuments: "Оригинал транспортного документа + Rechnung + остальные сопроводительные документы. Для температурных перевозок — также распечатка температуры.",
    submissionDeadline: "Скан документации — не позднее 72 часов после разгрузки. Оригиналы транспортного документа, Rechnung и сопроводительные документы — в течение 14 дней после разгрузки.",
    specialRules: "Rechnung должна быть выставлена в месяце выполнения Auftrag. Стандартный срок оплаты — 60 дней от получения оригинальных документов.",
    rulesSource: "ZL2900/2026/KS · OWU pkt 23–24 oraz §5"
  },
  {
    name: "inTime Express Logistik GmbH",
    billingChannel: "Rechnung по email; транспортные документы/POD отдельным PDF. Оригиналы транспортных документов дополнительно отправляются почтой в центральный офис.",
    invoiceEmail: "invoice@intime.de или rechnungseingang@intime.de; POD для текущего Auftrag также: pod@intime.de",
    invoiceSubject: "Тема письма строго: Rechnung, Invoice или Faktura",
    postalAddress: "inTime Express Logistik GmbH, Am Kirchhorster See 1, D-30916 Isernhagen",
    requiredDocuments: "Rechnung отдельным PDF (макс. 2 MB). Transportbelege/POD отдельным PDF (макс. 2 MB), названным Belege, POD, Anhang или Attachement. Если сканы уже отправлены через inTime DriverApp, повторно цифрово отправлять их не нужно.",
    submissionDeadline: "Оригинальный Ablieferbeleg должен быть возвращён не позднее 4-го рабочего дня после окончания транспорта.",
    specialRules: "Только одна Rechnung на одно email. Rechnung должна быть машинно создана. Не отправлять Rechnung дополнительно почтой. Важную информацию не писать в тексте email, т.к. ящик обрабатывается автоматически.",
    rulesSource: "invoicing_details_de.pdf + procedure_of_evidence_de.pdf + Auftrag 14634664"
  },
  {
    name: "zipmend / Nörpel / Auftraggeber noch zu prüfen",
    billingChannel: "Только по email. Отправить Rechnung и Ablieferbeleg/POD двумя отдельными PDF-файлами в одном письме.",
    invoiceEmail: "invoice@zipmend.com",
    invoiceSubject: "Rechnung für Auftrag <Auftragsnummer>",
    postalAddress: "",
    requiredDocuments: "Rechnung.pdf + Ablieferbeleg/POD.pdf отдельными вложениями. На Rechnung обязательно указать Auftragsnummer zipmend. Для перевозчика с местом регистрации в другой стране ЕС: указать USt-IdNr. zipmend DE304638568 и Reverse-Charge.",
    submissionDeadline: "Отдельного крайнего срока отправки Rechnung на публичной странице не указано. zipmend заявляет оплату не позднее 14 дней после получения Rechnung вместе с Ablieferbeleg.",
    specialRules: "Без читаемого Ablieferbeleg/POD Rechnung не допускается к оплате. Rechnung должна быть цифровым PDF, не рукописная и не Word. Эти правила применять, если Auftraggeber по конкретному рейсу действительно zipmend.",
    rulesSource: "Официальный сайт zipmend · Abrechnung von Transportaufträgen / Transportpartner FAQ"
  },
  {
    name: "MAN Truck & Bus / Auftraggeber noch zu prüfen",
    billingChannel: "Только электронная Rechnung: EDI в действующем VDA-формате, EN16931 (ZUGFeRD / Factur-X / XRechnung), назначенный provider или согласованный электронный канал. Обычный PDF MAN не принимает.",
    invoiceEmail: "",
    invoiceSubject: "",
    postalAddress: "",
    requiredDocuments: "Rechnung должна содержать MAN-Lieferantennummer, Bestellnummer, Lieferscheinnummer, MAN Materialnummer и имя Ansprechpartner у MAN. Все необходимые Abrechnungsunterlagen должны быть приложены.",
    submissionDeadline: "Если не согласовано иначе: оплата через 30 дней после полной и корректной поставки/услуги; если корректная Rechnung поступает позже — через 30 дней после получения корректной Rechnung.",
    specialRules: "Для оплаты нужна правильная и проверяемая Rechnung. MAN может удерживать оплату при ненадлежащем исполнении до устранения проблемы. ВАЖНО: эти правила применять к нашему рейсу только после подтверждения, что Auftraggeber действительно MAN Truck & Bus, а не другая Spedition.",
    rulesSource: "MAN Truck & Bus SE · Einkaufsbedingungen Bereich Beschaffung Allgemein · разделы 5 Rechnungsstellung и 14.3 Zahlung"
  }
];
for (const rule of knownCompanyRules) {
  const row = db.prepare("SELECT * FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1").get(rule.name);
  if (!row || row.rules_seeded) continue;
  db.prepare("UPDATE companies SET billing_channel=?,invoice_email=?,invoice_subject=?,postal_address=?,required_documents=?,submission_deadline=?,special_rules=?,rules_source=?,rules_seeded=1,updated_at=? WHERE id=?")
    .run(rule.billingChannel,rule.invoiceEmail,rule.invoiceSubject,rule.postalAddress,rule.requiredDocuments,rule.submissionDeadline,rule.specialRules,rule.rulesSource,now(),row.id);
}

function internalPrefix(date) {
  const clean = String(date || "").replace(/[^0-9]/g, "");
  const yymmdd = clean.length >= 8 ? clean.slice(2,8) : new Date().toISOString().slice(2,10).replace(/-/g,"");
  return "TS-" + yymmdd;
}
function nextInternalTripId(date) {
  const prefix = internalPrefix(date);
  const rows = db.prepare("SELECT internal_trip_id FROM trips WHERE internal_trip_id LIKE ?").all(prefix + "-%");
  let max = 0;
  for (const r of rows) {
    const m = String(r.internal_trip_id || "").match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return prefix + "-" + String(max + 1).padStart(3,"0");
}
for (const r of db.prepare("SELECT id,date FROM trips WHERE internal_trip_id IS NULL OR TRIM(internal_trip_id) = '' ORDER BY date,created_at,id").all()) {
  db.prepare("UPDATE trips SET internal_trip_id=? WHERE id=?").run(nextInternalTripId(r.date), r.id);
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_internal_trip_id ON trips(internal_trip_id)");

const excelConfirmedTrips = [
  { date:"2026-10-06", trip:"2026/10/06/63", customer:"Acc Logistics Krzysztof Feret", loadingPlace:"DE 79713 Bad Säckingen", unloadingPlace:"DE 85748 Garching bei München", priceEur:360, vehiclePlates:["MM AO 102"] },
  { date:"2026-10-06", trip:"2026/10/06/149", customer:"WIKLOGISTIC Włodzimierz Leszczyński", loadingPlace:"DE 88250 Weingarten", unloadingPlace:"DE 79689 Maulburg", priceEur:280, vehiclePlates:["MM AO 102"] },
  { date:"2026-10-06", trip:"2026/10/06/11", customer:"Haug Transport & Logistik GbR", loadingPlace:"DE 72144 Dußlingen", unloadingPlace:"DE 87544 Blaichach", priceEur:250, vehiclePlates:["KE TV 177"] },
  { date:"2026-10-06", trip:"2026/10/06/291", customer:"Nardo Logistics Sp. z o.o.", loadingPlace:"DE 74211 Leingarten", unloadingPlace:"DE 88045 Friedrichshafen", priceEur:250, vehiclePlates:[] },
  { date:"2026-10-01", trip:"2026/10/01/27", customer:"Desmond Marek Sulikowski", loadingPlace:"DE 70734 Fellbach", unloadingPlace:"DE 87544 Blaichach", priceEur:250, vehiclePlates:["MM AO 102"] },
  { date:"2026-10-01", trip:"2026/10/01/11", customer:"LEGACY s.r.o.", loadingPlace:"DE 74072 Heilbronn", unloadingPlace:"DE 86842 Türkheim", priceEur:150, vehiclePlates:["KE TV 177"] },
  { date:"2026-09-25", trip:"2026/09/25/1456", customer:"SL Transport Sp. z o.o.", loadingPlace:"DE 74336 Brackenheim", unloadingPlace:"DE 87719 Mindelheim", priceEur:150, vehiclePlates:["MN TV 179"] },
  { date:"2026-09-24", trip:"2026/09/24/137", customer:"Power&Light Sp. z o. o.", loadingPlace:"DE 63456 Hanau", unloadingPlace:"DE 85748 Garching bei München", priceEur:360, vehiclePlates:[] }
];
// Only populate missing example trips once. Never overwrite a manually edited tour on a later restart.
db.exec("CREATE TABLE IF NOT EXISTS app_seed_meta (key TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
if (!db.prepare("SELECT 1 FROM app_seed_meta WHERE key=?").get("excel_confirmed_trips_v1")) {
  for (const seed of excelConfirmedTrips) {
    const existing = db.prepare("SELECT id FROM trips WHERE trip_number=? LIMIT 1").get(seed.trip);
    if (existing) continue;
    const company = ensureCompany(seed.customer);
    const plateText = platesToText(seed.vehiclePlates || []);
    const id = crypto.randomUUID(), ts = now();
    db.prepare(`INSERT INTO trips (id,internal_trip_id,date,trip_number,customer,auftrag,cmr,pod,cmr_loaded,cmr_unloaded,loaded_at,unloaded_at,loading_place,unloading_place,vehicle_plates,price_cents,rechnung_code,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,nextInternalTripId(seed.date),seed.date,seed.trip,company.name,0,0,0,0,0,"","",seed.loadingPlace,seed.unloadingPlace,plateText,priceEurToCents(seed.priceEur),"",ts,ts);
  }
  db.prepare("INSERT INTO app_seed_meta (key,applied_at) VALUES (?,?)").run("excel_confirmed_trips_v1",now());
}

const tripOut = row => {
  if (!row) return null;
  const hasAuftrag = !!db.prepare("SELECT 1 FROM documents WHERE trip_id=? AND doc_type='auftrag' LIMIT 1").get(row.id);
  const hasLoadingCmr = !!db.prepare("SELECT 1 FROM documents WHERE trip_id=? AND doc_type IN ('cmr_loading','cmr') LIMIT 1").get(row.id);
  const hasUnloadingCmr = !!db.prepare("SELECT 1 FROM documents WHERE trip_id=? AND doc_type IN ('cmr_unloading','pod') LIMIT 1").get(row.id);
  const company=db.prepare("SELECT payment_term_days FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1").get(row.customer);
  // Older versions retained dates after receipt rollback; never reactivate or prefill those dates.
  const payment={documentsReceivedDate:receiptHistoryStatuses.has(row.status_override)?row.documents_received_date||'':'',paymentTermDays:row.payment_term_days??null};
  return {
    id: row.id,
    internalTripId: row.internal_trip_id || "",
    date: row.date,
    trip: row.trip_number || "",
    customer: row.customer,
    auftrag: hasAuftrag,
    cmrLoaded: hasLoadingCmr,
    cmrUnloaded: hasUnloadingCmr,
    loadedAt: row.loaded_at || "",
    unloadedAt: row.unloaded_at || "",
    loadingPlace: row.loading_place || "",
    unloadingPlace: row.unloading_place || "",
    vehiclePlates: String(row.vehicle_plates || "").split(/\r?\n|,|;/).map(s=>s.trim()).filter(Boolean),
    priceEur: priceCentsToEur(row.price_cents),
    cmr: hasLoadingCmr,
    pod: hasUnloadingCmr,
    rechnungCode: row.rechnung_code || "",
    rechnungUrl: row.rechnung_url || "",
    statusOverride: row.status_override || "",
    ...Object.fromEntries(Object.entries(dispatchFields).map(([camel,snake])=>[camel,row[snake]||''])),
    companyPaymentTermDays:company?.payment_term_days??null,
    ...payment,
    ...paymentDeadline({...payment,companyPaymentTermDays:company?.payment_term_days??null,statusOverride:row.status_override||''}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};
const docOut = row => row ? ({
  id: row.id,
  tripId: row.trip_id,
  docType: row.doc_type,
  name: row.original_name,
  mime: row.mime,
  size: row.size,
  createdAt: row.created_at,
  paperAvailable: row.paper_available === 1,
  paperNote: row.paper_note || "",
  paperUpdatedAt: row.paper_updated_at || ""
}) : null;


const EXCEL_EXPORT_HEADERS=[
  'Дата', '№ заказчика', 'Фирма', 'Ссылка на Rechnung',
  'Маршрут', 'Цена (€)', 'Auftrag', 'CMR выгрузка / POD', 'Статус',
  'Документы получены фирмой', 'Срок оплаты, календарных дней', 'Оплатить до'
];
function tripStatusForExcel(t){
  const manual={
    rechnung_created:'Rechnung erstellt',
    invoice_sent:'Счёт отправлен',
    documents_received:'Документы получены фирмой',
    payment_received:'Оплата получена',
    ready_for_rechnung:'Готов к Rechnung',
    not_invoiced:'Rechnung ещё не выставлен',
    no_price:'Нет цены',
    loaded:'Загружен',
    missing_auftrag:'Не хватает Auftrag',
    missing_cmr:'Не хватает CMR/POD',
    missing_both:'Не хватает Auftrag и CMR/POD',
    missing_documents:'Не хватает документов'
  };
  if(t.statusOverride&&manual[t.statusOverride])return manual[t.statusOverride];
  if(t.rechnungCode)return 'Rechnung erstellt';
  if(t.cmrUnloaded&&t.priceEur==null)return 'Нет цены';
  if(t.auftrag&&t.cmrUnloaded&&t.priceEur!=null)return 'Готов к Rechnung';
  if(t.cmrLoaded)return 'Загружен';
  if(!t.auftrag&&!t.cmrUnloaded)return 'Не хватает Auftrag и CMR/POD';
  if(!t.auftrag)return 'Не хватает Auftrag';
  if(!t.cmrUnloaded)return 'Не хватает CMR/POD';
  return 'Не хватает документов';
}
const excelText=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ').slice(0,32767);
async function generateTripsExcel(trips){
  const workbook=new ExcelJS.Workbook();
  workbook.creator='Tsubera';
  workbook.created=new Date();
  workbook.modified=new Date();
  const sheet=workbook.addWorksheet('Рейсы',{
    views:[{state:'frozen',xSplit:0,ySplit:1}],
    properties:{defaultRowHeight:23}
  });
  sheet.columns=[
    {header:EXCEL_EXPORT_HEADERS[0],key:'date',width:16},
    {header:EXCEL_EXPORT_HEADERS[1],key:'order',width:25},
    {header:EXCEL_EXPORT_HEADERS[2],key:'company',width:39},
    {header:EXCEL_EXPORT_HEADERS[3],key:'invoice',width:68},
    {header:EXCEL_EXPORT_HEADERS[4],key:'route',width:71},
    {header:EXCEL_EXPORT_HEADERS[5],key:'price',width:17},
    {header:EXCEL_EXPORT_HEADERS[6],key:'auftrag',width:15},
    {header:EXCEL_EXPORT_HEADERS[7],key:'cmr',width:24},
    {header:EXCEL_EXPORT_HEADERS[8],key:'status',width:37},
    {header:EXCEL_EXPORT_HEADERS[9],key:'receivedDate',width:27},
    {header:EXCEL_EXPORT_HEADERS[10],key:'paymentDays',width:30},
    {header:EXCEL_EXPORT_HEADERS[11],key:'dueDate',width:18},
    ...[
      ['Tsubera Tour-ID','tourId',22],['Машины / Kennzeichen','vehicles',27],['Номер Rechnung','invoiceNumber',24],
      ['Код текущего статуса','statusCode',27],['Дата статуса','statusDate',18],['Статус записан (UTC)','statusUpdatedAt',25],
      ['Как отправлен счёт','sentVia',27],['Отправлен email','emailSentDate',19],['Отправлен бумажной почтой','postSentDate',25],
      ['Email получателя','recipient',42],['Ссылка на email','emailUrl',65],['Почтовое отправление / трек','tracking',33],
      ['Ссылка отслеживания','trackingUrl',65],['Примечание об отправке','dispatchNote',60],['Отдельный срок рейса, дней','tripDays',26],
      ['Срок фирмы, дней','companyDays',22],['Осталось дней до оплаты','daysRemaining',24],['Просрочено','overdue',17],
      ['Дата / время загрузки','loadedAt',25],['Дата / время выгрузки','unloadedAt',25],['CMR загрузки','cmrLoading',20],
      ['Документов','documentCount',16],['Бумажных копий подтверждено','paperCount',28],['Названия документов','documentNames',70],
      ['Рейс создан (UTC)','createdAt',26],['Рейс обновлён (UTC)','updatedAt',26],['Как фирма требует Rechnung','billingChannel',65],
      ['Email фирмы для Rechnung','companyEmail',45],['Почтовый адрес фирмы','postalAddress',65],['Требуемые документы','requiredDocuments',65],
      ['Срок отправки документов','submissionDeadline',65],['Особые правила фирмы','specialRules',65],['Источник правил','rulesSource',65],
      ['Фирма показывается','companyActive',23],['Примечание фирмы','companyNote',60],
      ['Ручной статус (код)','manualStatus',27],['Статус по документам (код)','derivedStatus',30],['ID рейса','tripDatabaseId',40],['Тема email по правилам фирмы','companyEmailSubject',65]
    ].map(([header,key,width])=>({header,key,width}))
  ];
  const header=sheet.getRow(1);
  header.height=32;
  header.eachCell(cell=>{
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17233D'}};
    cell.font={name:'Aptos',size:11,bold:true,color:{argb:'FFFFFFFF'}};
    cell.alignment={vertical:'middle',horizontal:'left',wrapText:true};
    cell.border={bottom:{style:'thin',color:{argb:'FF0B1225'}}};
  });
  trips.forEach((trip,index)=>{
    const company=companyOut(db.prepare('SELECT * FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1').get(trip.customer));
    const documents=listDocsForTrip(trip.id);
    const dateCell=value=>value?new Date(value+'T00:00:00.000Z'):null;
    const date=String(trip.date||'');
    const dateValue=/^\d{4}-\d{2}-\d{2}$/.test(date)?new Date(date+'T00:00:00.000Z'):date;
    const route=[excelText(trip.loadingPlace||'—'),excelText(trip.unloadingPlace||'—')].join(' → ');
    const row=sheet.addRow({
      date:dateValue,
      order:excelText(trip.trip),
      company:excelText(trip.customer),
      invoice:'',
      route,
      price:trip.priceEur===null?null:Number(trip.priceEur),
      auftrag:trip.auftrag?'Есть':'Нет',
      cmr:trip.cmrUnloaded?'Есть':'Нет',
      status:tripStatusForExcel(trip),
      receivedDate:trip.documentsReceivedDate?new Date(trip.documentsReceivedDate+'T00:00:00.000Z'):null,
      paymentDays:trip.effectivePaymentTermDays,
      dueDate:dateCell(trip.paymentDueDate),
      tourId:excelText(trip.internalTripId),vehicles:excelText((trip.vehiclePlates||[]).join(', ')),invoiceNumber:excelText(trip.rechnungCode),
      statusCode:trip.statusOverride||readiness(trip),statusDate:dateCell(trip.statusDate),statusUpdatedAt:excelText(trip.statusUpdatedAt),
      sentVia:({'email':'Email','post':'Бумажная почта','email_and_post':'Email и бумажная почта'})[trip.invoiceSentVia]||'',
      emailSentDate:dateCell(trip.invoiceEmailSentDate),postSentDate:dateCell(trip.invoicePostSentDate),recipient:excelText(trip.invoiceRecipientEmail),
      emailUrl:'',tracking:excelText(trip.invoicePostalTracking),trackingUrl:'',dispatchNote:excelText(trip.invoiceDispatchNote),
      tripDays:trip.paymentTermDays,companyDays:company?.paymentTermDays??null,daysRemaining:trip.paymentDaysRemaining,overdue:trip.paymentOverdue?'Да':'Нет',
      loadedAt:excelText(trip.loadedAt),unloadedAt:excelText(trip.unloadedAt),cmrLoading:trip.cmrLoaded?'Есть':'Нет',documentCount:documents.length,
      paperCount:documents.filter(doc=>doc.paperAvailable).length,documentNames:excelText(documents.map(doc=>doc.name).join('\n')),
      createdAt:excelText(trip.createdAt),updatedAt:excelText(trip.updatedAt),billingChannel:excelText(company?.billingChannel),companyEmail:excelText(company?.invoiceEmail),
      postalAddress:excelText(company?.postalAddress),requiredDocuments:excelText(company?.requiredDocuments),submissionDeadline:excelText(company?.submissionDeadline),
      specialRules:excelText(company?.specialRules),rulesSource:excelText(company?.rulesSource),companyActive:company?.active?'Да':'Нет',companyNote:excelText(company?.note),
      manualStatus:excelText(trip.statusOverride),derivedStatus:readiness({...trip,statusOverride:''}),tripDatabaseId:trip.id,companyEmailSubject:excelText(company?.invoiceSubject)
    });
    row.height=27;
    row.eachCell({includeEmpty:true},cell=>{
      cell.font={name:'Aptos',size:11,color:{argb:'FF19253A'}};
      cell.alignment={vertical:'middle',wrapText:false};
      if(index%2===1)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF4F7FB'}};
    });
    row.getCell('date').numFmt='dd.mm.yyyy';
    row.getCell('receivedDate').numFmt='dd.mm.yyyy';
    row.getCell('dueDate').numFmt='dd.mm.yyyy';
    row.getCell('paymentDays').numFmt='0';
    for(const key of ['statusDate','emailSentDate','postSentDate'])row.getCell(key).numFmt='dd.mm.yyyy';
    for(const key of ['tripDays','companyDays','daysRemaining','documentCount','paperCount'])row.getCell(key).numFmt='0';
    row.getCell('price').numFmt='#,##0.00 "€";[Red](#,##0.00 "€");"–"';
    row.getCell('price').alignment={vertical:'middle',horizontal:'right'};
    let invoiceUrl='';
    if(trip.rechnungUrl){
      try{invoiceUrl=normalizeFakturowniaUrl(trip.rechnungUrl);}
      catch{invoiceUrl='';}
    }
    if(invoiceUrl){
      const cell=row.getCell('invoice');
      cell.value={text:invoiceUrl,hyperlink:invoiceUrl,tooltip:'Открыть Rechnung в Fakturownia'};
      cell.font={name:'Aptos',size:10,underline:true,color:{argb:'FF1D4ED8'}};
      cell.alignment={vertical:'middle',horizontal:'left'};
    }
    for(const [key,value] of [['emailUrl',trip.invoiceEmailUrl],['trackingUrl',trip.invoicePostalTrackingUrl]]){
      if(!value)continue;let url;try{url=normalizeDispatchUrl(value);}catch{continue;}
      const cell=row.getCell(key);cell.value={text:url,hyperlink:url};cell.font={name:'Aptos',size:10,underline:true,color:{argb:'FF1D4ED8'}};
    }
    const statusCell=row.getCell('status');
    const billingColors={'Rechnung erstellt':'FF2447A3','Счёт отправлен':'FF0369A1','Документы получены фирмой':'FF0369A1','Оплата получена':'FF15803D'};
    const billingColor=billingColors[tripStatusForExcel(trip)];
    if(billingColor){
      statusCell.font={name:'Aptos',size:11,bold:true,color:{argb:billingColor}};
    }
  });
  sheet.autoFilter={from:{row:1,column:1},to:{row:trips.length+1,column:sheet.columnCount}};
  sheet.pageSetup={fitToPage:true,fitToWidth:1,orientation:'landscape'};
  const historySheet=workbook.addWorksheet('История статусов',{views:[{state:'frozen',ySplit:1}]});
  historySheet.columns=[['Tsubera Tour-ID','tour',23],['№ заказчика','order',25],['Фирма','company',40],['Статус','status',35],['Дата статуса','date',19],['Зафиксировано (UTC)','recordedAt',27],['Источник','source',18]].map(([header,key,width])=>({header,key,width}));
  const documentSheet=workbook.addWorksheet('Документы',{views:[{state:'frozen',ySplit:1}]});
  documentSheet.columns=[['Tsubera Tour-ID','tour',23],['№ заказчика','order',25],['Фирма','company',40],['ID документа','id',40],['Тип','type',25],['Имя файла','name',65],['Размер, байт','size',20],['Загружен (UTC)','createdAt',27],['Бумажный экземпляр у меня','paper',28],['Примечание о бумаге','note',60],['Бумага обновлена (UTC)','paperUpdatedAt',28]].map(([header,key,width])=>({header,key,width}));
  for(const trip of trips){
    for(const item of statusHistory(trip.id)){const row=historySheet.addRow({tour:excelText(trip.internalTripId),order:excelText(trip.trip),company:excelText(trip.customer),status:item.status?tripStatusForExcel({...trip,statusOverride:item.status}):'Автоматически (по документам)',date:item.statusDate?new Date(item.statusDate+'T00:00:00.000Z'):null,recordedAt:excelText(item.recordedAt),source:item.source});row.getCell('date').numFmt='dd.mm.yyyy';}
    for(const doc of listDocsForTrip(trip.id))documentSheet.addRow({tour:excelText(trip.internalTripId),order:excelText(trip.trip),company:excelText(trip.customer),id:doc.id,type:doc.docType,name:excelText(doc.name),size:doc.size,createdAt:doc.createdAt,paper:doc.paperAvailable?'Подтверждено':'Не подтверждено',note:excelText(doc.paperNote),paperUpdatedAt:doc.paperUpdatedAt});
  }
  for(const extra of [historySheet,documentSheet]){
    extra.getRow(1).height=32;extra.getRow(1).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17233D'}};cell.font={name:'Aptos',bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true,vertical:'middle'};});
    extra.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,extra.rowCount),column:extra.columnCount}};
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function json(res, status, data, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extra
  });
  res.end(body);
}
function text(res, status, body, extra = {}) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...extra });
  res.end(body);
}
async function readJson(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function readPaperInput(body, { requireAvailable = false, strict = false } = {}) {
  const bad = message => { throw Object.assign(new Error(message), { status: 400 }); };
  if (!body || typeof body !== "object" || Array.isArray(body)) bad("Expected a JSON object");
  if (strict && Object.keys(body).some(key => key !== "paperAvailable" && key !== "paperNote")) bad("Only paperAvailable and paperNote may be changed");
  const hasAvailable = Object.hasOwn(body, "paperAvailable");
  const hasNote = Object.hasOwn(body, "paperNote");
  if ((requireAvailable || hasAvailable) && typeof body.paperAvailable !== "boolean") bad("paperAvailable must be a boolean");
  if (hasNote && (typeof body.paperNote !== "string" || body.paperNote.length > 2000)) bad("paperNote must be a string of at most 2000 characters");
  return {
    ...(hasAvailable ? { paperAvailable: body.paperAvailable } : {}),
    ...(hasNote ? { paperNote: body.paperNote.trim() } : {})
  };
}
function storeTripDocument(t, { documentType, filename, mimeType, buffer, vehiclePlate, paperAvailable=false,paperNote='' }) {
  if(!['auftrag','cmr_loading','cmr_unloading','cmr','pod','rechnung','other'].includes(documentType))throw Object.assign(new Error('Unsupported document type'),{status:400});
  const paper=readPaperInput({paperAvailable,paperNote});
  if(typeof filename!=='string'||!filename.trim()||filename.length>500||/[\u0000-\u001f]/.test(filename))throw Object.assign(new Error('Invalid filename'),{status:400});
  const id = crypto.randomUUID();
  const ext = path.extname(filename).replace(/[^.a-zA-Z0-9]/g,"").slice(0,10);
  const stored = id + ext;
  fs.writeFileSync(path.join(DOCS_DIR, stored), buffer);
  const createdAt=now();
  db.prepare("INSERT INTO documents (id,trip_id,doc_type,original_name,stored_name,mime,size,created_at,paper_available,paper_note,paper_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,t.id,documentType,filename,stored,mimeType || "application/octet-stream",buffer.length,createdAt,paper.paperAvailable?1:0,paper.paperNote||'',paper.paperAvailable||paper.paperNote?createdAt:'');
  const flagMap = { auftrag: "auftrag", cmr_loading: "cmr_loaded", cmr_unloading: "cmr_unloaded", cmr: "cmr_loaded", pod: "cmr_unloaded" };
  const flag = flagMap[documentType];
  if (flag === "cmr_loaded") db.prepare("UPDATE trips SET cmr_loaded=1, cmr=1, updated_at=? WHERE id=?").run(now(), t.id);
  else if (flag === "cmr_unloaded") db.prepare("UPDATE trips SET cmr_unloaded=1, pod=1, updated_at=? WHERE id=?").run(now(), t.id);
  else if (flag === "auftrag") db.prepare("UPDATE trips SET auftrag=1, updated_at=? WHERE id=?").run(now(), t.id);
  else if (documentType === "rechnung") db.prepare("UPDATE trips SET rechnung_code=CASE WHEN TRIM(COALESCE(rechnung_code,''))='' THEN ? ELSE rechnung_code END, updated_at=? WHERE id=?").run(filename, now(), t.id);
  if (vehiclePlate) appendVehicleToTrip(t.id, vehiclePlate);
  const trip = getTripByAny(t.id);
  return {
    uploaded: true,
    document: docOut(docRow(id)),
    trip: { ...trip, readiness: readiness(trip), missing: missingForTrip(trip) }
  };
}
function apiAuthorized(req) {
  return onlineAuth.authorized(req);
}
function transCaptureAuthorized(req) {
  const token = req.headers["x-tsubera-capture-token"] || req.headers["x-app-password"];
  if (TRANS_CAPTURE_TOKEN) return token === TRANS_CAPTURE_TOKEN;
  return apiAuthorized(req);
}
function mcpAuthorized(token) {
  return !!CONNECTOR_TOKEN && token === CONNECTOR_TOKEN;
}
function fileSig(id, exp) {
  return crypto.createHmac("sha256", CONNECTOR_TOKEN || SITE_PASSWORD || "tsubera")
    .update(id + ":" + exp).digest("hex");
}
function tempFileUrl(req, id, seconds = 900, download = false) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host;
  return proto + "://" + host + "/file/" + encodeURIComponent(id) + "?exp=" + exp + "&sig=" + fileSig(id, exp) + (download ? "&download=1" : "");
}
function uploadTicketSig(ticket, exp) {
  return crypto.createHmac("sha256", CONNECTOR_TOKEN || SITE_PASSWORD || "tsubera")
    .update('mcp-upload-v1\n'+ticket + "\n" + exp).digest("hex");
}
function safeHexEqual(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
const connectorExports=new Map();
function connectorBase(req){return (process.env.PUBLIC_BASE_URL||((req.headers['x-forwarded-proto']||'http')+'://'+req.headers.host)).replace(/\/+$/,'');}
function connectorResourceSig(kind,id,exp){return crypto.createHmac('sha256',CONNECTOR_TOKEN).update(['mcp-resource-v1',kind,id,String(exp)].join('\n')).digest('hex');}
function connectorFileUrl(req,id,seconds=900){const exp=Math.floor(Date.now()/1000)+Math.min(900,seconds);return connectorBase(req)+'/file/'+encodeURIComponent(id)+'?access=mcp&exp='+exp+'&sig='+connectorResourceSig('file',id,exp);}
function validConnectorResource(req,url,p){
  if(!CONNECTOR_TOKEN)return false;
  const exp=Number(url.searchParams.get('exp')),current=Math.floor(Date.now()/1000),sig=url.searchParams.get('sig')||'';
  if(!Number.isInteger(exp)||exp<current||exp>current+900)return false;
  if(p==='/direct-upload'&&req.method==='POST'){
    const ticket=url.searchParams.get('ticket')||'';
    return !!ticket&&ticket.length<=10000&&safeHexEqual(sig,uploadTicketSig(ticket,exp));
  }
  if(req.method!=='GET'||url.searchParams.get('access')!=='mcp')return false;
  if(p.startsWith('/file/'))return safeHexEqual(sig,connectorResourceSig('file',p.slice(6),exp));
  if(p.startsWith('/connector-export/'))return safeHexEqual(sig,connectorResourceSig('excel',p.slice('/connector-export/'.length),exp));
  if(p.startsWith('/fakturownia/invoices/')&&p.endsWith('.pdf'))return safeHexEqual(sig,connectorResourceSig('fakturownia',p.slice('/fakturownia/invoices/'.length,-4),exp));
  return false;
}
function createConnectorExport(req,buffer){
  const current=Date.now();for(const [id,item] of connectorExports)if(item.exp*1000<current)connectorExports.delete(id);
  if(connectorExports.size>=20)connectorExports.delete(connectorExports.keys().next().value);
  const id=crypto.randomBytes(20).toString('hex')+'.xlsx',exp=Math.floor(current/1000)+900;
  connectorExports.set(id,{buffer,exp});
  return {downloadUrl:connectorBase(req)+'/connector-export/'+id+'?access=mcp&exp='+exp+'&sig='+connectorResourceSig('excel',id,exp),expiresAt:new Date(exp*1000).toISOString()};
}
function createDirectUploadUrl(req, args, seconds = 900) {
  readPaperInput({paperAvailable:args.paper_available??false,paperNote:args.paper_note??''});
  if(typeof args.filename!=='string'||!args.filename.trim()||args.filename.length>500||/[\u0000-\u001f]/.test(args.filename))throw Object.assign(new Error('Invalid filename'),{status:400});
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const payload = {
    trip: String(args.trip_id_or_number || ""),
    documentType: String(args.document_type || ""),
    filename: String(args.filename || ""),
    mimeType: String(args.mime_type || ""),
    vehiclePlate: String(args.vehicle_plate || ""),
    paperAvailable:args.paper_available??false,paperNote:args.paper_note??''
  };
  const ticket = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = uploadTicketSig(ticket, exp);
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host;
  return {
    uploadUrl: connectorBase(req) + "/direct-upload?ticket=" + encodeURIComponent(ticket) + "&exp=" + exp + "&sig=" + sig,
    expiresAt: new Date(exp * 1000).toISOString()
  };
}
function fakturowniaConfigured() {
  return !!FAKTUROWNIA_BASE_URL && !!FAKTUROWNIA_API_TOKEN;
}
function fakturowniaBase() {
  if (!fakturowniaConfigured()) {
    throw new Error("Fakturownia is not configured. Set FAKTUROWNIA_BASE_URL and FAKTUROWNIA_API_TOKEN in Railway.");
  }
  let u;
  try {
    u = new URL(FAKTUROWNIA_BASE_URL);
  } catch {
    throw new Error("FAKTUROWNIA_BASE_URL is invalid.");
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || !(host === "fakturownia.pl" || host.endsWith(".fakturownia.pl"))) {
    throw new Error("FAKTUROWNIA_BASE_URL must be an HTTPS fakturownia.pl address.");
  }
  return u.origin;
}
function fakturowniaUrl(pathname, params = {}) {
  const u = new URL(String(pathname || "").replace(/^\/+/, ""), fakturowniaBase() + "/");
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  // Fakturownia documents JSON GET requests with api_token in the query.
  if (FAKTUROWNIA_API_TOKEN && !u.searchParams.has("api_token")) {
    u.searchParams.set("api_token", FAKTUROWNIA_API_TOKEN);
  }
  return u;
}
async function fakturowniaFetch(pathname, params = {}, { accept = "application/json" } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(fakturowniaUrl(pathname, params), {
      method: "GET",
      headers: {
        "Accept": accept,
        "Authorization": "Bearer " + FAKTUROWNIA_API_TOKEN
      },
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error("Fakturownia API returned HTTP " + response.status + (body ? ": " + body.slice(0, 500) : ""));
    }
    return response;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Fakturownia API request timed out.");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
async function fakturowniaJson(pathname, params = {}) {
  const response = await fakturowniaFetch(pathname, params);
  return await response.json();
}
function fakturowniaInvoiceSummary(inv = {}) {
  return {
    id: inv.id ?? null,
    number: inv.number ?? "",
    kind: inv.kind ?? "",
    issueDate: inv.issue_date ?? "",
    sellDate: inv.sell_date ?? "",
    paymentTo: inv.payment_to ?? "",
    buyerName: inv.buyer_name ?? "",
    buyerTaxNo: inv.buyer_tax_no ?? "",
    sellerName: inv.seller_name ?? "",
    sellerTaxNo: inv.seller_tax_no ?? "",
    totalGross: inv.total_price_gross ?? inv.price_gross ?? null,
    totalNet: inv.total_price_net ?? inv.price_net ?? null,
    currency: inv.currency ?? "",
    status: inv.status ?? "",
    paid: inv.paid ?? null,
    income: inv.income ?? null,
    clientId: inv.client_id ?? null,
    oid: inv.oid ?? "",
    description: inv.description ?? "",
    viewUrl: inv.view_url ?? ""
  };
}
function fakturowniaClientSummary(client = {}) {
  return {
    id: client.id ?? null,
    name: client.name ?? "",
    taxNo: client.tax_no ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    street: client.street ?? "",
    postCode: client.post_code ?? "",
    city: client.city ?? "",
    country: client.country ?? "",
    externalId: client.external_id ?? null
  };
}
function fakturowniaListParams(args = {}, defaults = {}) {
  const page = Math.max(1, Number(args.page || defaults.page || 1));
  const perPage = Math.max(1, Math.min(100, Number(args.per_page || defaults.per_page || 25)));
  const params = { page, per_page: perPage };
  for (const key of ["period","date_from","date_to","income","kind","status","client_id","oid"]) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== "") params[key] = args[key];
  }
  return params;
}
function fakturowniaInvoiceHaystack(inv = {}) {
  const positions = Array.isArray(inv.positions) ? inv.positions.map(p => [p?.name,p?.description,p?.code].filter(Boolean).join(" ")) : [];
  return [
    inv.id, inv.number, inv.kind, inv.buyer_name, inv.buyer_tax_no, inv.buyer_email,
    inv.seller_name, inv.seller_tax_no, inv.oid, inv.description, inv.internal_note,
    inv.place, inv.invoice_issuer, ...positions
  ].filter(v => v !== undefined && v !== null).join(" ").toLowerCase();
}
async function searchFakturowniaInvoices(args = {}) {
  const q = String(args.query || "").trim().toLowerCase();
  if (!q) throw new Error("query is required");
  const limit = Math.max(1, Math.min(100, Number(args.limit || 25)));
  const maxPages = Math.max(1, Math.min(10, Number(args.max_pages || 5)));
  const params = fakturowniaListParams({ ...args, page: 1, per_page: 100 }, { per_page: 100 });
  const results = [];
  let searchedPages = 0;
  let scanned = 0;
  for (let page = 1; page <= maxPages && results.length < limit; page++) {
    const data = await fakturowniaJson("/invoices.json", { ...params, page, per_page: 100 });
    const rows = Array.isArray(data) ? data : [];
    searchedPages = page;
    scanned += rows.length;
    for (const inv of rows) {
      if (fakturowniaInvoiceHaystack(inv).includes(q)) results.push(fakturowniaInvoiceSummary(inv));
      if (results.length >= limit) break;
    }
    if (rows.length < 100) break;
  }
  return { results, count: results.length, scanned, searchedPages, limit, maxPages };
}
function fakturowniaPdfSig(id, exp) {
  return crypto.createHmac("sha256", CONNECTOR_TOKEN || SITE_PASSWORD || "tsubera")
    .update("fakturownia-pdf:" + id + ":" + exp).digest("hex");
}
function tempFakturowniaPdfUrl(req, id, seconds = 900) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers.host;
  return {
    downloadUrl: connectorBase(req) + "/fakturownia/invoices/" + encodeURIComponent(id) + ".pdf?access=mcp&exp=" + exp + "&sig=" + connectorResourceSig('fakturownia',id,exp),
    expiresAt: new Date(exp * 1000).toISOString()
  };
}

function missingForTrip(t) {
  const missing = [];
  if (!t.auftrag) missing.push("Transportauftrag");
  if (!t.cmrUnloaded) missing.push("CMR nach Entladung / POD");
  if (t.cmrUnloaded && t.priceEur == null) missing.push("Preis");
  return missing;
}
function readiness(t) {
  if (t.statusOverride) {
    if (invoicedTripStatuses.has(t.statusOverride)) return t.statusOverride;
    if (t.statusOverride==="ready_for_rechnung") return "ready_for_rechnung";
    if (t.statusOverride==="not_invoiced" && !missingForTrip(t).length) return "ready_for_rechnung";
    return "missing_documents";
  }
  if (t.rechnungCode) return "rechnung_created";
  return missingForTrip(t).length ? "missing_documents" : "ready_for_rechnung";
}
function getTripByAny(v) {
  const row = db.prepare("SELECT * FROM trips WHERE id = ? OR internal_trip_id = ? OR trip_number = ? LIMIT 1").get(v, v, v);
  return tripOut(row);
}
function docRow(id) {
  return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
}
function listDocsForTrip(tripId) {
  return db.prepare("SELECT * FROM documents WHERE trip_id = ? ORDER BY created_at DESC").all(tripId).map(docOut);
}
function listDocumentsWithTrips(){
  const rows=db.prepare(`SELECT d.*,t.id AS linked_trip_id,t.internal_trip_id,t.date AS trip_date,t.trip_number,t.customer,t.vehicle_plates,
    c.id AS company_id,c.name AS company_name,c.active AS company_active
    FROM documents d
    LEFT JOIN trips t ON t.id=d.trip_id
    LEFT JOIN companies c ON c.id=(SELECT id FROM companies WHERE LOWER(name)=LOWER(t.customer) LIMIT 1)
    ORDER BY d.created_at DESC,d.original_name COLLATE NOCASE,d.id`).all();
  return rows.map(row=>({...docOut(row),
    trip:row.linked_trip_id?{id:row.linked_trip_id,internalTripId:row.internal_trip_id||'',date:row.trip_date||'',trip:row.trip_number||'',customer:row.customer||'',vehiclePlates:platesToArray(row.vehicle_plates)}:null,
    company:row.company_id?{id:row.company_id,name:row.company_name,active:!!row.company_active}:null
  }));
}
function mainDocumentsForTrip(tripId) {
  const rows = db.prepare("SELECT * FROM documents WHERE trip_id = ? ORDER BY created_at DESC").all(tripId);
  const pick = types => {
    const matches = rows.filter(r => types.includes(r.doc_type));
    if (!matches.length) return null;
    return { ...docOut(matches[0]), count: matches.length };
  };
  return {
    auftrag: pick(["auftrag"]),
    cmrLoading: pick(["cmr_loading","cmr"]),
    cmrUnloading: pick(["cmr_unloading","pod"])
  };
}
function systemOverview() {
  const total = db.prepare("SELECT COUNT(*) c FROM trips").get().c;
  const docs = db.prepare("SELECT COUNT(*) c FROM documents").get().c;
  const rows = db.prepare("SELECT * FROM trips ORDER BY date DESC").all().map(tripOut);
  return {
    totalTrips: total,
    totalDocuments: docs,
    readyForRechnung: rows.filter(t => readiness(t) === "ready_for_rechnung").length,
    missingDocuments: rows.filter(t => readiness(t) === "missing_documents").length,
    rechnungenCreated: rows.filter(t => invoicedTripStatuses.has(readiness(t))).length,
    rechnungenSent: rows.filter(t => readiness(t) === "invoice_sent").length,
    documentsReceived: rows.filter(t => readiness(t) === "documents_received").length,
    paymentsReceived: rows.filter(t => readiness(t) === "payment_received").length,
    totalVehicles: db.prepare("SELECT COUNT(*) c FROM vehicles").get().c,
    totalCompanies: db.prepare("SELECT COUNT(*) c FROM companies").get().c,
    activeCompanies: db.prepare("SELECT COUNT(*) c FROM companies WHERE active=1").get().c,
    database: "Local Windows SQLite",
    files: "Local documents in DATA_DIR",
    connector: CONNECTOR_TOKEN ? "Enabled" : "Disabled",
    serverVersion:'2.0.0',
    capabilities:{invoiceDispatch:true,statusDates:true,statusHistory:true,completeExcel:true,paperTracking:true,signedConnectorResources:true}
  };
}

function queryTrips(args = {}) {
  let sql = "SELECT * FROM trips WHERE 1=1";
  const vals = [];
  if (args.query) {
    sql += " AND (LOWER(COALESCE(internal_trip_id,'')) LIKE ? OR LOWER(COALESCE(trip_number,'')) LIKE ? OR LOWER(customer) LIKE ? OR LOWER(COALESCE(vehicle_plates,'')) LIKE ? OR LOWER(COALESCE(loading_place,'')) LIKE ? OR LOWER(COALESCE(unloading_place,'')) LIKE ? OR date LIKE ? OR LOWER(rechnung_code) LIKE ?)";
    const q = "%" + String(args.query).toLowerCase() + "%";
    vals.push(q, q, q, q, q, q, q, q);
  }
  if (args.date_from) { sql += " AND date >= ?"; vals.push(args.date_from); }
  if (args.date_to) { sql += " AND date <= ?"; vals.push(args.date_to); }
  if (args.customer) { sql += " AND LOWER(customer) LIKE ?"; vals.push("%" + String(args.customer).toLowerCase() + "%"); }
  if (args.vehicle) { sql += " AND LOWER(COALESCE(vehicle_plates,'')) LIKE ?"; vals.push("%" + String(args.vehicle).toLowerCase() + "%"); }
  sql += " ORDER BY date DESC, created_at DESC LIMIT 500";
  let rows = db.prepare(sql).all(...vals).map(tripOut);
  if (args.readiness) rows = rows.filter(t => readiness(t) === args.readiness);
  if(args.include_hidden_companies===false)rows=rows.filter(t=>db.prepare('SELECT active FROM companies WHERE LOWER(name)=LOWER(?) LIMIT 1').get(t.customer)?.active!==0);
  if(args.statuses!==undefined){
    if(!Array.isArray(args.statuses)||args.statuses.some(status=>!tripFilterStatuses.includes(status)))throw Object.assign(new Error('Недопустимый фильтр статуса'),{status:400});
    if(args.statuses.length)rows=rows.filter(t=>args.statuses.some(status=>matchesTripFilter(t,status)));
  }
  return rows.map(t => ({
    ...t,
    readiness: readiness(t),
    missing: missingForTrip(t),
    mainDocuments: mainDocumentsForTrip(t.id)
  }));
}
const tripFilterStatuses=[...editableTripStatuses].filter(Boolean).concat(['has_invoice','no_invoice']);
const excelReadyRefs=new Set(['2026/10/06/63','2026/10/06/149','2026/10/06/11','2026/10/06/291','2026/10/01/27','2026/10/01/11','2026/09/25/1456','2026/09/24/137']);
function isReadyQueueTrip(t){
  const invoiced=t.statusOverride?invoicedTripStatuses.has(t.statusOverride):!!String(t.rechnungCode||'').trim();
  if(invoiced||(t.statusOverride&&!['ready_for_rechnung','not_invoiced'].includes(t.statusOverride)))return false;
  const ready=t.statusOverride?(t.statusOverride==='ready_for_rechnung'||(t.statusOverride==='not_invoiced'&&t.auftrag&&t.cmrUnloaded&&t.priceEur!=null)):(readiness(t)==='ready_for_rechnung'||(!t.rechnungCode&&t.auftrag&&t.cmrUnloaded&&t.priceEur!=null));
  return !!ready||excelReadyRefs.has(String(t.trip||''));
}
function matchesTripFilter(t,status){
  if(status==='no_price')return t.priceEur===null||t.statusOverride==='no_price';
  if(status==='missing_auftrag')return !t.auftrag||['missing_auftrag','missing_both'].includes(t.statusOverride);
  if(status==='ready_for_rechnung')return isReadyQueueTrip(t);
  if(status==='has_invoice')return readiness(t)==='rechnung_created';
  if(status==='no_invoice')return !invoicedTripStatuses.has(readiness(t));
  return t.statusOverride===status||readiness(t)===status;
}

function transClean(value, max = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\r/g, "").trim().slice(0, max);
}
function transNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/\s/g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
function transInteger(value) {
  const n = transNumber(value);
  return n === null ? null : Math.round(n);
}
function transFingerprint(offer) {
  const stable = [
    transClean(offer.loadText, 240).toLowerCase(),
    transClean(offer.unloadText, 240).toLowerCase(),
    transClean(offer.vehicleText, 500).toLowerCase(),
    transClean(offer.priceAmount, 40),
    transClean(offer.currency, 12).toUpperCase(),
    transClean(offer.company, 240).toLowerCase(),
    transClean(offer.publishedText, 120).toLowerCase(),
    transClean(offer.rawText, 3500).toLowerCase().replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, "").replace(/\s+/g, " ")
  ].join("|");
  return crypto.createHash("sha256").update(stable).digest("hex");
}
function transFreightOut(row) {
  return row ? {
    id: row.id,
    loadText: row.load_text || "",
    unloadText: row.unload_text || "",
    vehicleText: row.vehicle_text || "",
    weightT: row.weight_t === null || row.weight_t === undefined ? null : Number(row.weight_t),
    distanceKm: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
    priceAmount: row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount),
    currency: row.currency || "",
    paymentDays: row.payment_days === null || row.payment_days === undefined ? null : Number(row.payment_days),
    company: row.company || inferTransOrderCompany(row.raw_text) || "",
    companyRating: row.company_rating === null || row.company_rating === undefined ? null : Number(row.company_rating),
    publishedText: row.published_text || "",
    rawText: row.raw_text || "",
    sourceUrl: row.source_url || "",
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: Number(row.seen_count || 0)
  } : null;
}
function importTransFreights(body = {}) {
  const offers = Array.isArray(body.offers) ? body.offers.slice(0, TRANS_CAPTURE_MAX_ROWS) : [];
  const observedAtRaw = transClean(body.scannedAt, 80);
  const observedAt = /^\d{4}-\d{2}-\d{2}T/.test(observedAtRaw) ? observedAtRaw : now();
  const sourceUrl = transClean(body.pageUrl, 1500);
  let inserted = 0, updated = 0, ignored = 0;
  const upsert = db.prepare("INSERT INTO trans_freights (id,fingerprint,load_text,unload_text,vehicle_text,weight_t,distance_km,price_amount,currency,payment_days,company,company_rating,published_text,raw_text,source_url,first_seen_at,last_seen_at,seen_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(fingerprint) DO UPDATE SET load_text=excluded.load_text,unload_text=excluded.unload_text,vehicle_text=excluded.vehicle_text,weight_t=excluded.weight_t,distance_km=excluded.distance_km,price_amount=excluded.price_amount,currency=excluded.currency,payment_days=excluded.payment_days,company=excluded.company,company_rating=excluded.company_rating,published_text=excluded.published_text,raw_text=excluded.raw_text,source_url=excluded.source_url,last_seen_at=excluded.last_seen_at,seen_count=trans_freights.seen_count+1");
  for (const raw of offers) {
    const rawText = transClean(raw?.rawText, 8000);
    const loadText = transClean(raw?.loadText, 300);
    const unloadText = transClean(raw?.unloadText, 300);
    if (!rawText || (!loadText && !unloadText)) { ignored++; continue; }
    const offer = {
      loadText, unloadText,
      vehicleText: transClean(raw?.vehicleText, 1000),
      weightT: transNumber(raw?.weightT),
      distanceKm: transInteger(raw?.distanceKm),
      priceAmount: transNumber(raw?.priceAmount),
      currency: transClean(raw?.currency, 12).toUpperCase(),
      paymentDays: transInteger(raw?.paymentDays),
      company: transClean(raw?.company, 300),
      companyRating: transNumber(raw?.companyRating),
      publishedText: transClean(raw?.publishedText, 180),
      rawText
    };
    const fp = transFingerprint(offer);
    const exists = db.prepare("SELECT id FROM trans_freights WHERE fingerprint=?").get(fp);
    const id = exists?.id || crypto.randomUUID();
    upsert.run(id, fp, offer.loadText, offer.unloadText, offer.vehicleText, offer.weightT, offer.distanceKm, offer.priceAmount, offer.currency, offer.paymentDays, offer.company, offer.companyRating, offer.publishedText, offer.rawText, sourceUrl, observedAt, observedAt);
    if (exists) updated++; else inserted++;
  }
  db.prepare("DELETE FROM trans_freights WHERE julianday(last_seen_at) < julianday('now','-14 days')").run();
  return { received: offers.length, inserted, updated, ignored, scannedAt: observedAt };
}
function queryTransFreights(args = {}) {
  const where = [];
  const params = [];
  const q = transClean(args.query, 300);
  if (q) {
    const like = "%" + q.toLowerCase() + "%";
    where.push("(LOWER(load_text) LIKE ? OR LOWER(unload_text) LIKE ? OR LOWER(vehicle_text) LIKE ? OR LOWER(company) LIKE ? OR LOWER(raw_text) LIKE ?)");
    params.push(like, like, like, like, like);
  }
  const from = transClean(args.from, 120);
  if (from) { where.push("LOWER(load_text) LIKE ?"); params.push("%" + from.toLowerCase() + "%"); }
  const to = transClean(args.to, 120);
  if (to) { where.push("LOWER(unload_text) LIKE ?"); params.push("%" + to.toLowerCase() + "%"); }
  const currency = transClean(args.currency, 12).toUpperCase();
  if (currency) { where.push("currency=?"); params.push(currency); }
  const minPrice = transNumber(args.min_price);
  if (minPrice !== null) { where.push("price_amount>=?"); params.push(minPrice); }
  const minRating = transNumber(args.min_rating);
  if (minRating !== null) { where.push("company_rating>=?"); params.push(minRating); }
  const maxDistance = transInteger(args.max_distance_km);
  if (maxDistance !== null) { where.push("(distance_km IS NULL OR distance_km<=?)"); params.push(maxDistance); }
  const maxAge = Math.max(1, Math.min(14 * 24 * 60, Number(args.max_age_minutes || 180)));
  where.push("julianday(last_seen_at) >= julianday('now', ?)");
  params.push("-" + maxAge + " minutes");
  const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
  const sql = "SELECT * FROM trans_freights " + (where.length ? "WHERE " + where.join(" AND ") : "") + " ORDER BY last_seen_at DESC, price_amount DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(transFreightOut);
}
function transFreightStatus() {
  const total = Number(db.prepare("SELECT COUNT(*) c FROM trans_freights").get()?.c || 0);
  const fresh = Number(db.prepare("SELECT COUNT(*) c FROM trans_freights WHERE julianday(last_seen_at)>=julianday('now','-180 minutes')").get()?.c || 0);
  const latest = db.prepare("SELECT last_seen_at,source_url FROM trans_freights ORDER BY last_seen_at DESC LIMIT 1").get();
  return { totalStored: total, freshLast3Hours: fresh, lastCaptureAt: latest?.last_seen_at || null, lastSourceUrl: latest?.source_url || null };
}


function transFreightDetailOut(row) {
  return row ? {
    id: row.id,
    publicationId: row.publication_id || "",
    accountId: row.account_id || "",
    loadText: row.load_text || "",
    unloadText: row.unload_text || "",
    loadWindowText: row.load_window_text || "",
    unloadWindowText: row.unload_window_text || "",
    vehicleText: row.vehicle_text || "",
    weightT: row.weight_t === null || row.weight_t === undefined ? null : Number(row.weight_t),
    distanceKm: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
    approachKm: row.approach_km === null || row.approach_km === undefined ? null : Number(row.approach_km),
    destinationOffsetKm: row.destination_offset_km === null || row.destination_offset_km === undefined ? null : Number(row.destination_offset_km),
    priceAmount: row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount),
    currency: row.currency || "",
    pricePerKm: row.price_per_km === null || row.price_per_km === undefined ? null : Number(row.price_per_km),
    paymentDays: row.payment_days === null || row.payment_days === undefined ? null : Number(row.payment_days),
    company: row.company || "",
    companyRating: row.company_rating === null || row.company_rating === undefined ? null : Number(row.company_rating),
    contactName: row.contact_name || "",
    viewMode: row.view_mode || "",
    routeText: row.route_text || "",
    detailsText: row.details_text || "",
    companyText: row.company_text || "",
    reviewsText: row.reviews_text || "",
    negotiationsText: row.negotiations_text || "",
    rawText: row.raw_text || "",
    sourceUrl: row.source_url || "",
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: Number(row.seen_count || 0)
  } : null;
}
function importTransFreightDetail(body = {}) {
  const raw = body.detail || {};
  const publicationId = transClean(raw.publicationId, 120);
  if (!publicationId) throw new Error("publicationId is required");
  const observedAtRaw = transClean(body.scannedAt, 80);
  const observedAt = /^\d{4}-\d{2}-\d{2}T/.test(observedAtRaw) ? observedAtRaw : now();
  const sourceUrl = transClean(body.pageUrl, 1500);
  const item = {
    publicationId,
    accountId: transClean(raw.accountId, 120),
    loadText: transClean(raw.loadText, 300),
    unloadText: transClean(raw.unloadText, 300),
    loadWindowText: transClean(raw.loadWindowText, 220),
    unloadWindowText: transClean(raw.unloadWindowText, 220),
    vehicleText: transClean(raw.vehicleText, 1000),
    weightT: transNumber(raw.weightT),
    distanceKm: transInteger(raw.distanceKm),
    approachKm: transInteger(raw.approachKm),
    destinationOffsetKm: transInteger(raw.destinationOffsetKm),
    priceAmount: transNumber(raw.priceAmount),
    currency: transClean(raw.currency, 12).toUpperCase(),
    pricePerKm: transNumber(raw.pricePerKm),
    paymentDays: transInteger(raw.paymentDays),
    company: transClean(raw.company, 300),
    companyRating: transNumber(raw.companyRating),
    contactName: transClean(raw.contactName, 300),
    viewMode: transClean(raw.viewMode, 120),
    routeText: transClean(raw.routeText, 20000),
    detailsText: transClean(raw.detailsText, 20000),
    companyText: transClean(raw.companyText, 20000),
    reviewsText: transClean(raw.reviewsText, 20000),
    negotiationsText: transClean(raw.negotiationsText, 20000),
    rawText: transClean(raw.rawText, 20000)
  };
  if (!item.loadText || !item.unloadText) throw new Error("loadText and unloadText are required");
  const existing = db.prepare("SELECT id FROM trans_freight_details WHERE publication_id=?").get(publicationId);
  const id = existing?.id || crypto.randomUUID();
  db.prepare(`INSERT INTO trans_freight_details (
    id,publication_id,account_id,load_text,unload_text,load_window_text,unload_window_text,vehicle_text,weight_t,distance_km,approach_km,destination_offset_km,price_amount,currency,price_per_km,payment_days,company,company_rating,contact_name,view_mode,route_text,details_text,company_text,reviews_text,negotiations_text,raw_text,source_url,first_seen_at,last_seen_at,seen_count
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
  ON CONFLICT(publication_id) DO UPDATE SET
    account_id=CASE WHEN excluded.account_id<>'' THEN excluded.account_id ELSE trans_freight_details.account_id END,
    load_text=CASE WHEN excluded.load_text<>'' THEN excluded.load_text ELSE trans_freight_details.load_text END,
    unload_text=CASE WHEN excluded.unload_text<>'' THEN excluded.unload_text ELSE trans_freight_details.unload_text END,
    load_window_text=CASE WHEN excluded.load_window_text<>'' THEN excluded.load_window_text ELSE trans_freight_details.load_window_text END,
    unload_window_text=CASE WHEN excluded.unload_window_text<>'' THEN excluded.unload_window_text ELSE trans_freight_details.unload_window_text END,
    vehicle_text=CASE WHEN excluded.vehicle_text<>'' THEN excluded.vehicle_text ELSE trans_freight_details.vehicle_text END,
    weight_t=COALESCE(excluded.weight_t,trans_freight_details.weight_t),
    distance_km=COALESCE(excluded.distance_km,trans_freight_details.distance_km),
    approach_km=COALESCE(excluded.approach_km,trans_freight_details.approach_km),
    destination_offset_km=COALESCE(excluded.destination_offset_km,trans_freight_details.destination_offset_km),
    price_amount=COALESCE(excluded.price_amount,trans_freight_details.price_amount),
    currency=CASE WHEN excluded.currency<>'' THEN excluded.currency ELSE trans_freight_details.currency END,
    price_per_km=COALESCE(excluded.price_per_km,trans_freight_details.price_per_km),
    payment_days=COALESCE(excluded.payment_days,trans_freight_details.payment_days),
    company=CASE WHEN excluded.company<>'' THEN excluded.company ELSE trans_freight_details.company END,
    company_rating=COALESCE(excluded.company_rating,trans_freight_details.company_rating),
    contact_name=CASE WHEN excluded.contact_name<>'' THEN excluded.contact_name ELSE trans_freight_details.contact_name END,
    view_mode=CASE WHEN excluded.view_mode<>'' THEN excluded.view_mode ELSE trans_freight_details.view_mode END,
    route_text=CASE WHEN excluded.route_text<>'' THEN excluded.route_text ELSE trans_freight_details.route_text END,
    details_text=CASE WHEN excluded.details_text<>'' THEN excluded.details_text ELSE trans_freight_details.details_text END,
    company_text=CASE WHEN excluded.company_text<>'' THEN excluded.company_text ELSE trans_freight_details.company_text END,
    reviews_text=CASE WHEN excluded.reviews_text<>'' THEN excluded.reviews_text ELSE trans_freight_details.reviews_text END,
    negotiations_text=CASE WHEN excluded.negotiations_text<>'' THEN excluded.negotiations_text ELSE trans_freight_details.negotiations_text END,
    raw_text=CASE WHEN excluded.raw_text<>'' THEN excluded.raw_text ELSE trans_freight_details.raw_text END,
    source_url=CASE WHEN excluded.source_url<>'' THEN excluded.source_url ELSE trans_freight_details.source_url END,
    last_seen_at=excluded.last_seen_at,
    seen_count=trans_freight_details.seen_count+1`).run(
      id,item.publicationId,item.accountId,item.loadText,item.unloadText,item.loadWindowText,item.unloadWindowText,item.vehicleText,item.weightT,item.distanceKm,item.approachKm,item.destinationOffsetKm,item.priceAmount,item.currency,item.pricePerKm,item.paymentDays,item.company,item.companyRating,item.contactName,item.viewMode,item.routeText,item.detailsText,item.companyText,item.reviewsText,item.negotiationsText,item.rawText,sourceUrl,observedAt,observedAt
    );
  db.prepare("DELETE FROM trans_freight_details WHERE julianday(last_seen_at) < julianday('now','-14 days')").run();
  return { received: 1, inserted: existing ? 0 : 1, updated: existing ? 1 : 0, publicationId, scannedAt: observedAt };
}
function queryTransFreightDetails(args = {}) {
  const where = [];
  const params = [];
  const q = transClean(args.query, 300);
  if (q) {
    const like = "%" + q.toLowerCase() + "%";
    where.push("(LOWER(publication_id) LIKE ? OR LOWER(load_text) LIKE ? OR LOWER(unload_text) LIKE ? OR LOWER(vehicle_text) LIKE ? OR LOWER(company) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(raw_text) LIKE ? OR LOWER(details_text) LIKE ? OR LOWER(company_text) LIKE ? OR LOWER(reviews_text) LIKE ? OR LOWER(negotiations_text) LIKE ?)");
    params.push(like,like,like,like,like,like,like,like,like,like,like);
  }
  const maxAge = Math.max(1, Math.min(14 * 24 * 60, Number(args.max_age_minutes || 180)));
  where.push("julianday(last_seen_at) >= julianday('now', ?)");
  params.push("-" + maxAge + " minutes");
  const limit = Math.max(1, Math.min(100, Number(args.limit || 50)));
  const sql = "SELECT * FROM trans_freight_details " + (where.length ? "WHERE " + where.join(" AND ") : "") + " ORDER BY last_seen_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(transFreightDetailOut);
}
function transFreightDetailStatus() {
  const total = Number(db.prepare("SELECT COUNT(*) c FROM trans_freight_details").get()?.c || 0);
  const fresh = Number(db.prepare("SELECT COUNT(*) c FROM trans_freight_details WHERE julianday(last_seen_at)>=julianday('now','-180 minutes')").get()?.c || 0);
  const latest = db.prepare("SELECT last_seen_at,source_url,publication_id,view_mode FROM trans_freight_details ORDER BY last_seen_at DESC LIMIT 1").get();
  return {
    totalStored: total,
    freshLast3Hours: fresh,
    lastCaptureAt: latest?.last_seen_at || null,
    lastSourceUrl: latest?.source_url || null,
    lastPublicationId: latest?.publication_id || null,
    lastViewMode: latest?.view_mode || null
  };
}

function transActiveFingerprint(item) {
  const stable = [
    transClean(item.startText, 300).toLowerCase(),
    transClean(item.endText, 300).toLowerCase(),
    transClean(item.partner, 300).toLowerCase(),
    transClean(item.vehiclePlate, 80).toUpperCase(),
    transClean(item.rawText, 3500).toLowerCase().replace(/\s+/g, " ")
  ].join("|");
  return crypto.createHash("sha256").update(stable).digest("hex");
}
function transActiveOut(row) {
  return row ? {
    id: row.id,
    statusText: row.status_text || "",
    statusDetails: row.status_details || "",
    startText: row.start_text || "",
    endText: row.end_text || "",
    etaText: row.eta_text || "",
    nextEtaText: row.next_eta_text || "",
    partner: row.partner || "",
    vehiclePlate: row.vehicle_plate || "",
    rawText: row.raw_text || "",
    sourceUrl: row.source_url || "",
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: Number(row.seen_count || 0)
  } : null;
}
function importTransActive(body = {}) {
  const transports = Array.isArray(body.transports) ? body.transports.slice(0, TRANS_CAPTURE_MAX_ROWS) : [];
  const observedAtRaw = transClean(body.scannedAt, 80);
  const observedAt = /^\d{4}-\d{2}-\d{2}T/.test(observedAtRaw) ? observedAtRaw : now();
  const sourceUrl = transClean(body.pageUrl, 1500);
  let inserted = 0, updated = 0, ignored = 0;
  const upsert = db.prepare("INSERT INTO trans_active_transports (id,fingerprint,status_text,status_details,start_text,end_text,eta_text,next_eta_text,partner,vehicle_plate,raw_text,source_url,first_seen_at,last_seen_at,seen_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) ON CONFLICT(fingerprint) DO UPDATE SET status_text=excluded.status_text,status_details=excluded.status_details,start_text=excluded.start_text,end_text=excluded.end_text,eta_text=excluded.eta_text,next_eta_text=excluded.next_eta_text,partner=excluded.partner,vehicle_plate=excluded.vehicle_plate,raw_text=excluded.raw_text,source_url=excluded.source_url,last_seen_at=excluded.last_seen_at,seen_count=trans_active_transports.seen_count+1");
  for (const raw of transports) {
    const item = {
      statusText: transClean(raw?.statusText, 300),
      statusDetails: transClean(raw?.statusDetails, 600),
      startText: transClean(raw?.startText, 400),
      endText: transClean(raw?.endText, 400),
      etaText: transClean(raw?.etaText, 180),
      nextEtaText: transClean(raw?.nextEtaText, 180),
      partner: transClean(raw?.partner, 400),
      vehiclePlate: normalizePlate(raw?.vehiclePlate || ""),
      rawText: transClean(raw?.rawText, 8000)
    };
    if (!item.rawText || !item.startText || !item.endText) { ignored++; continue; }
    const fp = transActiveFingerprint(item);
    const exists = db.prepare("SELECT id FROM trans_active_transports WHERE fingerprint=?").get(fp);
    const id = exists?.id || crypto.randomUUID();
    upsert.run(id,fp,item.statusText,item.statusDetails,item.startText,item.endText,item.etaText,item.nextEtaText,item.partner,item.vehiclePlate,item.rawText,sourceUrl,observedAt,observedAt);
    if (exists) updated++; else inserted++;
  }
  db.prepare("DELETE FROM trans_active_transports WHERE julianday(last_seen_at) < julianday('now','-7 days')").run();
  return { received: transports.length, inserted, updated, ignored, scannedAt: observedAt };
}
function queryTransActive(args = {}) {
  const where = [];
  const params = [];
  const q = transClean(args.query, 300);
  if (q) {
    const like = "%" + q.toLowerCase() + "%";
    where.push("(LOWER(status_text) LIKE ? OR LOWER(status_details) LIKE ? OR LOWER(start_text) LIKE ? OR LOWER(end_text) LIKE ? OR LOWER(partner) LIKE ? OR LOWER(vehicle_plate) LIKE ? OR LOWER(raw_text) LIKE ?)");
    params.push(like,like,like,like,like,like,like);
  }
  const vehicle = normalizePlate(args.vehicle || "");
  if (vehicle) { where.push("UPPER(vehicle_plate) LIKE ?"); params.push("%"+vehicle+"%"); }
  const maxAge = Math.max(1, Math.min(7 * 24 * 60, Number(args.max_age_minutes || 180)));
  where.push("julianday(last_seen_at) >= julianday('now', ?)");
  params.push("-" + maxAge + " minutes");
  const limit = Math.max(1, Math.min(200, Number(args.limit || 50)));
  const sql = "SELECT * FROM trans_active_transports " + (where.length ? "WHERE " + where.join(" AND ") : "") + " ORDER BY last_seen_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params).map(transActiveOut);
}
function transActiveStatus() {
  const total = Number(db.prepare("SELECT COUNT(*) c FROM trans_active_transports").get()?.c || 0);
  const fresh = Number(db.prepare("SELECT COUNT(*) c FROM trans_active_transports WHERE julianday(last_seen_at)>=julianday('now','-180 minutes')").get()?.c || 0);
  const latest = db.prepare("SELECT last_seen_at,source_url FROM trans_active_transports ORDER BY last_seen_at DESC LIMIT 1").get();
  return { totalStored: total, freshLast3Hours: fresh, lastCaptureAt: latest?.last_seen_at || null, lastSourceUrl: latest?.source_url || null };
}


function transOrderDate(orderNumber, loadWindowText = "") {
  const ref = String(orderNumber || "");
  let m = ref.match(/\b(20\d{2})\/(\d{2})\/(\d{2})\//);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = ref.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\//);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  m = String(loadWindowText || "").match(/\b(\d{2})\.(\d{2})\.(20\d{2})\b/);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  return "";
}
function inferTransOrderCompany(rawText) {
  const ls = String(rawText || "").replace(/\r/g, "").split("\n").map(x => x.trim()).filter(Boolean);
  if (!ls.length) return "";
  let anchor = -1;
  for (let i = ls.length - 1; i >= 0; i--) {
    if (/^Dawid\s+Oberszt$/i.test(ls[i])) { anchor = i; break; }
  }
  if (anchor < 0) return "";
  const skip = /^(DO|-|\d+|Auf Bestätigung warten|Bestätigt|Storniert|Abgeschlossen|In Bearbeitung|Warten auf Bedingungen|Wird vorbereitet|Vorinformationen vervollständigen)$/i;
  for (let i = anchor - 1; i >= Math.max(0, anchor - 8); i--) {
    const v = ls[i];
    if (!v || skip.test(v)) continue;
    if (/^20\d{2}\/\d{2}\/\d{2}\/\d+$/.test(v)) continue;
    if (/^\d{2}\.\d{2}\.\d{4}/.test(v)) continue;
    if (/^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?$/.test(v)) continue;
    if (/^\d[\d .]*(?:[.,]\d+)?\s*(?:EUR|PLN|GBP|CHF)$/i.test(v)) continue;
    if (/^\d[\d .]*\s*km$/i.test(v)) continue;
    if (/^(?:DE|PL|GB|BE|NL|FR|CZ|AT|IT|SK|HU|RO|BG|ES|PT|DK|SE|NO|FI|LT|LV|EE|SI|HR|CH|LU)\b/i.test(v)) continue;
    if (/^[A-ZÄÖÜ]{1,3}\s*[A-ZÄÖÜ]{1,3}\s*\d{1,4}$/i.test(v.replace(/-/g," "))) continue;
    return v.slice(0, 400);
  }
  return "";
}

function transOrderOut(row) {
  return row ? {
    id: row.id,
    orderNumber: row.order_number || "",
    date: transOrderDate(row.order_number, row.load_window_text),
    statusText: row.status_text || "",
    viewMode: row.view_mode || "",
    vehiclePlate: row.vehicle_plate || "",
    priceAmount: row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount),
    currency: row.currency || "",
    distanceKm: row.distance_km === null || row.distance_km === undefined ? null : Number(row.distance_km),
    loadText: row.load_text || "",
    unloadText: row.unload_text || "",
    loadWindowText: row.load_window_text || "",
    unloadWindowText: row.unload_window_text || "",
    company: row.company || inferTransOrderCompany(row.raw_text) || "",
    rawText: row.raw_text || "",
    sourceUrl: row.source_url || "",
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: Number(row.seen_count || 0)
  } : null;
}
function importTransOrders(body = {}) {
  const orders = Array.isArray(body.orders) ? body.orders.slice(0, TRANS_CAPTURE_MAX_ROWS) : [];
  const observedAtRaw = transClean(body.scannedAt, 80);
  const observedAt = /^\d{4}-\d{2}-\d{2}T/.test(observedAtRaw) ? observedAtRaw : now();
  const sourceUrl = transClean(body.pageUrl, 1500);
  const viewMode = transClean(body.viewMode, 40);
  let inserted = 0, updated = 0, ignored = 0;
  const find = db.prepare("SELECT id FROM trans_orders WHERE capture_key=? LIMIT 1");
  const upsert = db.prepare(
    "INSERT INTO trans_orders " +
    "(id,capture_key,order_number,status_text,view_mode,vehicle_plate,price_amount,currency,distance_km,load_text,unload_text,load_window_text,unload_window_text,company,raw_text,source_url,first_seen_at,last_seen_at,seen_count) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1) " +
    "ON CONFLICT(capture_key) DO UPDATE SET " +
    "status_text=CASE WHEN excluded.status_text<>'' THEN excluded.status_text ELSE trans_orders.status_text END, " +
    "view_mode=CASE WHEN excluded.view_mode<>'' THEN excluded.view_mode ELSE trans_orders.view_mode END, " +
    "vehicle_plate=CASE WHEN excluded.vehicle_plate<>'' THEN excluded.vehicle_plate ELSE trans_orders.vehicle_plate END, " +
    "price_amount=COALESCE(excluded.price_amount,trans_orders.price_amount), " +
    "currency=CASE WHEN excluded.currency<>'' THEN excluded.currency ELSE trans_orders.currency END, " +
    "distance_km=COALESCE(excluded.distance_km,trans_orders.distance_km), " +
    "load_text=CASE WHEN excluded.load_text<>'' THEN excluded.load_text ELSE trans_orders.load_text END, " +
    "unload_text=CASE WHEN excluded.unload_text<>'' THEN excluded.unload_text ELSE trans_orders.unload_text END, " +
    "load_window_text=CASE WHEN excluded.load_window_text<>'' THEN excluded.load_window_text ELSE trans_orders.load_window_text END, " +
    "unload_window_text=CASE WHEN excluded.unload_window_text<>'' THEN excluded.unload_window_text ELSE trans_orders.unload_window_text END, " +
    "company=CASE WHEN excluded.company<>'' THEN excluded.company ELSE trans_orders.company END, " +
    "raw_text=CASE WHEN excluded.raw_text<>'' THEN excluded.raw_text ELSE trans_orders.raw_text END, " +
    "source_url=excluded.source_url, last_seen_at=excluded.last_seen_at, seen_count=trans_orders.seen_count+1"
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const order of orders) {
      const orderNumber = transClean(order?.orderNumber, 120);
      if (!orderNumber) { ignored++; continue; }
      const company = transClean(order.company || inferTransOrderCompany(order.rawText), 400);
      const captureKey = transOrderKey(orderNumber, company);
      const existed = !!find.get(captureKey);
      upsert.run(
        crypto.randomUUID(), captureKey, orderNumber, transClean(order.statusText, 300),
        transClean(order.viewMode || viewMode, 40), normalizePlate(order.vehiclePlate),
        transNumber(order.priceAmount), transClean(order.currency, 12).toUpperCase(),
        transInteger(order.distanceKm), transClean(order.loadText, 400),
        transClean(order.unloadText, 400), transClean(order.loadWindowText, 160),
        transClean(order.unloadWindowText, 160), company,
        transClean(order.rawText, 12000), sourceUrl, observedAt, observedAt
      );
      if (existed) updated++; else inserted++;
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
  return { received: orders.length, inserted, updated, ignored, ...transOrderStatus() };
}
function queryTransOrders(args = {}) {
  let sql = "SELECT * FROM trans_orders WHERE 1=1";
  const params = [];
  if (args.query) {
    const q = "%" + String(args.query).toLowerCase() + "%";
    sql += " AND (LOWER(order_number) LIKE ? OR LOWER(status_text) LIKE ? OR LOWER(vehicle_plate) LIKE ? OR LOWER(load_text) LIKE ? OR LOWER(unload_text) LIKE ? OR LOWER(company) LIKE ? OR LOWER(raw_text) LIKE ?)";
    params.push(q,q,q,q,q,q,q);
  }
  if (args.vehicle) { sql += " AND LOWER(vehicle_plate) LIKE ?"; params.push("%" + String(args.vehicle).toLowerCase() + "%"); }
  if (args.view_mode) { sql += " AND LOWER(view_mode)=LOWER(?)"; params.push(String(args.view_mode)); }
  sql += " ORDER BY last_seen_at DESC LIMIT 1000";
  let rows = db.prepare(sql).all(...params).map(transOrderOut);
  if (args.date_from) rows = rows.filter(x => !x.date || x.date >= args.date_from);
  if (args.date_to) rows = rows.filter(x => !x.date || x.date <= args.date_to);
  const limit = Math.max(1, Math.min(1000, Number(args.limit || 250)));
  return rows.slice(0, limit);
}
function transOrderStatus() {
  const total = Number(db.prepare("SELECT COUNT(*) c FROM trans_orders").get()?.c || 0);
  const latest = db.prepare("SELECT last_seen_at,source_url,view_mode FROM trans_orders ORDER BY last_seen_at DESC LIMIT 1").get();
  const dates = db.prepare("SELECT order_number,load_window_text FROM trans_orders").all().map(r => transOrderDate(r.order_number,r.load_window_text)).filter(Boolean).sort();
  return {
    totalStored: total,
    lastCaptureAt: latest?.last_seen_at || null,
    lastSourceUrl: latest?.source_url || null,
    lastViewMode: latest?.view_mode || null,
    oldestCapturedOrderDate: dates[0] || null,
    newestCapturedOrderDate: dates[dates.length-1] || null
  };
}
function reconNorm(v) {
  return String(v || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function reconRef(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function sameMoney(a,b) {
  const x=Number(a), y=Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x-y) <= 0.02;
}
function dateDistanceDays(a,b) {
  if (!a || !b) return 9999;
  const x = new Date(a + "T12:00:00Z"), y = new Date(b + "T12:00:00Z");
  if (!Number.isFinite(x.getTime()) || !Number.isFinite(y.getTime())) return 9999;
  return Math.abs(x-y)/86400000;
}
let fakturowniaReconCache = { key:"", at:0, invoices:[] };
async function loadFakturowniaInvoicesRange(dateFrom,dateTo) {
  if (!fakturowniaConfigured()) return [];
  const key = [dateFrom||"",dateTo||""].join("|");
  if (fakturowniaReconCache.key===key && Date.now()-fakturowniaReconCache.at < 60000) return fakturowniaReconCache.invoices;
  const invoices = [];
  for (let page=1; page<=20; page++) {
    const data = await fakturowniaJson("/invoices.json", {
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      include_positions: "true",
      page,
      per_page: 100
    });
    const rows = Array.isArray(data) ? data : [];
    invoices.push(...rows);
    if (rows.length < 100) break;
  }
  fakturowniaReconCache = { key, at: Date.now(), invoices };
  return invoices;
}
function bestTripForOrder(order,trips,claimedTripIds) {
  const exact = trips.find(t => !claimedTripIds.has(t.id) && [t.trip,t.internalTripId].some(v => reconRef(v) && reconRef(v)===reconRef(order.orderNumber)));
  if (exact) return { trip:exact, confidence:"exact_ref" };
  const sameDate = trips.filter(t => !claimedTripIds.has(t.id) && order.date && t.date===order.date);
  const plate = normalizePlate(order.vehiclePlate);
  const priced = sameDate.filter(t => sameMoney(t.priceEur,order.priceAmount));
  if (plate) {
    const both = priced.filter(t => (t.vehiclePlates||[]).map(normalizePlate).includes(plate));
    if (both.length===1) return { trip:both[0], confidence:"date_price_vehicle" };
  }
  if (priced.length===1) return { trip:priced[0], confidence:"date_price" };
  return { trip:null, confidence:"" };
}
function transOrderServiceDate(order) {
  const values = [order?.loadWindowText, order?.unloadWindowText];
  for (const v of values) {
    const s = String(v || "");
    let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (m) return m[1]+"-"+m[2]+"-"+m[3];
    m = s.match(/\b(\d{2})\.(\d{2})\.(20\d{2})\b/);
    if (m) return m[3]+"-"+m[2]+"-"+m[1];
  }
  return order?.date || "";
}

function invoiceMatchForRefs(invoices,{refs=[],company="",date=""}={}) {
  const strongRefs = refs.map(reconRef).filter(x => x.length>=5);
  const companyNorm = reconNorm(company);
  const sameCompany = [];
  let exact = null;
  let probable = null;

  for (const inv of invoices) {
    const buyerNorm = reconNorm(inv.buyer_name);
    const companyMatch = !!companyNorm && !!buyerNorm && buyerNorm === companyNorm;
    if (!companyMatch) continue;

    const summary = fakturowniaInvoiceSummary(inv);
    sameCompany.push(summary);

    const hay = reconRef(fakturowniaInvoiceHaystack(inv));
    const exactRef = strongRefs.find(r => hay.includes(r));
    if (exactRef && !exact) {
      exact = {
        invoice:summary,
        score:100,
        exactRef,
        companyMatch:true,
        probable:false,
        dayDistance:0,
        matchDate:summary.sellDate || summary.issueDate || ""
      };
      continue;
    }

    const dateCandidates = [summary.sellDate, summary.issueDate].filter(Boolean);
    let bestDistance = 9999;
    let matchDate = "";
    for (const invoiceDate of dateCandidates) {
      const dist = dateDistanceDays(date, invoiceDate);
      if (dist < bestDistance) {
        bestDistance = dist;
        matchDate = invoiceDate;
      }
    }
    if (bestDistance <= 45 && (!probable || bestDistance < probable.dayDistance)) {
      probable = {
        invoice:summary,
        score:Math.max(1, 60 - Math.min(45, bestDistance)),
        exactRef:"",
        companyMatch:true,
        probable:true,
        dayDistance:bestDistance,
        matchDate
      };
    }
  }

  return {
    invoice:exact,
    candidate:exact ? null : probable,
    companyInvoices:sameCompany
  };
}
function invoicePaymentState(match) {
  const inv = match?.invoice;
  if (!inv) return "unknown";
  const total = Number(inv.totalGross ?? inv.totalNet);
  const paid = Number(inv.paid ?? 0);
  if (String(inv.status||"").toLowerCase()==="paid" || (Number.isFinite(total) && total>0 && paid >= total-0.02)) return "paid";
  if (paid > 0) return "partial";
  return "unpaid";
}
async function buildReconciliation(args={}) {
  const dateFrom = String(args.date_from || "2026-08-11");
  const dateTo = String(args.date_to || new Date().toISOString().slice(0,10));
  const orders = queryTransOrders({ date_from:dateFrom, date_to:dateTo, limit:1000 });
  let invoices = [], fakturowniaError = "";

  if (fakturowniaConfigured()) {
    try { invoices = await loadFakturowniaInvoicesRange("",""); }
    catch (e) { fakturowniaError = e?.message || String(e); }
  }

  const rows = [];
  for (const order of orders) {
    const company = order.company || "";
    const im = invoiceMatchForRefs(invoices,{
      refs:[order.orderNumber].filter(Boolean),
      company,
      date:transOrderServiceDate(order)
    });

    const exact = !!im.invoice;
    const candidate = !!im.candidate;
    const paymentState = exact ? invoicePaymentState(im.invoice) : "unknown";

    let action = "no_invoice";
    if (!fakturowniaConfigured()) action = "connect_fakturownia";
    else if (exact && paymentState==="paid") action = "paid";
    else if (exact && paymentState==="partial") action = "partial";
    else if (exact) action = "invoiced";
    else if (candidate) action = "check_invoice";
    else if ((im.companyInvoices||[]).length) action = "company_has_invoices";

    rows.push({
      source:"trans_order",
      date:order.date || "",
      order,
      companyInvoiceCount:(im.companyInvoices||[]).length,
      companyInvoices:(im.companyInvoices||[]).slice(0,20),
      invoicePresent:exact,
      invoiceMatch:im.invoice,
      invoiceCandidate:im.candidate,
      paymentState,
      action
    });
  }

  rows.sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const counts = rows.reduce((acc,r)=>{acc[r.action]=(acc[r.action]||0)+1;return acc;},{});

  return {
    dateFrom,dateTo,
    transOrders:orders.length,
    fakturownia:{
      configured:fakturowniaConfigured(),
      reachable:fakturowniaConfigured() && !fakturowniaError,
      invoiceCount:invoices.length,
      error:fakturowniaError || null
    },
    counts,
    rows
  };
}

const toolDefs = [
  {
    name:'get_capabilities',description:'Read the live server version, supported fields and tools. Refresh the app connection if cached schemas are older.',
    inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:'export_trips_excel',description:'Export complete trip, status/date, dispatch, invoice/email/tracking links, company rules, history and document-paper details. Supply ordered trip_ids for an exact visible selection, or filters. Returns a scoped 15-minute XLSX download link; never sends any invoice or email.',
    inputSchema:{type:'object',properties:{
      trip_ids:{type:'array',items:{type:'string'},minItems:1,maxItems:500,description:'Ordered unique trip IDs or Tsubera Tour-IDs. Do not combine with filters.'},
      query:{type:'string'},date_from:{type:'string'},date_to:{type:'string'},customer:{type:'string'},vehicle:{type:'string'},
      statuses:{type:'array',items:{type:'string',enum:tripFilterStatuses}},include_hidden_companies:{type:'boolean',description:'For filtered exports defaults to false, matching the default website view.'}
    },additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },
  {
    name:'update_document_paper',description:'Update possession of a paper COPY only when the user confirms it. This does not prove originals, number of originals or postal dispatch. Unchecked means unconfirmed.',
    inputSchema:{type:'object',properties:{document_id:{type:'string'},paper_available:{type:'boolean'},paper_note:{type:'string',maxLength:2000}},required:['document_id'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },
  {
    name: "get_trans_order_status",
    description: "Check how many Trans.eu Aufträge were captured from the user's logged-in browser, including archive scans.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "search_trans_orders",
    description: "Search Trans.eu Aufträge captured from the user's logged-in browser. Supports date, vehicle, and archive/active view filters.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        vehicle: { type: "string" },
        view_mode: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 1000 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "get_reconciliation",
    description: "Compare captured Trans.eu orders with Fakturownia. Exact match requires the same company plus the Trans.eu Auftrag number in the invoice; otherwise the nearest-date invoice for the same company is shown only as a probable match.",
    inputSchema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "YYYY-MM-DD, default 2026-08-11" },
        date_to: { type: "string", description: "YYYY-MM-DD" }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "get_system_overview",
    description: "Return a read-only overview of the Tsubera transport document system, counts, storage locations and readiness totals.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "get_trans_freight_status",
    description: "Check when the Chrome extension last captured Trans.eu freight offers and how many recent offers are stored. Only offers rendered in the user logged-in Trans.eu browser session are available.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "search_trans_freights",
    description: "Search freight offers captured from the user Trans.eu Fracht suchen page by the Tsubera Chrome extension. Captured data can be incomplete because only offers actually rendered in the browser are stored.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        currency: { type: "string" },
        min_price: { type: "number" },
        min_rating: { type: "number" },
        max_distance_km: { type: "integer" },
        max_age_minutes: { type: "integer", minimum: 1, maximum: 20160 },
        limit: { type: "integer", minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "get_fakturownia_status",
    description: "Check whether the read-only Fakturownia connection is configured and reachable. Does not expose the API token.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "search_fakturownia_invoices",
    description: "Search recent Fakturownia invoices/expenses by invoice number, customer/supplier name, tax number, order ID, description, or line item text. Searches up to 10 pages of 100 records each.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        period: { type: "string", description: "Optional Fakturownia period filter, e.g. this_month." },
        date_from: { type: "string", description: "Optional date filter accepted by Fakturownia, YYYY-MM-DD." },
        date_to: { type: "string", description: "Optional date filter accepted by Fakturownia, YYYY-MM-DD." },
        income: { type: "string", enum: ["yes","no"], description: "yes = income invoices, no = expenses." },
        kind: { type: "string" },
        status: { type: "string" },
        client_id: { type: ["string","number"] },
        oid: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        max_pages: { type: "integer", minimum: 1, maximum: 10 }
      },
      required: ["query"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "list_fakturownia_invoices",
    description: "List Fakturownia invoices or expenses using read-only API filters.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Optional period, e.g. this_month." },
        date_from: { type: "string", description: "YYYY-MM-DD." },
        date_to: { type: "string", description: "YYYY-MM-DD." },
        income: { type: "string", enum: ["yes","no"], description: "yes = income invoices, no = expenses." },
        kind: { type: "string" },
        status: { type: "string" },
        client_id: { type: ["string","number"] },
        oid: { type: "string" },
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "get_fakturownia_invoice",
    description: "Get the full read-only Fakturownia invoice JSON by invoice ID, including positions when returned by Fakturownia.",
    inputSchema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "get_fakturownia_invoice_pdf",
    description: "Get a secure temporary PDF link for a Fakturownia invoice. The Fakturownia API token stays server-side and is never placed in the returned URL.",
    inputSchema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "list_fakturownia_clients",
    description: "List Fakturownia clients using the read-only API.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1 },
        per_page: { type: "integer", minimum: 1, maximum: 100 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "get_fakturownia_client",
    description: "Get one Fakturownia client by client ID.",
    inputSchema: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
  },
  {
    name: "search",
    description: "Search Tsubera trips by Tsubera Tour-ID, customer tour/order number, customer, date, or Rechnung number.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "list_trips",
    description: "List Tsubera trips with document completeness. Supports date range, customer, text query and readiness filter.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        customer: { type: "string" },
        vehicle: { type: "string", description: "Vehicle registration / Kennzeichen filter." },
        readiness: { type: "string", enum: ["ready_for_rechnung","missing_documents","rechnung_created","invoice_sent","documents_received","payment_received"] },
        statuses:{type:"array",items:{type:"string",enum:tripFilterStatuses},description:"Multiple selected statuses use OR."},
        include_hidden_companies:{type:"boolean",description:"Defaults to true for all records; false limits to current companies."}
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "get_trip",
    description: "Get one Tsubera trip by database id, Tsubera Tour-ID, or customer tour/order number, including missing documents and uploaded file metadata.",
    inputSchema: { type: "object", properties: { trip_id_or_number: { type: "string" } }, required: ["trip_id_or_number"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "list_documents",
    description: "List uploaded document metadata, optionally for one trip or one document type.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id_or_number: { type: "string" },
        type: { type: "string", enum: ["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"] }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "get_document",
    description: "Get metadata for one uploaded document and a temporary download URL valid for 15 minutes.",
    inputSchema: { type: "object", properties: { document_id: { type: "string" } }, required: ["document_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "list_companies",
    description: "List customer companies from the Tsubera company registry, including whether each company is active in the default trips view and its trip count.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "create_company",
    description: "Add a customer company to the Tsubera company registry. New companies are active by default unless active=false is provided.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        active: { type: "boolean", description: "Whether the company's trips should be visible in the default current view." },
        note: { type: "string" },
        billing_channel: { type: "string" },
        invoice_email: { type: "string" },
        invoice_subject: { type: "string" },
        postal_address: { type: "string" },
        required_documents: { type: "string" },
        submission_deadline: { type: "string" },
        special_rules: { type: "string" },
        rules_source: { type: "string" },
        payment_term_days: { type: ["integer","null"], minimum: 0, maximum: 3650, description: "Calendar days from document receipt; null leaves the company term unset." }
      },
      required: ["name"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "update_company",
    description: "Update a customer company name, note, or active/default-visible state. Renaming also updates existing trips that use the old company name.",
    inputSchema: {
      type: "object",
      properties: {
        company_id: { type: "string" },
        name: { type: "string" },
        active: { type: "boolean" },
        note: { type: "string" },
        billing_channel: { type: "string" },
        invoice_email: { type: "string" },
        invoice_subject: { type: "string" },
        postal_address: { type: "string" },
        required_documents: { type: "string" },
        submission_deadline: { type: "string" },
        special_rules: { type: "string" },
        rules_source: { type: "string" },
        payment_term_days: { type: ["integer","null"], minimum: 0, maximum: 3650, description: "Calendar days from document receipt; null clears the company term." }
      },
      required: ["company_id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "list_vehicles",
    description: "List the vehicle registry used for Tsubera tours, including plate numbers and how many tours reference each vehicle.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: "create_vehicle",
    description: "Add a vehicle registration number (Kennzeichen) to the Tsubera vehicle registry.",
    inputSchema: {
      type: "object",
      properties: {
        plate: { type: "string", description: "Vehicle registration / Kennzeichen." },
        note: { type: "string", description: "Optional note such as owner/company." }
      },
      required: ["plate"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name:'update_vehicle',description:'Update a vehicle plate or note. Renaming replaces this plate in all linked tours and leaves other assigned vehicles intact.',
    inputSchema:{type:'object',properties:{vehicle_id:{type:'string'},plate:{type:'string'},note:{type:'string',maxLength:4000}},required:['vehicle_id'],additionalProperties:false},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },
  {
    name: "assign_vehicle_to_trip",
    description: "Assign a vehicle from the registry to an existing tour. The vehicle is added without removing other vehicles already assigned to the tour.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id_or_number: { type: "string" },
        vehicle_plate: { type: "string" }
      },
      required: ["trip_id_or_number","vehicle_plate"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "create_trip",
    description: "Create a new Tsubera trip. A stable Tsubera Tour-ID like TS-261001-001 is generated automatically from the trip date.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Trip date in YYYY-MM-DD format." },
        trip_number: { type: "string", description: "Customer's order/tour/reference number if known. Tsubera Tour-ID is generated automatically." },
        customer: { type: "string", description: "Customer/company name." },
        auftrag: { type: "boolean", description: "Whether Transportauftrag is already present." },
        cmr_loaded: { type: "boolean", description: "Whether the CMR/loading confirmation after loading is present." },
        cmr_unloaded: { type: "boolean", description: "Whether the final CMR/POD after unloading is present." },
        loaded_at: { type: "string", description: "Loading date/time, preferably ISO local datetime." },
        unloaded_at: { type: "string", description: "Unloading date/time, preferably ISO local datetime." },
        loading_place: { type: "string", description: "Loading location, preferably country + postcode + city/address." },
        unloading_place: { type: "string", description: "Unloading location, preferably country + postcode + city/address." },
        vehicle_plates: { type: "array", items: { type: "string" }, description: "Vehicle registration numbers (Kennzeichen) that performed this tour." },
        price_eur: { type: ["number","null"], description: "Trip price in EUR. Use null to leave price empty." },
        cmr: { type: "boolean", description: "Legacy alias for cmr_loaded." },
        pod: { type: "boolean", description: "Legacy alias for cmr_unloaded." },
        rechnung_number: { type: "string", description: "Rechnung number if already created." },
        rechnung_url: {type:"string",description:"HTTPS Fakturownia invoice link, or empty."},
        ...dispatchMcpProperties,
        status_override: { type: "string", enum: [...editableTripStatuses] },
        documents_received_date: { type: "string", description: "Confirmed document receipt date YYYY-MM-DD, or empty to clear." },
        payment_term_days: { type: ["integer","null"], minimum: 0, maximum: 3650, description: "Trip override in calendar days; null inherits the company term." }
      },
      required: ["date","customer"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: "update_trip",
    description: "Update Tsubera trip fields such as document flags, customer, date, tour number, or Rechnung number.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id_or_number: { type: "string" },
        internal_trip_id:{type:'string',minLength:3,maxLength:80,description:'Optional replacement Tsubera Tour-ID; must be unique.'},
        date: { type: "string" },
        trip_number: { type: "string" },
        customer: { type: "string" },
        auftrag: { type: "boolean" },
        cmr_loaded: { type: "boolean" },
        cmr_unloaded: { type: "boolean" },
        loaded_at: { type: "string" },
        unloaded_at: { type: "string" },
        loading_place: { type: "string" },
        unloading_place: { type: "string" },
        vehicle_plates: { type: "array", items: { type: "string" } },
        price_eur: { type: ["number","null"], description: "Trip price in EUR. Pass null to clear it." },
        cmr: { type: "boolean" },
        pod: { type: "boolean" },
        rechnung_number: { type: "string" },
        rechnung_url: {type:"string",description:"HTTPS Fakturownia invoice link, or empty."},
        ...dispatchMcpProperties,
        status_override: { type: "string", enum: [...editableTripStatuses] },
        documents_received_date: { type: "string", description: "Confirmed document receipt date YYYY-MM-DD, or empty to clear." },
        payment_term_days: { type: ["integer","null"], minimum: 0, maximum: 3650, description: "Trip override in calendar days; null inherits the company term." }
      },
      required: ["trip_id_or_number"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "upload_document",
    description: "Upload a document file to an existing Tsubera trip. Supports Auftrag, CMR after loading, final CMR/POD after unloading, Rechnung, and other files. Maximum decoded file size is 10 MB.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id_or_number: { type: "string", description: "Existing trip internal id or tour number." },
        document_type: { type: "string", enum: ["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"] },
        filename: { type: "string" },
        paper_available:{type:"boolean",description:"True only when the user confirms possession of a paper copy; otherwise false."},
        paper_note:{type:"string",maxLength:2000},
        mime_type: { type: "string" },
        vehicle_plate: { type: "string", description: "Optional vehicle plate detected/selected from this document. It will be assigned to the tour." },
        content_base64: { type: "string", description: "Base64 encoded raw file content, without data: prefix." }
      },
      required: ["trip_id_or_number","document_type","filename","content_base64"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  },
  {
    name: "upload_document_from_url",
    description: "Fast document upload from a temporary/signed HTTPS download URL. Use for files handed off by ChatGPT, Gmail, Google Drive or similar connectors so the file does not need to be copied into base64 first. The file is downloaded server-side and stored in the Tsubera trip. Maximum file size is 20 MB.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id_or_number: { type: "string", description: "Existing Tsubera Tour-ID, customer tour/order number, or trip database id." },
        document_type: { type: "string", enum: ["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"] },
        filename: { type: "string" },
        paper_available:{type:"boolean",description:"True only when the user confirms possession of a paper copy; otherwise false."},
        paper_note:{type:"string",maxLength:2000},
        mime_type: { type: "string", description: "Optional MIME override; if omitted the source response Content-Type is used." },
        vehicle_plate: { type: "string", description: "Optional vehicle plate detected/selected from this document. It will be assigned to the tour." },
        source_url: { type: "string", description: "Temporary or signed HTTPS download URL for the original file." }
      },
      required: ["trip_id_or_number","document_type","filename","source_url"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "create_document_upload_url",
    description: "Create a short-lived signed upload URL for sending the original file bytes directly from ChatGPT or another client to a Tsubera trip. No base64 and no Google Drive staging are required. After receiving the URL, POST the raw file bytes to it. Maximum file size is 50 MB.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id_or_number: { type: "string", description: "Existing Tsubera Tour-ID, customer tour/order number, or trip database id." },
        document_type: { type: "string", enum: ["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"] },
        filename: { type: "string" },
        paper_available:{type:"boolean",description:"True only when the user confirms possession of a paper copy; otherwise false."},
        paper_note:{type:"string",maxLength:2000},
        mime_type: { type: "string", description: "MIME type of the original file, for example application/pdf or image/jpeg." },
        vehicle_plate: { type: "string", description: "Optional vehicle plate to assign to the trip together with the document." }
      },
      required: ["trip_id_or_number","document_type","filename"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  {
    name: "update_document_type",
    description: "Reclassify an uploaded document as Transportauftrag, CMR after loading, final CMR/POD after unloading, Rechnung, or other.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        document_type: { type: "string", enum: ["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"] }
      },
      required: ["document_id","document_type"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "fetch",
    description: "Fetch one Tsubera trip or document by id for connector retrieval.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];

async function callTool(name, args, req) {
  if(name==='get_capabilities')return {serverVersion:'2.0.0',overview:systemOverview(),tripFields:Object.keys(tripOut(db.prepare('SELECT * FROM trips LIMIT 1').get())||dispatchFields),tools:toolDefs.map(tool=>({name:tool.name,inputSchema:tool.inputSchema,annotations:tool.annotations})),notes:['Dates not supplied for historical events remain unknown.','Dispatch tracking records facts; it never sends email or paper post.','Receipt rollback clears its date/countdown; configured payment terms remain.','MCP signed resources expire after 15 minutes.']};
  if(name==='export_trips_excel'){
    let trips;
    if(args.trip_ids!==undefined){
      if(!Array.isArray(args.trip_ids)||!args.trip_ids.length||args.trip_ids.length>500||args.trip_ids.some(id=>typeof id!=='string'||id.length>160)||Object.keys(args).some(key=>key!=='trip_ids'))throw Object.assign(new Error('Supply only1–500 ordered trip_ids, or use filters separately'),{status:400});
      trips=args.trip_ids.map(id=>getTripByAny(id));
      if(trips.some(trip=>!trip)||new Set(trips.map(trip=>trip.id)).size!==trips.length)throw Object.assign(new Error('Trips must exist and be unique'),{status:400});
    }else trips=queryTrips({...args,include_hidden_companies:args.include_hidden_companies??false});
    if(!trips.length)throw Object.assign(new Error('No trips match these filters'),{status:400});
    const buffer=await generateTripsExcel(trips),link=createConnectorExport(req,buffer);
    return {...link,filename:'Tsubera-trips-'+new Date().toISOString().slice(0,10)+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:buffer.length,count:trips.length,tripIds:trips.map(trip=>trip.id)};
  }
  if(name==='update_document_paper'){
    const row=docRow(args.document_id);if(!row)return {updated:false,error:'Document not found'};
    if(args.paper_available===undefined&&args.paper_note===undefined)throw Object.assign(new Error('Provide paper_available or paper_note'),{status:400});
    const input={};if(args.paper_available!==undefined)input.paperAvailable=args.paper_available;if(args.paper_note!==undefined)input.paperNote=args.paper_note;
    const paper=readPaperInput(input),available=paper.paperAvailable===undefined?row.paper_available:paper.paperAvailable?1:0,note=paper.paperNote===undefined?row.paper_note:paper.paperNote;
    if(available!==row.paper_available||note!==row.paper_note)db.prepare('UPDATE documents SET paper_available=?,paper_note=?,paper_updated_at=? WHERE id=?').run(available,note,now(),row.id);
    return {updated:true,document:docOut(docRow(row.id))};
  }
  if (name === "get_system_overview") return { ...systemOverview(), transFreightCapture: transFreightStatus(), transFreightDetailCapture: transFreightDetailStatus(), transActiveCapture: transActiveStatus(), transOrderCapture: transOrderStatus(), fakturowniaConfigured: fakturowniaConfigured() };
  if (name === "get_trans_order_status") return transOrderStatus();
  if (name === "search_trans_orders") { const orders = queryTransOrders(args); return { orders, count: orders.length, ...transOrderStatus() }; }
  if (name === "get_reconciliation") return await buildReconciliation(args);
  if (name === "get_trans_freight_status") return transFreightStatus();
  if (name === "search_trans_freights") { const freights = queryTransFreights(args); return { freights, count: freights.length, ...transFreightStatus() }; }
  if (name === "get_fakturownia_status") {
    const baseUrl = FAKTUROWNIA_BASE_URL || null;
    if (!fakturowniaConfigured()) return { configured: false, reachable: false, baseUrl, missing: [!FAKTUROWNIA_BASE_URL ? "FAKTUROWNIA_BASE_URL" : null, !FAKTUROWNIA_API_TOKEN ? "FAKTUROWNIA_API_TOKEN" : null].filter(Boolean) };
    const data = await fakturowniaJson("/invoices.json", { page: 1, per_page: 1 });
    return { configured: true, reachable: true, baseUrl, sampleCount: Array.isArray(data) ? data.length : 0 };
  }
  if (name === "search_fakturownia_invoices") return await searchFakturowniaInvoices(args);
  if (name === "list_fakturownia_invoices") {
    const params = fakturowniaListParams(args);
    const data = await fakturowniaJson("/invoices.json", params);
    const rows = Array.isArray(data) ? data : [];
    return { invoices: rows.map(fakturowniaInvoiceSummary), count: rows.length, page: params.page, perPage: params.per_page };
  }
  if (name === "get_fakturownia_invoice") {
    const id = String(args.invoice_id || "").trim();
    if (!/^\d+$/.test(id)) throw new Error("invoice_id must be numeric");
    const invoice = await fakturowniaJson("/invoices/" + encodeURIComponent(id) + ".json");
    return { found: true, invoice };
  }
  if (name === "get_fakturownia_invoice_pdf") {
    const id = String(args.invoice_id || "").trim();
    if (!/^\d+$/.test(id)) throw new Error("invoice_id must be numeric");
    const invoice = await fakturowniaJson("/invoices/" + encodeURIComponent(id) + ".json");
    const link = tempFakturowniaPdfUrl(req, id);
    return { found: true, invoice: fakturowniaInvoiceSummary(invoice), ...link };
  }
  if (name === "list_fakturownia_clients") {
    const page = Math.max(1, Number(args.page || 1));
    const perPage = Math.max(1, Math.min(100, Number(args.per_page || 25)));
    const data = await fakturowniaJson("/clients.json", { page, per_page: perPage });
    const rows = Array.isArray(data) ? data : [];
    return { clients: rows.map(fakturowniaClientSummary), count: rows.length, page, perPage };
  }
  if (name === "get_fakturownia_client") {
    const id = String(args.client_id || "").trim();
    if (!/^\d+$/.test(id)) throw new Error("client_id must be numeric");
    const client = await fakturowniaJson("/clients/" + encodeURIComponent(id) + ".json");
    return { found: true, client };
  }
  if (name === "search") {
    const special = String(args.query || "").trim();
    if (special.startsWith("invoice-reconciliation")) {
      const parts = special.split(":");
      const dateFrom = parts[1] || "2026-08-11";
      const dateTo = parts[2] || new Date().toISOString().slice(0,10);
      return await buildReconciliation({ date_from: dateFrom, date_to: dateTo });
    }
    const tripResults = queryTrips({ query: args.query }).map(t => ({ id: t.id, type: "trip", title: t.internalTripId + (t.trip ? " · " + t.trip : ""), url: null, ...t }));
    const freightDetailResults = queryTransFreightDetails({ query: args.query, max_age_minutes: 180, limit: 100 }).map(f => ({ id: f.id, type: "trans_freight_detail", title: (f.loadText || "?") + " → " + (f.unloadText || "?"), ...f }));
    const freightResults = queryTransFreights({ query: args.query, max_age_minutes: 180, limit: 100 }).map(f => ({ id: f.id, type: "trans_freight", title: (f.loadText || "?") + " → " + (f.unloadText || "?"), ...f }));
    const activeTransportResults = queryTransActive({ query: args.query, max_age_minutes: 180, limit: 100 }).map(t => ({ id: t.id, type: "trans_active_transport", title: (t.startText || "?") + " → " + (t.endText || "?"), ...t }));
    const orderResults = queryTransOrders({ query: args.query, limit: 100 }).map(o => ({ id: o.id, type: "trans_order", title: o.orderNumber || "Trans.eu Auftrag", ...o }));
    return { results: [...tripResults, ...freightDetailResults, ...freightResults, ...activeTransportResults, ...orderResults], tripResults, freightDetailResults, freightResults, activeTransportResults, orderResults, transFreightCapture: transFreightStatus(), transFreightDetailCapture: transFreightDetailStatus(), transActiveCapture: transActiveStatus(), transOrderCapture: transOrderStatus() };
  }
  if (name === "list_trips") return { trips: queryTrips(args), count: queryTrips(args).length };
  if (name === "get_trip") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { found: false };
    return { found: true, trip: { ...t, readiness: readiness(t), missing: missingForTrip(t), documents: listDocsForTrip(t.id), statusHistory:statusHistory(t.id) } };
  }
  if (name === "list_documents") {
    let rows;
    if (args.trip_id_or_number) {
      const t = getTripByAny(args.trip_id_or_number);
      if (!t) return { documents: [], count: 0 };
      rows = db.prepare("SELECT * FROM documents WHERE trip_id = ? ORDER BY created_at DESC").all(t.id);
    } else {
      rows = db.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT 500").all();
    }
    if (args.type) rows = rows.filter(r => r.doc_type === args.type);
    return { documents: rows.map(docOut), count: rows.length };
  }
  if (name === "get_document") {
    const row = docRow(args.document_id);
    if (!row) return { found: false };
    const t = tripOut(db.prepare("SELECT * FROM trips WHERE id = ?").get(row.trip_id));
    return { found: true, document: docOut(row), trip: t, downloadUrl: connectorFileUrl(req, row.id) };
  }
  if (name === "list_companies") return { companies: listCompanies(), count: listCompanies().length };
  if (name === "create_company") {
    if(args.payment_term_days!==undefined)normalizePaymentTermDays(args.payment_term_days);
    const company = ensureCompany(args.name, args.note || "", args.active);
    if (!company) throw new Error("name is required");
    if ([args.billing_channel,args.invoice_email,args.invoice_subject,args.postal_address,args.required_documents,args.submission_deadline,args.special_rules,args.rules_source,args.payment_term_days].some(v => v !== undefined)) {
      updateCompany(company.id, {
        billingChannel: args.billing_channel,
        invoiceEmail: args.invoice_email,
        invoiceSubject: args.invoice_subject,
        postalAddress: args.postal_address,
        requiredDocuments: args.required_documents,
        submissionDeadline: args.submission_deadline,
        specialRules: args.special_rules,
        rulesSource: args.rules_source,
        paymentTermDays: args.payment_term_days
      });
    }
    return { created: true, company: listCompanies().find(c => c.id === company.id) || company };
  }
  if (name === "update_company") {
    const company = updateCompany(args.company_id, {
      name: args.name,
      active: args.active,
      note: args.note,
      billingChannel: args.billing_channel,
      invoiceEmail: args.invoice_email,
      invoiceSubject: args.invoice_subject,
      postalAddress: args.postal_address,
      requiredDocuments: args.required_documents,
      submissionDeadline: args.submission_deadline,
      specialRules: args.special_rules,
      rulesSource: args.rules_source,
      paymentTermDays: args.payment_term_days
    });
    if (!company) return { updated: false, error: "Company not found" };
    return { updated: true, company };
  }
  if (name === "list_vehicles") return { vehicles: listVehicles(), count: listVehicles().length };
  if (name === "create_vehicle") {
    const vehicle = ensureVehicle(args.plate, args.note || "");
    if (!vehicle) throw new Error("plate is required");
    return { created: true, vehicle };
  }
  if(name==='update_vehicle'){
    const old=db.prepare('SELECT * FROM vehicles WHERE id=?').get(args.vehicle_id);
    if(!old)return {updated:false,error:'Vehicle not found'};
    const plate=args.plate===undefined?old.plate:normalizePlate(args.plate),note=args.note===undefined?old.note:String(args.note).trim();
    if(!plate||plate.length>100||/[\u0000-\u001f\u007f]/.test(plate)||note.length>4000)throw Object.assign(new Error('Invalid vehicle plate or note'),{status:400});
    if(db.prepare('SELECT id FROM vehicles WHERE UPPER(plate)=UPPER(?) AND id<>?').get(plate,old.id))throw Object.assign(new Error('Vehicle plate already exists'),{status:400});
    db.exec('BEGIN');
    try{
      db.prepare('UPDATE vehicles SET plate=?,note=?,updated_at=? WHERE id=?').run(plate,note,now(),old.id);
      if(plate!==old.plate)for(const row of db.prepare('SELECT id,vehicle_plates FROM trips').all()){
        const plates=platesToArray(row.vehicle_plates);
        if(plates.includes(normalizePlate(old.plate)))db.prepare('UPDATE trips SET vehicle_plates=?,updated_at=? WHERE id=?').run([...new Set(plates.map(value=>value===normalizePlate(old.plate)?plate:value))].join('\n'),now(),row.id);
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return {updated:true,vehicle:vehicleOut(db.prepare('SELECT * FROM vehicles WHERE id=?').get(old.id))};
  }
  if (name === "assign_vehicle_to_trip") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { assigned: false, error: "Trip not found" };
    const p = normalizePlate(args.vehicle_plate);
    if (!p) throw new Error("vehicle_plate is required");
    const trip = appendVehicleToTrip(t.id, p);
    return { assigned: true, vehicle: ensureVehicle(p), trip };
  }
  if (name === "create_trip") {
    if (!args.date || !args.customer) throw new Error("date and customer are required");
    const payment=tripPaymentInput({}, {customer:args.customer,documentsReceivedDate:args.documents_received_date,paymentTermDays:args.payment_term_days,statusOverride:args.status_override,rechnungUrl:args.rechnung_url,...dispatchFromMcp(args)});
    const company = ensureCompany(args.customer);
    const id = crypto.randomUUID();
    const ts = now();
    const internalTripId = nextInternalTripId(args.date);
    const cmrLoaded = args.cmr_loaded ?? args.cmr ?? false;
    const cmrUnloaded = args.cmr_unloaded ?? args.pod ?? false;
    saveTrackedTrip(id,{},payment,'mcp',()=>{db.prepare(`INSERT INTO trips (id,internal_trip_id,date,trip_number,customer,auftrag,cmr,pod,cmr_loaded,cmr_unloaded,loaded_at,unloaded_at,loading_place,unloading_place,vehicle_plates,price_cents,rechnung_code,status_override,documents_received_date,payment_term_days,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        internalTripId,
        args.date,
        args.trip_number || "",
        company.name,
        bool(args.auftrag),
        bool(cmrLoaded),
        bool(cmrUnloaded),
        bool(cmrLoaded),
        bool(cmrUnloaded),
        args.loaded_at || "",
        args.unloaded_at || "",
        String(args.loading_place || "").trim(),
        String(args.unloading_place || "").trim(),
        platesToText(args.vehicle_plates || []),
        priceEurToCents(args.price_eur),
        args.rechnung_number || "",
        payment.statusOverride,
        payment.documentsReceivedDate,
        payment.paymentTermDays,
        ts,
        ts
      );});
    const t = getTripByAny(id);
    return { created: true, trip: { ...t, readiness: readiness(t), missing: missingForTrip(t) } };
  }
  if (name === "update_trip") {
    const old = getTripByAny(args.trip_id_or_number);
    if (!old) return { updated: false, error: "Trip not found" };
    const internalTripId=args.internal_trip_id===undefined?old.internalTripId:normalizeTripInternalId(args.internal_trip_id);
    if(db.prepare('SELECT id FROM trips WHERE internal_trip_id=? AND id<>? LIMIT 1').get(internalTripId,old.id))throw Object.assign(new Error('Tsubera Tour-ID already exists'),{status:400});
    const next = {
      date: args.date ?? old.date,
      trip: args.trip_number ?? old.trip,
      customer: args.customer ?? old.customer,
      auftrag: args.auftrag ?? old.auftrag,
      cmrLoaded: args.cmr_loaded ?? args.cmr ?? old.cmrLoaded,
      cmrUnloaded: args.cmr_unloaded ?? args.pod ?? old.cmrUnloaded,
      loadedAt: args.loaded_at ?? old.loadedAt,
      unloadedAt: args.unloaded_at ?? old.unloadedAt,
      loadingPlace: args.loading_place ?? old.loadingPlace,
      unloadingPlace: args.unloading_place ?? old.unloadingPlace,
      vehiclePlates: args.vehicle_plates ?? old.vehiclePlates,
      priceEur: args.price_eur === undefined ? old.priceEur : args.price_eur,
      rechnungCode: args.rechnung_number ?? old.rechnungCode,
      ...tripPaymentInput(old,{customer:args.customer,documentsReceivedDate:args.documents_received_date,paymentTermDays:args.payment_term_days,statusOverride:args.status_override,rechnungUrl:args.rechnung_url,...dispatchFromMcp(args)})
    };
    next.customer = ensureCompany(next.customer)?.name || next.customer;
    saveTrackedTrip(old.id,old,next,'mcp',()=>{db.prepare('UPDATE trips SET internal_trip_id=? WHERE id=?').run(internalTripId,old.id);db.prepare("UPDATE trips SET date=?,trip_number=?,customer=?,auftrag=?,cmr=?,pod=?,cmr_loaded=?,cmr_unloaded=?,loaded_at=?,unloaded_at=?,loading_place=?,unloading_place=?,vehicle_plates=?,price_cents=?,rechnung_code=?,status_override=?,documents_received_date=?,payment_term_days=?,updated_at=? WHERE id=?")
      .run(next.date,next.trip,next.customer,bool(next.auftrag),bool(next.cmrLoaded),bool(next.cmrUnloaded),bool(next.cmrLoaded),bool(next.cmrUnloaded),next.loadedAt,next.unloadedAt,String(next.loadingPlace||"").trim(),String(next.unloadingPlace||"").trim(),platesToText(next.vehiclePlates),priceEurToCents(next.priceEur),next.rechnungCode,next.statusOverride,next.documentsReceivedDate,next.paymentTermDays,now(),old.id);});
    const t = getTripByAny(old.id);
    return { updated: true, trip: { ...t, readiness: readiness(t), missing: missingForTrip(t) } };
  }
  if (name === "upload_document") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { uploaded: false, error: "Trip not found" };
    if (!args.filename || !args.document_type || !args.content_base64) throw new Error("filename, document_type and content_base64 are required");
    let buf;
    if (String(args.content_base64).startsWith("url:")) {
      const downloaded = await downloadUrlToBuffer(String(args.content_base64).slice(4), 10 * 1024 * 1024);
      buf = downloaded.buffer;
    } else {
      try { buf = Buffer.from(args.content_base64, "base64"); } catch { throw new Error("Invalid base64 content"); }
    }
    if (!buf.length) throw new Error("Uploaded file is empty");
    if (buf.length > 10 * 1024 * 1024) throw new Error("File exceeds 10 MB MCP upload limit");
    return storeTripDocument(t, {
      documentType: args.document_type,
      filename: args.filename,
      mimeType: args.mime_type || "application/octet-stream",
      buffer: buf,
      vehiclePlate: args.vehicle_plate,
      paperAvailable:args.paper_available??false,paperNote:args.paper_note??''
    });
  }
  if (name === "upload_document_from_url") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { uploaded: false, error: "Trip not found" };
    if (!args.filename || !args.document_type || !args.source_url) throw new Error("filename, document_type and source_url are required");
    const downloaded = await downloadUrlToBuffer(args.source_url, 20 * 1024 * 1024);
    return storeTripDocument(t, {
      documentType: args.document_type,
      filename: args.filename,
      mimeType: args.mime_type || downloaded.mime || "application/octet-stream",
      buffer: downloaded.buffer,
      vehiclePlate: args.vehicle_plate,
      paperAvailable:args.paper_available??false,paperNote:args.paper_note??''
    });
  }
  if (name === "create_document_upload_url") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { ready: false, error: "Trip not found" };
    if (!args.filename || !args.document_type) throw new Error("filename and document_type are required");
    const allowed = new Set(["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"]);
    if (!allowed.has(args.document_type)) throw new Error("Unsupported document_type");
    const signed = createDirectUploadUrl(req, args, 900);
    return {
      ready: true,
      method: "POST",
      uploadUrl: signed.uploadUrl,
      expiresAt: signed.expiresAt,
      maxBytes: 50 * 1024 * 1024,
      contentType: args.mime_type || "application/octet-stream",
      trip: { ...t, readiness: readiness(t), missing: missingForTrip(t) }
    };
  }
  if (name === "update_document_type") {
    const row = docRow(args.document_id);
    if (!row) return { updated: false, error: "Document not found" };
    if(!['auftrag','cmr_loading','cmr_unloading','cmr','pod','rechnung','other'].includes(args.document_type))throw Object.assign(new Error('Unsupported document_type'),{status:400});
    db.prepare("UPDATE documents SET doc_type=? WHERE id=?").run(args.document_type,row.id);
    const flagMap = { auftrag: "auftrag", cmr_loading: "cmr_loaded", cmr_unloading: "cmr_unloaded", cmr: "cmr_loaded", pod: "cmr_unloaded" };
    const flag = flagMap[args.document_type];
    if (flag === "cmr_loaded") db.prepare("UPDATE trips SET cmr_loaded=1, cmr=1, updated_at=? WHERE id=?").run(now(), row.trip_id);
    else if (flag === "cmr_unloaded") db.prepare("UPDATE trips SET cmr_unloaded=1, pod=1, updated_at=? WHERE id=?").run(now(), row.trip_id);
    else if (flag === "auftrag") db.prepare("UPDATE trips SET auftrag=1, updated_at=? WHERE id=?").run(now(), row.trip_id);
    return { updated: true, document: docOut(docRow(row.id)), trip: getTripByAny(row.trip_id) };
  }
  if (name === "fetch") {
    const t = getTripByAny(args.id);
    if (t) return { id: t.id, type: "trip", data: { ...t, readiness: readiness(t), missing: missingForTrip(t), documents: listDocsForTrip(t.id), statusHistory:statusHistory(t.id) } };
    const row = docRow(args.id);
    if (row) return { id: row.id, type: "document", data: docOut(row), downloadUrl: connectorFileUrl(req, row.id) };
    return { id: args.id, found: false };
  }
  throw new Error("Unknown tool: " + name);
}

async function handleMcp(req, res, token) {
  if (!mcpAuthorized(token)) return json(res, 404, { error: "Not found" });
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type,mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST") return json(res, 405, { error: "POST required" });
  const msg = await readJson(req, 16 * 1024 * 1024);
  if (!msg.id && msg.method?.startsWith("notifications/")) return res.writeHead(202).end();
  const base = { jsonrpc: "2.0", id: msg.id ?? null };
  try {
    if (msg.method === "initialize") {
      const requested = msg.params?.protocolVersion || "2025-06-18";
      return json(res, 200, { ...base, result: {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: "tsubera-transport-documents", version: "2.0.0" },
        instructions: "Tsubera live transport tracker. Read get_capabilities for current schemas. Read/search trips, companies, vehicles, document metadata, dates, status history and invoice dispatch details; update them only as requested. Dispatch fields record how an invoice was sent; tools do not send email or paper post. Never invent historical dates. Receipt rollback clears its date/countdown but preserves configured payment days. Mark paper possession only on explicit user confirmation; a copy does not prove originals or mailing. For a file already in ChatGPT/local working files, prefer create_document_upload_url and POST raw bytes to its scoped expiring URL. get_document returns a scoped expiring download. export_trips_excel preserves requested IDs/order or supplied filters. Normal web APIs remain authenticated. Fakturownia is optional read-only and API credentials never appear in results."
      }});
    }
    if (msg.method === "ping") return json(res, 200, { ...base, result: {} });
    if (msg.method === "tools/list") return json(res, 200, { ...base, result: { tools: toolDefs } });
    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      const data = await callTool(name, args, req);
      const content = [{ type: "text", text: JSON.stringify(data) }];
      const linkedDocument = name==='export_trips_excel'&&data?.downloadUrl ? {
        downloadUrl:data.downloadUrl,document:{name:data.filename,mime:data.mimeType,size:data.size}
      } : (
        name === "get_document" && data?.found && data?.document?.id
      ) ? data : (
        name === "fetch" && data?.type === "document" && data?.downloadUrl
      ) ? data : (
        name === "get_fakturownia_invoice_pdf" && data?.found && data?.downloadUrl
      ) ? {
        downloadUrl: data.downloadUrl,
        document: {
          name: (data.invoice?.number || ("invoice-" + (args.invoice_id || "document"))) + ".pdf",
          mime: "application/pdf"
        }
      } : null;
      if (linkedDocument?.downloadUrl) {
        const d = linkedDocument.document || linkedDocument.data || {};
        content.push({
          type: "resource_link",
          name: d.name || "Tsubera document",
          uri: linkedDocument.downloadUrl,
          mimeType: d.mime || "application/octet-stream",
          size: d.size || undefined
        });
      }
      return json(res, 200, { ...base, result: {
        content,
        structuredContent: data,
        isError: false
      }});
    }
    return json(res, 200, { ...base, error: { code: -32601, message: "Method not found" } });
  } catch (e) {
    return json(res, 200, { ...base, error: { code: -32000, message: e.message || "Internal error" } });
  }
}

const mimeMap = {
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".pdf":"application/pdf"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = decodeURIComponent(url.pathname);

    const scopedConnectorResource=validConnectorResource(req,url,p);
    if (await onlineAuth.handle(req, res, p,{scopedConnectorResource})) return;
    if (p === "/login" && req.method === "GET") {
      const body = fs.readFileSync(path.join(__dirname, "login.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length });
      return res.end(body);
    }

    if (p.startsWith("/mcp/")) {
      const token = p.slice("/mcp/".length);
      return await handleMcp(req, res, token);
    }
    if(p.startsWith('/connector-export/')&&req.method==='GET'){
      if(!scopedConnectorResource)return json(res,403,{error:'Expired or invalid export link'});
      const id=p.slice('/connector-export/'.length),entry=connectorExports.get(id);
      if(!entry||entry.exp!==Number(url.searchParams.get('exp'))||entry.exp*1000<Date.now()){connectorExports.delete(id);return json(res,404,{error:'Export expired; create a new export'});}
      res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-length':entry.buffer.length,'content-disposition':'attachment; filename="Tsubera-trips.xlsx"','cache-control':'private, no-store'});
      return res.end(entry.buffer);
    }

    if (p.startsWith("/fakturownia/invoices/") && p.endsWith(".pdf") && req.method === "GET") {
      const rawId = p.slice("/fakturownia/invoices/".length, -4);
      const id = decodeURIComponent(rawId);
      const exp = Number(url.searchParams.get("exp"));
      const sig = url.searchParams.get("sig") || "";
      if (!/^\d+$/.test(id) || !exp || exp < Math.floor(Date.now()/1000) || !(url.searchParams.get('access')==='mcp'?scopedConnectorResource:safeHexEqual(sig, fakturowniaPdfSig(id, exp)))) {
        return json(res, 403, { error: "Expired or invalid link" });
      }
      const upstream = await fakturowniaFetch("/invoices/" + encodeURIComponent(id) + ".pdf", {}, { accept: "application/pdf" });
      const contentLength = Number(upstream.headers.get("content-length") || 0);
      if (contentLength > 25 * 1024 * 1024) return json(res, 413, { error: "Invoice PDF is too large" });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (buffer.length > 25 * 1024 * 1024) return json(res, 413, { error: "Invoice PDF is too large" });
      res.writeHead(200, {
        "content-type": upstream.headers.get("content-type") || "application/pdf",
        "content-length": buffer.length,
        "cache-control": "private, no-store",
        "content-disposition": "inline; filename*=UTF-8''" + encodeURIComponent("fakturownia-" + id + ".pdf")
      });
      return res.end(buffer);
    }

    if (p.startsWith("/file/") && req.method === "GET") {
      const id = p.slice("/file/".length);
      const exp = Number(url.searchParams.get("exp"));
      const sig = url.searchParams.get("sig") || "";
      if (!exp || exp < Math.floor(Date.now()/1000) || !(url.searchParams.get('access')==='mcp'?scopedConnectorResource:safeHexEqual(sig, fileSig(id, exp)))) {
        return text(res, 403, "Expired or invalid link");
      }
      const row = docRow(id);
      if (!row) return text(res, 404, "Not found");
      const fp = path.join(DOCS_DIR, row.stored_name);
      if (!fs.existsSync(fp)) return text(res, 404, "File missing");
      const inlineTypes=new Set(['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain']);
      const forceDownload=url.searchParams.get('download')==='1'||!inlineTypes.has(String(row.mime||'').split(';')[0].trim().toLowerCase());
      res.writeHead(200, {
        "content-type": row.mime || "application/octet-stream",
        "content-length": row.size,
        "content-disposition": (forceDownload ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(row.original_name)
      });
      return fs.createReadStream(fp).pipe(res);
    }

    if (p === "/direct-upload" && req.method === "POST") {
      const exp = Number(url.searchParams.get("exp"));
      const ticket = url.searchParams.get("ticket") || "";
      const sig = url.searchParams.get("sig") || "";
      const current = Math.floor(Date.now() / 1000);
      if (!exp || exp < current || exp>current+900 || !ticket || !safeHexEqual(sig, uploadTicketSig(ticket, exp))) {
        return json(res, 403, { error: "Expired or invalid upload link" });
      }
      let meta;
      try {
        meta = JSON.parse(Buffer.from(ticket, "base64url").toString("utf8"));
      } catch {
        return json(res, 400, { error: "Invalid upload ticket" });
      }
      const allowed = new Set(["auftrag","cmr_loading","cmr_unloading","cmr","pod","rechnung","other"]);
      if (!meta.trip || !meta.filename || !allowed.has(meta.documentType)) {
        return json(res, 400, { error: "Invalid upload metadata" });
      }
      const t = getTripByAny(meta.trip);
      if (!t) return json(res, 404, { error: "Trip not found" });
      const chunks = [];
      let total = 0;
      const maxBytes = 50 * 1024 * 1024;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > maxBytes) return json(res, 413, { error: "File max 50 MB" });
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) return json(res, 400, { error: "Uploaded file is empty" });
      const result = storeTripDocument(t, {
        documentType: meta.documentType,
        filename: meta.filename,
        mimeType: meta.mimeType || req.headers["content-type"] || "application/octet-stream",
        buffer,
        vehiclePlate: meta.vehiclePlate || "",
        paperAvailable:meta.paperAvailable??false,paperNote:meta.paperNote??''
      });
      return json(res, 201, result);
    }

    if (p.startsWith("/api/trans/")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "content-type,x-app-password,authorization,x-tsubera-capture-token");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      if (req.method === "OPTIONS") return res.writeHead(204).end();
    }

    if (p === "/api/trans/freights/import" && req.method === "POST") {
      if (!transCaptureAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
      const body = await readJson(req, 4 * 1024 * 1024);
      return json(res, 200, importTransFreights(body));
    }
    if (p === "/api/trans/freights/detail/import" && req.method === "POST") {
      if (!transCaptureAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
      const body = await readJson(req, 4 * 1024 * 1024);
      return json(res, 200, importTransFreightDetail(body));
    }
    if (p === "/api/trans/active/import" && req.method === "POST") {
      if (!transCaptureAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
      const body = await readJson(req, 4 * 1024 * 1024);
      return json(res, 200, importTransActive(body));
    }
    if (p === "/api/trans/orders/import" && req.method === "POST") {
      if (!transCaptureAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
      const body = await readJson(req, 4 * 1024 * 1024);
      return json(res, 200, importTransOrders(body));
    }
    if (p.startsWith("/api/")) {
      if (!apiAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

      if (p === "/api/overview" && req.method === "GET") return json(res, 200, systemOverview());
      if (p === "/api/trans/status" && req.method === "GET") return json(res, 200, transFreightStatus());
      if (p === "/api/trans/freights" && req.method === "GET") {
        const args = {
          query: url.searchParams.get("q") || undefined,
          from: url.searchParams.get("from") || undefined,
          to: url.searchParams.get("to") || undefined,
          currency: url.searchParams.get("currency") || undefined,
          min_price: url.searchParams.get("min_price") || undefined,
          min_rating: url.searchParams.get("min_rating") || undefined,
          max_distance_km: url.searchParams.get("max_distance_km") || undefined,
          max_age_minutes: url.searchParams.get("max_age_minutes") || undefined,
          limit: url.searchParams.get("limit") || undefined
        };
        const freights = queryTransFreights(args);
        return json(res, 200, { freights, count: freights.length, ...transFreightStatus() });
      }
      if (p === "/api/trans/freights/details" && req.method === "GET") {
        const args = {
          query: url.searchParams.get("q") || undefined,
          max_age_minutes: url.searchParams.get("max_age_minutes") || undefined,
          limit: url.searchParams.get("limit") || undefined
        };
        const details = queryTransFreightDetails(args);
        return json(res, 200, { details, count: details.length, ...transFreightDetailStatus() });
      }
      if (p === "/api/trans/active/status" && req.method === "GET") return json(res, 200, transActiveStatus());
      if (p === "/api/trans/active" && req.method === "GET") {
        const args = {
          query: url.searchParams.get("q") || undefined,
          vehicle: url.searchParams.get("vehicle") || undefined,
          max_age_minutes: url.searchParams.get("max_age_minutes") || undefined,
          limit: url.searchParams.get("limit") || undefined
        };
        const transports = queryTransActive(args);
        return json(res, 200, { transports, count: transports.length, ...transActiveStatus() });
      }
      if (p === "/api/trans/orders/status" && req.method === "GET") return json(res, 200, transOrderStatus());
      if (p === "/api/trans/orders" && req.method === "GET") {
        const args = {
          query: url.searchParams.get("q") || undefined,
          date_from: url.searchParams.get("date_from") || undefined,
          date_to: url.searchParams.get("date_to") || undefined,
          vehicle: url.searchParams.get("vehicle") || undefined,
          view_mode: url.searchParams.get("view_mode") || undefined,
          limit: url.searchParams.get("limit") || undefined
        };
        const orders = queryTransOrders(args);
        return json(res, 200, { orders, count: orders.length, ...transOrderStatus() });
      }
      if (p === "/api/reconciliation" && req.method === "GET") {
        const data = await buildReconciliation({
          date_from: url.searchParams.get("date_from") || undefined,
          date_to: url.searchParams.get("date_to") || undefined
        });
        return json(res, 200, data);
      }

      if (p === "/api/companies" && req.method === "GET") return json(res, 200, { companies: listCompanies() });
      if (p === "/api/companies" && req.method === "POST") {
        const b = await readJson(req);
        if(b.paymentTermDays!==undefined)normalizePaymentTermDays(b.paymentTermDays);
        const company = ensureCompany(b.name, b.note || "", b.active);
        if (!company) return json(res, 400, { error: "name is required" });
        const rules={};
        for(const field of ['billingChannel','invoiceEmail','invoiceSubject','postalAddress','requiredDocuments','submissionDeadline','specialRules','rulesSource','paymentTermDays'])if(b[field]!==undefined)rules[field]=b[field];
        if(Object.keys(rules).length)updateCompany(company.id,rules);
        return json(res, 201, { company: listCompanies().find(c => c.id === company.id) || company });
      }
      const companyMatch = p.match(/^\/api\/companies\/([^/]+)$/);
      if (companyMatch && req.method === "PATCH") {
        const b = await readJson(req);
        const company = updateCompany(companyMatch[1], b);
        if (!company) return json(res, 404, { error: "Company not found" });
        return json(res, 200, { company });
      }

      if (p === "/api/vehicles" && req.method === "GET") return json(res, 200, { vehicles: listVehicles() });
      if (p === "/api/vehicles" && req.method === "POST") {
        const b = await readJson(req);
        const vehicle = ensureVehicle(b.plate, b.note || "");
        if (!vehicle) return json(res, 400, { error: "plate is required" });
        return json(res, 201, { vehicle });
      }
      const vehicleMatch = p.match(/^\/api\/vehicles\/([^/]+)$/);
      if (vehicleMatch && req.method === "DELETE") {
        const row = db.prepare("SELECT * FROM vehicles WHERE id=?").get(vehicleMatch[1]);
        if (!row) return json(res, 404, { error: "Vehicle not found" });
        db.prepare("DELETE FROM vehicles WHERE id=?").run(row.id);
        return json(res, 200, { ok: true, historyPreserved: true });
      }


      if (p === "/api/trips/export.xlsx" && req.method === "POST") {
        const body=await readJson(req,64*1024);
        const ids=body.tripIds;
        if(!Array.isArray(ids)||ids.length<1||ids.length>500||ids.some(id=>typeof id!=='string'||id.length>120)||new Set(ids).size!==ids.length){
          return json(res,400,{error:'Передай от 1 до 500 уникальных рейсов из таблицы'});
        }
        const lookup=db.prepare("SELECT * FROM trips WHERE id=?");
        const trips=ids.map(id=>tripOut(lookup.get(id)));
        if(trips.some(x=>!x))return json(res,404,{error:'Некоторые рейсы больше не существуют. Обнови таблицу'});
        const xlsx=await generateTripsExcel(trips);
        const filename='tsubera-rechnungen-'+new Date().toISOString().slice(0,10)+'.xlsx';
        res.writeHead(200,{
          'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition':'attachment; filename="'+filename+'"',
          'cache-control':'private, no-store',
          'content-length':xlsx.length,
          'x-content-type-options':'nosniff'
        });
        return res.end(xlsx);
      }

      if (p === "/api/trips" && req.method === "GET") {
        const args = {
          query: url.searchParams.get("q") || undefined,
          date_from: url.searchParams.get("date_from") || undefined,
          date_to: url.searchParams.get("date_to") || undefined,
          customer: url.searchParams.get("customer") || undefined,
          vehicle: url.searchParams.get("vehicle") || undefined,
          readiness: url.searchParams.get("readiness") || undefined
        };
        return json(res, 200, { trips: queryTrips(args) });
      }

      if (p === "/api/trips" && req.method === "POST") {
        const b = await readJson(req);
        if (!b.date || !b.customer) return json(res, 400, { error: "date and customer are required" });
        const payment=tripPaymentInput({},b);
        const company = ensureCompany(b.customer);
        const id = crypto.randomUUID();
        const ts = now();
        const internalTripId = nextInternalTripId(b.date);
        const cmrLoaded = b.cmrLoaded ?? b.cmr ?? false;
        const cmrUnloaded = b.cmrUnloaded ?? b.pod ?? false;
        saveTrackedTrip(id,{},payment,'site',()=>{db.prepare(`INSERT INTO trips (id,internal_trip_id,date,trip_number,customer,auftrag,cmr,pod,cmr_loaded,cmr_unloaded,loaded_at,unloaded_at,loading_place,unloading_place,vehicle_plates,price_cents,rechnung_code,status_override,documents_received_date,payment_term_days,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, internalTripId, b.date, b.trip || "", company.name, bool(b.auftrag), bool(cmrLoaded), bool(cmrUnloaded), bool(cmrLoaded), bool(cmrUnloaded), b.loadedAt || "", b.unloadedAt || "", String(b.loadingPlace || "").trim(), String(b.unloadingPlace || "").trim(), platesToText(b.vehiclePlates || []), priceEurToCents(b.priceEur), b.rechnungCode || "", payment.statusOverride,payment.documentsReceivedDate,payment.paymentTermDays,ts, ts);});
        return json(res, 201, { trip: getTripByAny(id) });
      }

      const tripMatch = p.match(/^\/api\/trips\/([^/]+)$/);
      if(tripMatch&&req.method==='GET'){
        const trip=getTripByAny(tripMatch[1]);if(!trip)return json(res,404,{error:'Trip not found'});
        return json(res,200,{trip:{...trip,readiness:readiness(trip),missing:missingForTrip(trip),documents:listDocsForTrip(trip.id),statusHistory:statusHistory(trip.id)}});
      }
      if (tripMatch && req.method === "PATCH") {
        const id = tripMatch[1], old = getTripByAny(id);
        if (!old) return json(res, 404, { error: "Trip not found" });
        const b = await readJson(req);
        const next = {
          internalTripId:b.internalTripId===undefined?old.internalTripId:normalizeTripInternalId(b.internalTripId),
          date:b.date===undefined?old.date:normalizeTripEditDate(b.date),
          trip:b.trip===undefined?old.trip:normalizeCustomerOrder(b.trip),
          customer:b.customer===undefined?old.customer:normalizeTripCustomer(b.customer),
          auftrag:b.auftrag??old.auftrag,
          cmrLoaded:b.cmrLoaded??b.cmr??old.cmrLoaded,
          cmrUnloaded:b.cmrUnloaded??b.pod??old.cmrUnloaded,
          loadedAt:b.loadedAt??old.loadedAt,
          unloadedAt:b.unloadedAt??old.unloadedAt,
          loadingPlace:b.loadingPlace??old.loadingPlace,
          unloadingPlace:b.unloadingPlace??old.unloadingPlace,
          vehiclePlates:b.vehiclePlates??old.vehiclePlates,
          priceEur:b.priceEur===undefined?old.priceEur:b.priceEur,
          rechnungCode:b.rechnungCode??old.rechnungCode,
          rechnungUrl:b.rechnungUrl===undefined?old.rechnungUrl:normalizeFakturowniaUrl(b.rechnungUrl),
          ...tripPaymentInput(old,b)
        };
        if(next.internalTripId!==old.internalTripId){
          const clash=db.prepare("SELECT id FROM trips WHERE internal_trip_id=? AND id<>? LIMIT 1").get(next.internalTripId,id);
          if(clash)return json(res,409,{error:"Этот Tsubera Tour-ID уже используется другим рейсом"});
        }
        const priceCents=priceEurToCents(next.priceEur);
        next.customer=ensureCompany(next.customer)?.name||next.customer;
        saveTrackedTrip(id,old,next,'site',()=>{db.prepare("UPDATE trips SET internal_trip_id=?,date=?,trip_number=?,customer=?,auftrag=?,cmr=?,pod=?,cmr_loaded=?,cmr_unloaded=?,loaded_at=?,unloaded_at=?,loading_place=?,unloading_place=?,vehicle_plates=?,price_cents=?,rechnung_code=?,rechnung_url=?,status_override=?,documents_received_date=?,payment_term_days=?,updated_at=? WHERE id=?")
          .run(next.internalTripId,next.date,next.trip,next.customer,bool(next.auftrag),bool(next.cmrLoaded),bool(next.cmrUnloaded),bool(next.cmrLoaded),bool(next.cmrUnloaded),next.loadedAt,next.unloadedAt,String(next.loadingPlace||"").trim(),String(next.unloadingPlace||"").trim(),platesToText(next.vehiclePlates),priceCents,next.rechnungCode,next.rechnungUrl,next.statusOverride,next.documentsReceivedDate,next.paymentTermDays,now(),id);});
        return json(res,200,{trip:getTripByAny(id)});
      }
      if (tripMatch && req.method === "DELETE") {
        const id = tripMatch[1];
        const docs = db.prepare("SELECT * FROM documents WHERE trip_id = ?").all(id);
        for (const d of docs) { try { fs.unlinkSync(path.join(DOCS_DIR,d.stored_name)); } catch {} }
        db.prepare("DELETE FROM trips WHERE id = ?").run(id);
        return json(res, 200, { ok: true });
      }

      const docsMatch = p.match(/^\/api\/trips\/([^/]+)\/documents$/);
      if (docsMatch && req.method === "GET") {
        const t = getTripByAny(docsMatch[1]);
        if (!t) return json(res, 404, { error: "Trip not found" });
        return json(res, 200, { documents: listDocsForTrip(t.id), statusHistory:statusHistory(t.id) });
      }
      if (docsMatch && req.method === "POST") {
        const t = getTripByAny(docsMatch[1]);
        if (!t) return json(res, 404, { error: "Trip not found" });
        const b = await readJson(req, 30 * 1024 * 1024);
        const paper = readPaperInput(b);
        if (!b.name || !b.dataBase64 || !b.docType) return json(res, 400, { error: "name, docType, dataBase64 required" });
        let buf;
        if (String(b.dataBase64).startsWith("url:")) {
          const src = new URL(String(b.dataBase64).slice(4));
          if (src.protocol !== "https:" || !(src.hostname === "oaiusercontent.com" || src.hostname.endsWith(".oaiusercontent.com"))) {
            return json(res, 400, { error: "Only temporary oaiusercontent HTTPS URLs are allowed" });
          }
          const rr = await fetch(src, { redirect: "follow" });
          if (!rr.ok) return json(res, 400, { error: "Could not fetch temporary file URL: HTTP " + rr.status });
          buf = Buffer.from(await rr.arrayBuffer());
        } else {
          buf = Buffer.from(b.dataBase64, "base64");
        }
        if (buf.length > 20 * 1024 * 1024) return json(res, 413, { error: "File max 20 MB" });
        const id = crypto.randomUUID();
        const ext = path.extname(b.name).replace(/[^.a-zA-Z0-9]/g,"").slice(0,10);
        const stored = id + ext;
        fs.writeFileSync(path.join(DOCS_DIR, stored), buf);
        const createdAt = now();
        const paperAvailable = paper.paperAvailable === true;
        const paperNote = paper.paperNote || "";
        db.prepare("INSERT INTO documents (id,trip_id,doc_type,original_name,stored_name,mime,size,created_at,paper_available,paper_note,paper_updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .run(id,t.id,b.docType,b.name,stored,b.mime || "application/octet-stream",buf.length,createdAt,paperAvailable ? 1 : 0,paperNote,paperAvailable || paperNote ? createdAt : "");
        const flagMap = { auftrag: "auftrag", cmr_loading: "cmr_loaded", cmr_unloading: "cmr_unloaded", cmr: "cmr_loaded", pod: "cmr_unloaded" };
        const flag = flagMap[b.docType];
        if (flag === "cmr_loaded") db.prepare("UPDATE trips SET cmr_loaded=1, cmr=1, updated_at=? WHERE id=?").run(now(), t.id);
        else if (flag === "cmr_unloaded") db.prepare("UPDATE trips SET cmr_unloaded=1, pod=1, updated_at=? WHERE id=?").run(now(), t.id);
        else if (flag === "auftrag") db.prepare("UPDATE trips SET auftrag=1, updated_at=? WHERE id=?").run(now(), t.id);
        else if (b.docType === "rechnung") db.prepare("UPDATE trips SET rechnung_code=CASE WHEN TRIM(COALESCE(rechnung_code,''))='' THEN ? ELSE rechnung_code END, updated_at=? WHERE id=?").run(b.name, now(), t.id);
        if (b.vehiclePlate) appendVehicleToTrip(t.id, b.vehiclePlate);
        return json(res, 201, { document: docOut(docRow(id)), trip: getTripByAny(t.id) });
      }

      if(p==='/api/documents'&&req.method==='GET'){
        const documents=listDocumentsWithTrips();
        return json(res,200,{documents,count:documents.length});
      }
      const docLink = p.match(/^\/api\/documents\/([^/]+)\/link$/);
      if (docLink && req.method === "GET") {
        const row = docRow(docLink[1]);
        if (!row) return json(res, 404, { error: "Document not found" });
        return json(res, 200, { url: tempFileUrl(req, row.id, 900, url.searchParams.get("download") === "1") });
      }

      const docDel = p.match(/^\/api\/documents\/([^/]+)$/);
      if (docDel && req.method === "PATCH") {
        const row = docRow(docDel[1]);
        if (!row) return json(res, 404, { error: "Document not found" });
        if ((req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") {
          return json(res, 415, { error: "Content-Type must be application/json" });
        }
        let body;
        try { body = await readJson(req, 16 * 1024); }
        catch (error) { if (!error.status) error.status = 400; throw error; }
        const paper = readPaperInput(body, { requireAvailable: true, strict: true });
        const available = paper.paperAvailable ? 1 : 0;
        const note = paper.paperNote === undefined ? row.paper_note : paper.paperNote;
        if (available !== row.paper_available || note !== row.paper_note) {
          db.prepare("UPDATE documents SET paper_available=?,paper_note=?,paper_updated_at=? WHERE id=?")
            .run(available,note,now(),row.id);
        }
        return json(res, 200, { document: docOut(docRow(row.id)) });
      }
      if (docDel && req.method === "DELETE") {
        const row = docRow(docDel[1]);
        if (!row) return json(res, 404, { error: "Document not found" });
        try { fs.unlinkSync(path.join(DOCS_DIR,row.stored_name)); } catch {}
        db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: "API route not found" });
    }

    // The application source, runtime, dependencies and data are never public assets.
    if ((p === "/" || p === "/app.html") && (req.method === "GET" || req.method === "HEAD")) {
      const data = fs.readFileSync(path.join(__dirname, "app.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": data.length });
      return res.end(req.method === "HEAD" ? undefined : data);
    }
    return text(res, 404, "Not found");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message || "Internal server error" });
  }
});

server.listen(PORT, process.env.HOST || "0.0.0.0", () => console.log("Tsubera tracker listening on " + PORT));
