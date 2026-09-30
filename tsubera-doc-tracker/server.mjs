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
  date TEXT NOT NULL,
  trip_number TEXT,
  customer TEXT NOT NULL,
  auftrag INTEGER NOT NULL DEFAULT 0,
  cmr INTEGER NOT NULL DEFAULT 0,
  pod INTEGER NOT NULL DEFAULT 0,
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

const now = () => new Date().toISOString();
const bool = v => v ? 1 : 0;
const tripOut = row => row ? ({
  id: row.id,
  date: row.date,
  trip: row.trip_number || "",
  customer: row.customer,
  auftrag: !!row.auftrag,
  cmr: !!row.cmr,
  pod: !!row.pod,
  rechnungCode: row.rechnung_code || "",
  createdAt: row.created_at,
  updatedAt: row.updated_at
}) : null;
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
  if (!t.cmr) missing.push("CMR");
  if (!t.pod) missing.push("POD");
  return missing;
}
function readiness(t) {
  if (t.rechnungCode) return "rechnung_created";
  return missingForTrip(t).length ? "missing_documents" : "ready_for_rechnung";
}
function getTripByAny(v) {
  const row = db.prepare("SELECT * FROM trips WHERE id = ? OR trip_number = ? LIMIT 1").get(v, v);
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
    connector: "Read-only MCP"
  };
}

function queryTrips(args = {}) {
  let sql = "SELECT * FROM trips WHERE 1=1";
  const vals = [];
  if (args.query) {
    sql += " AND (LOWER(COALESCE(trip_number,'')) LIKE ? OR LOWER(customer) LIKE ? OR date LIKE ? OR LOWER(rechnung_code) LIKE ?)";
    const q = "%" + String(args.query).toLowerCase() + "%";
    vals.push(q, q, q, q);
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
    description: "Search Tsubera trips by tour number, customer, date, or Rechnung number.",
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
    description: "Get one Tsubera trip by internal id or tour number, including missing documents and uploaded file metadata.",
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
        type: { type: "string", enum: ["auftrag","cmr","pod","rechnung","other"] }
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
    name: "fetch",
    description: "Fetch one Tsubera trip or document by id for connector retrieval.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }
];

async function callTool(name, args, req) {
  if (name === "get_system_overview") return systemOverview();
  if (name === "search") {
    return { results: queryTrips({ query: args.query }).map(t => ({ id: t.id, title: t.trip || t.customer, url: null, ...t })) };
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
  const msg = await readJson(req, 2 * 1024 * 1024);
  if (!msg.id && msg.method?.startsWith("notifications/")) return res.writeHead(202).end();
  const base = { jsonrpc: "2.0", id: msg.id ?? null };
  try {
    if (msg.method === "initialize") {
      const requested = msg.params?.protocolVersion || "2025-06-18";
      return json(res, 200, { ...base, result: {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: "tsubera-transport-documents", version: "1.0.0" },
        instructions: "Read-only access to Tsubera transport trips and uploaded transport documents. Use search/list tools first, then get_trip or get_document for details."
      }});
    }
    if (msg.method === "ping") return json(res, 200, { ...base, result: {} });
    if (msg.method === "tools/list") return json(res, 200, { ...base, result: { tools: toolDefs } });
    if (msg.method === "tools/call") {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      const data = await callTool(name, args, req);
      return json(res, 200, { ...base, result: {
        content: [{ type: "text", text: JSON.stringify(data) }],
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
        db.prepare(`INSERT INTO trips (id,date,trip_number,customer,auftrag,cmr,pod,rechnung_code,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`)
          .run(id, b.date, b.trip || "", b.customer, bool(b.auftrag), bool(b.cmr), bool(b.pod), b.rechnungCode || "", ts, ts);
        return json(res, 201, { trip: getTripByAny(id) });
      }

      const tripMatch = p.match(/^\/api\/trips\/([^/]+)$/);
      if (tripMatch && req.method === "PATCH") {
        const id = tripMatch[1], old = getTripByAny(id);
        if (!old) return json(res, 404, { error: "Trip not found" });
        const b = await readJson(req);
        const next = {
          date: b.date ?? old.date, trip: b.trip ?? old.trip, customer: b.customer ?? old.customer,
          auftrag: b.auftrag ?? old.auftrag, cmr: b.cmr ?? old.cmr, pod: b.pod ?? old.pod,
          rechnungCode: b.rechnungCode ?? old.rechnungCode
        };
        db.prepare("UPDATE trips SET date=?,trip_number=?,customer=?,auftrag=?,cmr=?,pod=?,rechnung_code=?,updated_at=? WHERE id=?")
          .run(next.date,next.trip,next.customer,bool(next.auftrag),bool(next.cmr),bool(next.pod),next.rechnungCode,now(),id);
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
        if (["auftrag","cmr","pod"].includes(b.docType)) {
          db.prepare("UPDATE trips SET " + b.docType + " = 1, updated_at=? WHERE id=?").run(now(), t.id);
        }
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

    let rel = p === "/" ? "index.html" : p.replace(/^\//,"");
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
