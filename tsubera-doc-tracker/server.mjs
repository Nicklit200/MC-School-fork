import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || "/data";
const DOCS_DIR = path.join(DATA_DIR, "documents");
const DB_PATH = path.join(DATA_DIR, "tsubera.sqlite");
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
const CONNECTOR_TOKEN = process.env.CONNECTOR_TOKEN || "";

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
  rechnung_code TEXT NOT NULL DEFAULT '',
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
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_documents_trip_id ON documents(trip_id);
`);

const tripColumns = new Set(db.prepare("PRAGMA table_info(trips)").all().map(r => r.name));
if (!tripColumns.has("internal_trip_id")) db.exec("ALTER TABLE trips ADD COLUMN internal_trip_id TEXT");
if (!tripColumns.has("cmr_loaded")) db.exec("ALTER TABLE trips ADD COLUMN cmr_loaded INTEGER NOT NULL DEFAULT 0");
if (!tripColumns.has("cmr_unloaded")) db.exec("ALTER TABLE trips ADD COLUMN cmr_unloaded INTEGER NOT NULL DEFAULT 0");
if (!tripColumns.has("loaded_at")) db.exec("ALTER TABLE trips ADD COLUMN loaded_at TEXT NOT NULL DEFAULT ''");
if (!tripColumns.has("unloaded_at")) db.exec("ALTER TABLE trips ADD COLUMN unloaded_at TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE trips SET cmr_loaded = 1 WHERE cmr = 1 AND cmr_loaded = 0");
db.exec("UPDATE trips SET cmr_unloaded = 1 WHERE pod = 1 AND cmr_unloaded = 0");
db.exec("UPDATE documents SET doc_type = 'cmr_loading' WHERE doc_type = 'cmr'");
db.exec("UPDATE documents SET doc_type = 'cmr_unloading' WHERE doc_type = 'pod'");

const now = () => new Date().toISOString();
const bool = v => v ? 1 : 0;

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

const tripOut = row => {
  if (!row) return null;
  const hasLoadingCmr = !!db.prepare("SELECT 1 FROM documents WHERE trip_id=? AND doc_type IN ('cmr_loading','cmr') LIMIT 1").get(row.id);
  const hasUnloadingCmr = !!db.prepare("SELECT 1 FROM documents WHERE trip_id=? AND doc_type IN ('cmr_unloading','pod') LIMIT 1").get(row.id);
  return {
    id: row.id,
    internalTripId: row.internal_trip_id || "",
    date: row.date,
    trip: row.trip_number || "",
    customer: row.customer,
    auftrag: !!row.auftrag,
    cmrLoaded: hasLoadingCmr,
    cmrUnloaded: hasUnloadingCmr,
    loadedAt: row.loaded_at || "",
    unloadedAt: row.unloaded_at || "",
    cmr: hasLoadingCmr,
    pod: hasUnloadingCmr,
    rechnungCode: row.rechnung_code || "",
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
  createdAt: row.created_at
}) : null;

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
function apiAuthorized(req) {
  if (!SITE_PASSWORD) return true;
  const h = req.headers["x-app-password"];
  const a = req.headers.authorization;
  return h === SITE_PASSWORD || a === "Bearer " + SITE_PASSWORD;
}
function mcpAuthorized(token) {
  return !!CONNECTOR_TOKEN && token === CONNECTOR_TOKEN;
}
function fileSig(id, exp) {
  return crypto.createHmac("sha256", CONNECTOR_TOKEN || SITE_PASSWORD || "tsubera")
    .update(id + ":" + exp).digest("hex");
}
function tempFileUrl(req, id, seconds = 900) {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
  return proto + "://" + host + "/file/" + encodeURIComponent(id) + "?exp=" + exp + "&sig=" + fileSig(id, exp);
}
function missingForTrip(t) {
  const missing = [];
  if (!t.auftrag) missing.push("Transportauftrag");
  if (!t.cmrLoaded) missing.push("CMR nach Beladung");
  if (!t.cmrUnloaded) missing.push("CMR nach Entladung / POD");
  return missing;
}
function readiness(t) {
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
function systemOverview() {
  const total = db.prepare("SELECT COUNT(*) c FROM trips").get().c;
  const docs = db.prepare("SELECT COUNT(*) c FROM documents").get().c;
  const rows = db.prepare("SELECT * FROM trips ORDER BY date DESC").all().map(tripOut);
  return {
    totalTrips: total,
    totalDocuments: docs,
    readyForRechnung: rows.filter(t => readiness(t) === "ready_for_rechnung").length,
    missingDocuments: rows.filter(t => readiness(t) === "missing_documents").length,
    rechnungenCreated: rows.filter(t => readiness(t) === "rechnung_created").length,
    database: "SQLite on persistent Railway volume",
    files: "Persistent Railway volume at /data/documents",
    connector: "Read/write MCP"
  };
}

function queryTrips(args = {}) {
  let sql = "SELECT * FROM trips WHERE 1=1";
  const vals = [];
  if (args.query) {
    sql += " AND (LOWER(COALESCE(internal_trip_id,'')) LIKE ? OR LOWER(COALESCE(trip_number,'')) LIKE ? OR LOWER(customer) LIKE ? OR date LIKE ? OR LOWER(rechnung_code) LIKE ?)";
    const q = "%" + String(args.query).toLowerCase() + "%";
    vals.push(q, q, q, q, q);
  }
  if (args.date_from) { sql += " AND date >= ?"; vals.push(args.date_from); }
  if (args.date_to) { sql += " AND date <= ?"; vals.push(args.date_to); }
  if (args.customer) { sql += " AND LOWER(customer) LIKE ?"; vals.push("%" + String(args.customer).toLowerCase() + "%"); }
  sql += " ORDER BY date DESC, created_at DESC LIMIT 500";
  let rows = db.prepare(sql).all(...vals).map(tripOut);
  if (args.readiness) rows = rows.filter(t => readiness(t) === args.readiness);
  return rows.map(t => ({ ...t, readiness: readiness(t), missing: missingForTrip(t) }));
}

const toolDefs = [
  {
    name: "get_system_overview",
    description: "Return a read-only overview of the Tsubera transport document system, counts, storage locations and readiness totals.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
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
        readiness: { type: "string", enum: ["ready_for_rechnung","missing_documents","rechnung_created"] }
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
        cmr: { type: "boolean", description: "Legacy alias for cmr_loaded." },
        pod: { type: "boolean", description: "Legacy alias for cmr_unloaded." },
        rechnung_number: { type: "string", description: "Rechnung number if already created." }
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
        date: { type: "string" },
        trip_number: { type: "string" },
        customer: { type: "string" },
        auftrag: { type: "boolean" },
        cmr_loaded: { type: "boolean" },
        cmr_unloaded: { type: "boolean" },
        loaded_at: { type: "string" },
        unloaded_at: { type: "string" },
        cmr: { type: "boolean" },
        pod: { type: "boolean" },
        rechnung_number: { type: "string" }
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
        mime_type: { type: "string" },
        content_base64: { type: "string", description: "Base64 encoded raw file content, without data: prefix." }
      },
      required: ["trip_id_or_number","document_type","filename","content_base64"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
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
  if (name === "get_system_overview") return systemOverview();
  if (name === "search") {
    return { results: queryTrips({ query: args.query }).map(t => ({ id: t.id, title: t.internalTripId + (t.trip ? " · " + t.trip : ""), url: null, ...t })) };
  }
  if (name === "list_trips") return { trips: queryTrips(args), count: queryTrips(args).length };
  if (name === "get_trip") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { found: false };
    return { found: true, trip: { ...t, readiness: readiness(t), missing: missingForTrip(t), documents: listDocsForTrip(t.id) } };
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
    return { found: true, document: docOut(row), trip: t, downloadUrl: tempFileUrl(req, row.id) };
  }
  if (name === "create_trip") {
    if (!args.date || !args.customer) throw new Error("date and customer are required");
    const id = crypto.randomUUID();
    const ts = now();
    const internalTripId = nextInternalTripId(args.date);
    const cmrLoaded = args.cmr_loaded ?? args.cmr ?? false;
    const cmrUnloaded = args.cmr_unloaded ?? args.pod ?? false;
    db.prepare(`INSERT INTO trips (id,internal_trip_id,date,trip_number,customer,auftrag,cmr,pod,cmr_loaded,cmr_unloaded,loaded_at,unloaded_at,rechnung_code,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        id,
        internalTripId,
        args.date,
        args.trip_number || "",
        args.customer,
        bool(args.auftrag),
        bool(cmrLoaded),
        bool(cmrUnloaded),
        bool(cmrLoaded),
        bool(cmrUnloaded),
        args.loaded_at || "",
        args.unloaded_at || "",
        args.rechnung_number || "",
        ts,
        ts
      );
    const t = getTripByAny(id);
    return { created: true, trip: { ...t, readiness: readiness(t), missing: missingForTrip(t) } };
  }
  if (name === "update_trip") {
    const old = getTripByAny(args.trip_id_or_number);
    if (!old) return { updated: false, error: "Trip not found" };
    const next = {
      date: args.date ?? old.date,
      trip: args.trip_number ?? old.trip,
      customer: args.customer ?? old.customer,
      auftrag: args.auftrag ?? old.auftrag,
      cmrLoaded: args.cmr_loaded ?? args.cmr ?? old.cmrLoaded,
      cmrUnloaded: args.cmr_unloaded ?? args.pod ?? old.cmrUnloaded,
      loadedAt: args.loaded_at ?? old.loadedAt,
      unloadedAt: args.unloaded_at ?? old.unloadedAt,
      rechnungCode: args.rechnung_number ?? old.rechnungCode
    };
    db.prepare("UPDATE trips SET date=?,trip_number=?,customer=?,auftrag=?,cmr=?,pod=?,cmr_loaded=?,cmr_unloaded=?,loaded_at=?,unloaded_at=?,rechnung_code=?,updated_at=? WHERE id=?")
      .run(next.date,next.trip,next.customer,bool(next.auftrag),bool(next.cmrLoaded),bool(next.cmrUnloaded),bool(next.cmrLoaded),bool(next.cmrUnloaded),next.loadedAt,next.unloadedAt,next.rechnungCode,now(),old.id);
    const t = getTripByAny(old.id);
    return { updated: true, trip: { ...t, readiness: readiness(t), missing: missingForTrip(t) } };
  }
  if (name === "upload_document") {
    const t = getTripByAny(args.trip_id_or_number);
    if (!t) return { uploaded: false, error: "Trip not found" };
    if (!args.filename || !args.document_type || !args.content_base64) throw new Error("filename, document_type and content_base64 are required");
    let buf;
    try { buf = Buffer.from(args.content_base64, "base64"); } catch { throw new Error("Invalid base64 content"); }
    if (!buf.length) throw new Error("Uploaded file is empty");
    if (buf.length > 10 * 1024 * 1024) throw new Error("File exceeds 10 MB MCP upload limit");
    const id = crypto.randomUUID();
    const ext = path.extname(args.filename).replace(/[^.a-zA-Z0-9]/g,"").slice(0,10);
    const stored = id + ext;
    fs.writeFileSync(path.join(DOCS_DIR, stored), buf);
    db.prepare("INSERT INTO documents (id,trip_id,doc_type,original_name,stored_name,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id,t.id,args.document_type,args.filename,stored,args.mime_type || "application/octet-stream",buf.length,now());
    const flagMap = { auftrag: "auftrag", cmr_loading: "cmr_loaded", cmr_unloading: "cmr_unloaded", cmr: "cmr_loaded", pod: "cmr_unloaded" };
    const flag = flagMap[args.document_type];
    if (flag) {
      if (flag === "cmr_loaded") db.prepare("UPDATE trips SET cmr_loaded=1, cmr=1, updated_at=? WHERE id=?").run(now(), t.id);
      else if (flag === "cmr_unloaded") db.prepare("UPDATE trips SET cmr_unloaded=1, pod=1, updated_at=? WHERE id=?").run(now(), t.id);
      else db.prepare("UPDATE trips SET auftrag=1, updated_at=? WHERE id=?").run(now(), t.id);
    }
    const trip = getTripByAny(t.id);
    return {
      uploaded: true,
      document: docOut(docRow(id)),
      trip: { ...trip, readiness: readiness(trip), missing: missingForTrip(trip) }
    };
  }
  if (name === "update_document_type") {
    const row = docRow(args.document_id);
    if (!row) return { updated: false, error: "Document not found" };
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
    if (t) return { id: t.id, type: "trip", data: { ...t, readiness: readiness(t), missing: missingForTrip(t), documents: listDocsForTrip(t.id) } };
    const row = docRow(args.id);
    if (row) return { id: row.id, type: "document", data: docOut(row), downloadUrl: tempFileUrl(req, row.id) };
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
        serverInfo: { name: "tsubera-transport-documents", version: "1.0.0" },
        instructions: "Access to Tsubera transport trips and uploaded transport documents. Read tools can search and inspect. Write tools can create/update trips, upload files, and correct document types. Use search/list before modifying when the target trip is ambiguous."
      }});
    }
    if (msg.method === "ping") return json(res, 200, { ...base, result: {} });
    if (msg.method === "tools/list") return json(res, 200, { ...base, result: { tools: toolDefs } });
    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      const data = await callTool(name, args, req);
      const content = [{ type: "text", text: JSON.stringify(data) }];
      const linkedDocument = (
        name === "get_document" && data?.found && data?.document?.id
      ) ? data : (
        name === "fetch" && data?.type === "document" && data?.downloadUrl
      ) ? data : null;
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

    if (p.startsWith("/mcp/")) {
      const token = p.slice("/mcp/".length);
      return await handleMcp(req, res, token);
    }

    if (p === "/health") return json(res, 200, { ok: true, ...systemOverview() });

    if (p.startsWith("/file/") && req.method === "GET") {
      const id = p.slice("/file/".length);
      const exp = Number(url.searchParams.get("exp"));
      const sig = url.searchParams.get("sig") || "";
      if (!exp || exp < Math.floor(Date.now()/1000) || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(fileSig(id, exp)))) {
        return text(res, 403, "Expired or invalid link");
      }
      const row = docRow(id);
      if (!row) return text(res, 404, "Not found");
      const fp = path.join(DOCS_DIR, row.stored_name);
      if (!fs.existsSync(fp)) return text(res, 404, "File missing");
      res.writeHead(200, {
        "content-type": row.mime || "application/octet-stream",
        "content-length": row.size,
        "content-disposition": 'inline; filename*=UTF-8\'\'' + encodeURIComponent(row.original_name)
      });
      return fs.createReadStream(fp).pipe(res);
    }

    if (p.startsWith("/api/")) {
      if (!apiAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

      if (p === "/api/overview" && req.method === "GET") return json(res, 200, systemOverview());

      if (p === "/api/trips" && req.method === "GET") {
        const args = {
          query: url.searchParams.get("q") || undefined,
          date_from: url.searchParams.get("date_from") || undefined,
          date_to: url.searchParams.get("date_to") || undefined,
          customer: url.searchParams.get("customer") || undefined,
          readiness: url.searchParams.get("readiness") || undefined
        };
        return json(res, 200, { trips: queryTrips(args) });
      }

      if (p === "/api/trips" && req.method === "POST") {
        const b = await readJson(req);
        if (!b.date || !b.customer) return json(res, 400, { error: "date and customer are required" });
        const id = crypto.randomUUID();
        const ts = now();
        const internalTripId = nextInternalTripId(b.date);
        const cmrLoaded = b.cmrLoaded ?? b.cmr ?? false;
        const cmrUnloaded = b.cmrUnloaded ?? b.pod ?? false;
        db.prepare(`INSERT INTO trips (id,internal_trip_id,date,trip_number,customer,auftrag,cmr,pod,cmr_loaded,cmr_unloaded,loaded_at,unloaded_at,rechnung_code,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, internalTripId, b.date, b.trip || "", b.customer, bool(b.auftrag), bool(cmrLoaded), bool(cmrUnloaded), bool(cmrLoaded), bool(cmrUnloaded), b.loadedAt || "", b.unloadedAt || "", b.rechnungCode || "", ts, ts);
        return json(res, 201, { trip: getTripByAny(id) });
      }

      const tripMatch = p.match(/^\/api\/trips\/([^/]+)$/);
      if (tripMatch && req.method === "PATCH") {
        const id = tripMatch[1], old = getTripByAny(id);
        if (!old) return json(res, 404, { error: "Trip not found" });
        const b = await readJson(req);
        const next = {
          date: b.date ?? old.date, trip: b.trip ?? old.trip, customer: b.customer ?? old.customer,
          auftrag: b.auftrag ?? old.auftrag,
          cmrLoaded: b.cmrLoaded ?? b.cmr ?? old.cmrLoaded,
          cmrUnloaded: b.cmrUnloaded ?? b.pod ?? old.cmrUnloaded,
          loadedAt: b.loadedAt ?? old.loadedAt,
          unloadedAt: b.unloadedAt ?? old.unloadedAt,
          rechnungCode: b.rechnungCode ?? old.rechnungCode
        };
        db.prepare("UPDATE trips SET date=?,trip_number=?,customer=?,auftrag=?,cmr=?,pod=?,cmr_loaded=?,cmr_unloaded=?,loaded_at=?,unloaded_at=?,rechnung_code=?,updated_at=? WHERE id=?")
          .run(next.date,next.trip,next.customer,bool(next.auftrag),bool(next.cmrLoaded),bool(next.cmrUnloaded),bool(next.cmrLoaded),bool(next.cmrUnloaded),next.loadedAt,next.unloadedAt,next.rechnungCode,now(),id);
        return json(res, 200, { trip: getTripByAny(id) });
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
        return json(res, 200, { documents: listDocsForTrip(t.id) });
      }
      if (docsMatch && req.method === "POST") {
        const t = getTripByAny(docsMatch[1]);
        if (!t) return json(res, 404, { error: "Trip not found" });
        const b = await readJson(req, 30 * 1024 * 1024);
        if (!b.name || !b.dataBase64 || !b.docType) return json(res, 400, { error: "name, docType, dataBase64 required" });
        const buf = Buffer.from(b.dataBase64, "base64");
        if (buf.length > 20 * 1024 * 1024) return json(res, 413, { error: "File max 20 MB" });
        const id = crypto.randomUUID();
        const ext = path.extname(b.name).replace(/[^.a-zA-Z0-9]/g,"").slice(0,10);
        const stored = id + ext;
        fs.writeFileSync(path.join(DOCS_DIR, stored), buf);
        db.prepare("INSERT INTO documents (id,trip_id,doc_type,original_name,stored_name,mime,size,created_at) VALUES (?,?,?,?,?,?,?,?)")
          .run(id,t.id,b.docType,b.name,stored,b.mime || "application/octet-stream",buf.length,now());
        const flagMap = { auftrag: "auftrag", cmr_loading: "cmr_loaded", cmr_unloading: "cmr_unloaded", cmr: "cmr_loaded", pod: "cmr_unloaded" };
        const flag = flagMap[b.docType];
        if (flag === "cmr_loaded") db.prepare("UPDATE trips SET cmr_loaded=1, cmr=1, updated_at=? WHERE id=?").run(now(), t.id);
        else if (flag === "cmr_unloaded") db.prepare("UPDATE trips SET cmr_unloaded=1, pod=1, updated_at=? WHERE id=?").run(now(), t.id);
        else if (flag === "auftrag") db.prepare("UPDATE trips SET auftrag=1, updated_at=? WHERE id=?").run(now(), t.id);
        return json(res, 201, { document: docOut(docRow(id)) });
      }

      const docLink = p.match(/^\/api\/documents\/([^/]+)\/link$/);
      if (docLink && req.method === "GET") {
        const row = docRow(docLink[1]);
        if (!row) return json(res, 404, { error: "Document not found" });
        return json(res, 200, { url: tempFileUrl(req, row.id) });
      }

      const docDel = p.match(/^\/api\/documents\/([^/]+)$/);
      if (docDel && req.method === "DELETE") {
        const row = docRow(docDel[1]);
        if (!row) return json(res, 404, { error: "Document not found" });
        try { fs.unlinkSync(path.join(DOCS_DIR,row.stored_name)); } catch {}
        db.prepare("DELETE FROM documents WHERE id = ?").run(row.id);
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: "API route not found" });
    }

    let rel = p === "/" ? "app.html" : p.replace(/^\//,"");
    const full = path.normalize(path.join(__dirname, rel));
    if (!full.startsWith(__dirname)) return text(res, 403, "Forbidden");
    fs.readFile(full, (err, data) => {
      if (err) {
        fs.readFile(path.join(__dirname,"app.html"), (e,d) => {
          if (e) return text(res,404,"Not found");
          res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(d);
        });
        return;
      }
      res.writeHead(200,{"content-type":mimeMap[path.extname(full)] || "application/octet-stream"});res.end(data);
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.message || "Internal server error" });
  }
});

server.listen(PORT, () => console.log("Tsubera tracker + MCP listening on " + PORT));
