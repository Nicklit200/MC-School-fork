// Shared by the owner-authenticated HTTP API and MCP connector. No mastery writes.
export class StudySessionError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'StudySessionError'; this.status = status; }
}
const sessionObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sessionOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sessionIso = value => value instanceof Date ? value.toISOString() : String(value || '');
const sessionFail = (message, status) => { throw new StudySessionError(message, status); };
export function studySessionDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Berlin', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(value));
  return ['year','month','day'].map(key => parts.find(part => part.type === key).value).join('-');
}
function sessionDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function sessionString(value, name, max, required = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) sessionFail('Invalid ' + name);
  return value.trim();
}
function sessionInteger(value, name, min = 0) {
  if (!Number.isInteger(value) || value < min || value > 100000) sessionFail('Invalid ' + name);
  return value;
}
export function validateStudySession(input, now = new Date()) {
  if (!sessionObject(input)) sessionFail('Invalid study session');
  const allowed = new Set(['semesterId','examId','materialId','materialTitle','date','occurredAt','idempotencyKey','title','summary','topics','lastCompletedSlide','nextSlide','totalSlides','slideFrom']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) sessionFail('Invalid field: ' + key);
  const out = {};
  for (const key of ['semesterId','examId','idempotencyKey']) out[key] = sessionString(input[key], key, 200, true);
  for (const [key,max] of [['materialId',200],['materialTitle',500],['title',500],['summary',10000]]) {
    const value = sessionString(input[key], key, max);
    if (value !== undefined) out[key] = value;
  }
  if (out.materialId === '') sessionFail('Invalid materialId');
  if (!sessionDate(input.date) || input.date > studySessionDay(now)) sessionFail('Invalid date; use a completed session date in Europe/Berlin');
  out.date = input.date;
  if (input.occurredAt !== undefined) {
    if (typeof input.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt))) sessionFail('Invalid occurredAt; supply an ISO timestamp with timezone');
    if (studySessionDay(input.occurredAt) !== out.date || Date.parse(input.occurredAt) > new Date(now).getTime() + 300000) sessionFail('Invalid occurredAt; must match date in Europe/Berlin and cannot be in the future');
    out.occurredAt = new Date(input.occurredAt).toISOString();
  }
  out.topics = [];
  if (input.topics !== undefined) {
    if (!Array.isArray(input.topics) || input.topics.length > 100) sessionFail('Invalid topics');
    out.topics = [...new Set(input.topics.map(topic => sessionString(topic, 'topic', 500, true)))];
  }
  if (sessionOwn(input, 'lastCompletedSlide')) out.lastCompletedSlide = sessionInteger(input.lastCompletedSlide, 'lastCompletedSlide');
  if (sessionOwn(input, 'totalSlides')) out.totalSlides = sessionInteger(input.totalSlides, 'totalSlides', 1);
  if (out.totalSlides !== undefined && out.lastCompletedSlide > out.totalSlides) sessionFail('Invalid lastCompletedSlide; exceeds totalSlides');
  if (sessionOwn(input, 'slideFrom')) {
    out.slideFrom = sessionInteger(input.slideFrom, 'slideFrom', 1);
    if (out.lastCompletedSlide === undefined || out.slideFrom > out.lastCompletedSlide) sessionFail('Invalid slideFrom; must not exceed lastCompletedSlide');
  }
  if (sessionOwn(input, 'nextSlide')) {
    if (out.lastCompletedSlide === undefined) sessionFail('Invalid nextSlide; lastCompletedSlide required');
    const expected = out.lastCompletedSlide === out.totalSlides ? null : out.lastCompletedSlide + 1;
    if (!(input.nextSlide === null && out.totalSlides === undefined) && input.nextSlide !== expected) sessionFail('Invalid nextSlide; must follow the last completed slide, or be null when the material is complete');
    out.nextSlide = input.nextSlide;
  }
  if (out.lastCompletedSlide === undefined && !out.topics.length && !out.summary) sessionFail('Invalid study session; supply topics, summary or lastCompletedSlide');
  return out;
}
function sessionSubjects(catalog) {
  if (!sessionObject(catalog) || !Array.isArray(catalog.semesters)) sessionFail('Study catalog unavailable', 503);
  return catalog.semesters.flatMap(semester => (semester.exams || []).map(exam => ({semesterId:semester.id, semesterTitle:semester.title, examId:exam.id, examTitle:exam.title})));
}
function sessionSubject(catalog, args) {
  const subject = sessionSubjects(catalog).find(row => row.semesterId === args.semesterId && row.examId === args.examId);
  if (!subject) sessionFail('Unknown subject; read get_study_progress and use its semesterId and examId', 404);
  return subject;
}
function sessionSort(a, b) {
  for (const field of ['occurredAt','createdAt']) {
    const av = sessionIso(a[field]), bv = sessionIso(b[field]);
    if (av !== bv) return av < bv ? 1 : -1;
  }
  const ao = BigInt(a.recordedOrder || '0'), bo = BigInt(b.recordedOrder || '0');
  if (ao !== bo) return ao < bo ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}
export function legacyStudySessions(catalog) {
  const subjects = sessionSubjects(catalog);
  return (Array.isArray(catalog.sessions) ? catalog.sessions : []).filter(row => row && typeof row.id === 'string' && sessionDate(row.date) && subjects.some(subject => subject.semesterId === row.semesterId && subject.examId === row.examId)).map(row => {
    const subject = subjects.find(subject => subject.semesterId === row.semesterId && subject.examId === row.examId);
    const cp = row.checkpoint || {};
    // page is the page opened by the user, not proof it was completed.
    const last = Number.isInteger(cp.lastExplainedPage) && cp.lastExplainedPage >= 0 ? cp.lastExplainedPage : null;
    const total = Number.isInteger(cp.totalPages) && cp.totalPages > 0 ? cp.totalPages : null;
    let next = last === null ? null : total === last ? null : last + 1;
    if (last !== null && Number.isInteger(cp.nextPage) && cp.nextPage > last) next = cp.nextPage;
    const occurredAt = row.occurredAt && Number.isFinite(Date.parse(row.occurredAt)) ? new Date(row.occurredAt).toISOString() : row.date + 'T00:00:00.000Z';
    return {...row, ...subject, type:row.type || (row.checkpoint ? 'study_session' : 'knowledge_update'), source:'catalog',
      occurredAt, createdAt:row.createdAt || occurredAt, recordedOrder:'0', timeKnown:Boolean(row.occurredAt),
      materialId:row.materialId || cp.document || null, materialTitle:row.materialTitle || cp.document || null,
      topics:Array.isArray(row.topics) ? row.topics : cp.topic ? [cp.topic] : [],
      lastCompletedSlide:last, nextSlide:next, totalSlides:total, positionNote:cp.note || null};
  });
}
export function studySessionResume(subject, sessions, materialId) {
  const rows = sessions.filter(row => row.semesterId === subject.semesterId && row.examId === subject.examId).sort(sessionSort);
  const groups = new Map();
  for (const row of rows) {
    if (!row.materialId || (row.materialId === 'default' && row.lastCompletedSlide == null)) continue;
    const key = row.materialId || 'default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const materials = [...groups].map(([id, history]) => {
    const position = history.find(row => row.lastCompletedSlide !== null && row.lastCompletedSlide !== undefined);
    return {materialId:id, materialTitle:history.find(row => row.materialTitle)?.materialTitle || null,
      lastCompletedSlide:position?.lastCompletedSlide ?? null, nextSlide:position?.nextSlide ?? null,
      totalSlides:position?.totalSlides ?? null, completed:Boolean(position && position.totalSlides !== null && position.lastCompletedSlide === position.totalSlides),
      positionSession:position || null, latestSession:history[0]};
  });
  const selected = materialId !== undefined ? materials.find(row => row.materialId === materialId) : materials.length === 1 ? materials[0] : null;
  return {...subject, materials, latestSession:(materialId === undefined ? rows[0] : rows.find(row => row.materialId === materialId)) || null,
    needsMaterialSelection:materialId === undefined && materials.length > 1,
    materialId:selected?.materialId ?? null, materialTitle:selected?.materialTitle ?? null,
    lastCompletedSlide:selected?.lastCompletedSlide ?? null, nextSlide:selected?.nextSlide ?? null,
    totalSlides:selected?.totalSlides ?? null, completed:selected?.completed || false,
    positionSession:selected?.positionSession || null};
}
function sessionMatches(row, args) {
  return ['semesterId','examId','materialId','date'].every(key => args[key] === undefined || row[key] === args[key]);
}
function sessionCursor(row) { return btoa(JSON.stringify([row.occurredAt,row.createdAt,row.recordedOrder || '0',row.id])); }
function sessionReadCursor(value) {
  if (value === undefined) return null;
  try {
    if (typeof value !== 'string' || value.length > 1500) throw Error();
    const data = JSON.parse(atob(value));
    if (!Array.isArray(data) || data.length !== 4 || data.some(value => typeof value !== 'string') || !/^(0|[1-9]\d{0,18})$/.test(data[2]) || BigInt(data[2]) > 9223372036854775807n || !data[3] || data[3].length > 200 || !Number.isFinite(Date.parse(data[0])) || !Number.isFinite(Date.parse(data[1]))) throw Error();
    return {occurredAt:new Date(data[0]).toISOString(),createdAt:new Date(data[1]).toISOString(),recordedOrder:data[2],id:data[3]};
  } catch { sessionFail('Invalid cursor'); }
}
function sessionFilter(args = {}) {
  if (!sessionObject(args)) sessionFail('Invalid session filter');
  const out = {};
  for (const key of ['semesterId','examId','materialId']) if (args[key] !== undefined) out[key] = sessionString(args[key], key, 200, true);
  if (args.date !== undefined) { if (!sessionDate(args.date)) sessionFail('Invalid date'); out.date = args.date; }
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) sessionFail('Invalid limit; use 1 to 100');
  out.limit = args.limit ?? 50; out.cursor = sessionReadCursor(args.cursor);
  return out;
}
function sessionPayload(row, allowEncodedString = false) {
  let payload = row.payload;
  if (typeof payload === 'string' && allowEncodedString) {
    try { payload = JSON.parse(payload); } catch { /* Reject below. */ }
  }
  const invalid = () => sessionFail('Stored study session is malformed; persistence was not confirmed',503);
  if (!sessionObject(payload) || payload.type !== 'study_session' ||
      typeof payload.id !== 'string' || !payload.id || !sessionDate(payload.date) ||
      typeof payload.semesterId !== 'string' || !payload.semesterId ||
      typeof payload.examId !== 'string' || !payload.examId ||
      typeof payload.materialId !== 'string' || !payload.materialId ||
      typeof payload.title !== 'string' || typeof payload.summary !== 'string' ||
      !Array.isArray(payload.topics) || !payload.topics.every(topic => typeof topic === 'string') ||
      !Number.isFinite(Date.parse(payload.occurredAt)) ||
      (payload.lastCompletedSlide !== null && (!Number.isInteger(payload.lastCompletedSlide) || payload.lastCompletedSlide < 0)) ||
      (payload.nextSlide !== null && (!Number.isInteger(payload.nextSlide) || payload.nextSlide < 1)) ||
      (payload.totalSlides !== null && (!Number.isInteger(payload.totalSlides) || payload.totalSlides < 1))) invalid();
  for (const [field,column] of [['id','sessionId'],['semesterId','semesterId'],['examId','examId'],['materialId','materialId'],['date','sessionDate']]) {
    if (payload[field] !== row[column]) invalid();
  }
  if (sessionIso(row.occurredAt) !== payload.occurredAt || !Number.isFinite(Date.parse(sessionIso(row.createdAt))) ||
      !/^[1-9]\d*$/.test(String(row.recordedOrder))) invalid();
  if (payload.lastCompletedSlide === null) {
    if (payload.nextSlide !== null) invalid();
  } else {
    if (payload.totalSlides !== null && payload.lastCompletedSlide > payload.totalSlides) invalid();
    const next = payload.lastCompletedSlide === payload.totalSlides ? null : payload.lastCompletedSlide + 1;
    if (payload.nextSlide !== next) invalid();
  }
  return payload;
}
function sessionRow(row) { return {...sessionPayload(row),createdAt:sessionIso(row.createdAt),recordedOrder:String(row.recordedOrder)}; }
function sessionMerge(catalog, stored) {
  const rows = new Map(legacyStudySessions(catalog).map(row => [row.id,row]));
  for (const row of stored) rows.set(row.id, row);
  return [...rows.values()].sort(sessionSort);
}
async function sessionFingerprint(args) {
  const stable = value => Array.isArray(value) ? value.map(stable) : sessionObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(stable(args))));
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2,'0')).join('');
}
export async function loadStudySessionCatalog(site) {
  const response = await fetch(site + '/data/study.json', {signal:AbortSignal.timeout(8000),headers:{'Cache-Control':'no-cache'}});
  if (!response.ok) throw new StudySessionError('Study catalog unavailable', 503);
  const catalog = await response.json(); sessionSubjects(catalog); return catalog;
}
export function createStudySessionStore({sql, loadCatalog, now = () => new Date()}) {
  let pendingSchema;
  const columns = 'payload,created_at AS "createdAt",recorded_order::text AS "recordedOrder",request_fingerprint,session_id AS "sessionId",semester_id AS "semesterId",exam_id AS "examId",material_id AS "materialId",session_date::text AS "sessionDate",occurred_at AS "occurredAt"';
  async function schema() {
    if (!pendingSchema) pendingSchema = (async () => {
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS personal_study_sessions (
        owner_hash TEXT NOT NULL, session_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL, semester_id TEXT NOT NULL, exam_id TEXT NOT NULL,
        material_id TEXT NOT NULL, session_date DATE NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(), recorded_order BIGSERIAL NOT NULL, payload JSONB NOT NULL,
        PRIMARY KEY(owner_hash,session_id), UNIQUE(owner_hash,idempotency_key))`);
      await sql.unsafe('CREATE INDEX IF NOT EXISTS personal_study_sessions_history_idx ON personal_study_sessions(owner_hash,semester_id,exam_id,occurred_at DESC,created_at DESC,recorded_order DESC,session_id DESC)');
    })().catch(error => {pendingSchema = null; throw error;});
    return pendingSchema;
  }
  function ownerRequired(owner) { if (typeof owner !== 'string' || !owner) sessionFail('Unauthorized', 401); }
  async function committed(owner, sessionId) {
    const rows = await sql.unsafe('SELECT ' + columns + ' FROM personal_study_sessions WHERE owner_hash=$1 AND session_id=$2',[owner,sessionId]);
    if (rows.length !== 1) sessionFail('Study session could not be read after commit; persistence was not confirmed',503);
    sessionPayload(rows[0]);
    return rows[0];
  }
  async function recoverEncodedRow(owner, row) {
    if (typeof row.payload !== 'string') { sessionPayload(row); return row; }
    const payload = sessionPayload(row,true);
    // Repair only the storage encoding of the existing owner-scoped row.
    // Its ID, dates, checkpoint, topics, ordering and idempotency key stay intact.
    await sql.begin(async tx => {
      await tx.unsafe('UPDATE personal_study_sessions SET payload=$3::jsonb WHERE owner_hash=$1 AND session_id=$2 AND request_fingerprint=$4 AND jsonb_typeof(payload)=\'string\'',[owner,row.sessionId,tx.json(payload),row.request_fingerprint]);
      const rows = await tx.unsafe('SELECT ' + columns + ' FROM personal_study_sessions WHERE owner_hash=$1 AND session_id=$2',[owner,row.sessionId]);
      if (rows.length !== 1 || await sessionFingerprint(sessionPayload(rows[0])) !== await sessionFingerprint(payload)) sessionFail('Study session encoding repair could not be verified',503);
    });
    return committed(owner,row.sessionId);
  }
  async function stored(owner, args = {}, cursor = null, limit = null) {
    await schema();
    const params = [owner]; let where = 'owner_hash=$1';
    for (const [key,column] of [['semesterId','semester_id'],['examId','exam_id'],['materialId','material_id'],['date','session_date']]) {
      if (args[key] !== undefined) {params.push(args[key]); where += ' AND ' + column + '=$' + params.length;}
    }
    if (cursor) {
      const offset = params.length; params.push(cursor.occurredAt,cursor.createdAt,cursor.recordedOrder,cursor.id);
      where += ` AND (occurred_at,created_at,recorded_order,session_id)<($${offset+1}::timestamptz,$${offset+2}::timestamptz,$${offset+3}::bigint,$${offset+4})`;
    }
    let query = 'SELECT ' + columns + ' FROM personal_study_sessions WHERE ' + where + ' ORDER BY occurred_at DESC,created_at DESC,recorded_order DESC,session_id DESC';
    if (limit !== null) {params.push(limit);query += ' LIMIT $' + params.length;}
    const rows = await sql.unsafe(query,params), sessions = [];
    for (const row of rows) sessions.push(sessionRow(await recoverEncodedRow(owner,row)));
    return sessions;
  }
  async function history(owner, input = {}) {
    ownerRequired(owner); const args = sessionFilter(input); const catalog = await loadCatalog();
    const rows = sessionMerge(catalog, await stored(owner,args,args.cursor,args.limit + 1))
      .filter(row => sessionMatches(row,args) && (!args.cursor || sessionSort(row,args.cursor) > 0));
    const sessions = rows.slice(0,args.limit);
    return {sessions, nextCursor:rows.length > args.limit ? sessionCursor(sessions.at(-1)) : null};
  }
  async function resume(owner, input) {
    ownerRequired(owner); const args = sessionFilter(input); const catalog = await loadCatalog();
    const subject = sessionSubject(catalog,args);
    const rows = sessionMerge(catalog,await stored(owner,{semesterId:subject.semesterId,examId:subject.examId}));
    return studySessionResume(subject,rows,args.materialId);
  }
  async function listResume(owner) {
    ownerRequired(owner); const catalog = await loadCatalog();
    const rows = sessionMerge(catalog,await stored(owner));
    return {subjects:sessionSubjects(catalog).map(subject => studySessionResume(subject,rows))};
  }
  async function save(owner, input) {
    ownerRequired(owner); const args = validateStudySession(input, now());
    const catalog = await loadCatalog(); const subject = sessionSubject(catalog,args);
    await schema();
    const fingerprint = await sessionFingerprint(args);
    // Check retry before resolving material IDs, which may change as other sessions arrive.
    const existing = await sql.unsafe('SELECT ' + columns + ' FROM personal_study_sessions WHERE owner_hash=$1 AND idempotency_key=$2',[owner,args.idempotencyKey]);
    if (existing.length) {
      if (existing[0].request_fingerprint !== fingerprint) sessionFail('Idempotency key already used with different session data', 409);
      const repaired = await recoverEncodedRow(owner,existing[0]);
      const session = sessionRow(await committed(owner,repaired.sessionId));
      return {saved:true,created:false,verified:{committed:true,readBack:true,sessionId:session.id},session,resume:await resume(owner,{...subject,materialId:session.materialId})};
    }
    const prior = sessionMerge(catalog,await stored(owner,{semesterId:subject.semesterId,examId:subject.examId}));
    const materials = studySessionResume(subject,prior).materials;
    if (!args.materialId && materials.length > 1) sessionFail('Select materialId from get_study_resume; this subject has multiple materials');
    const materialId = args.materialId || materials[0]?.materialId || 'default';
    const previousMaterial = materials.find(row => row.materialId === materialId);
    const last = args.lastCompletedSlide ?? null;
    const total = args.totalSlides ?? previousMaterial?.totalSlides ?? null;
    if (last !== null && total !== null && last > total) sessionFail('Invalid lastCompletedSlide; exceeds saved totalSlides');
    const next = last === null ? null : last === total ? null : last + 1;
    if (sessionOwn(args,'nextSlide') && args.nextSlide !== next) sessionFail('Invalid nextSlide; conflicts with saved totalSlides');
    const recorded = new Date(now()).toISOString();
    const session = {id:'study-' + crypto.randomUUID(),type:'study_session',source:'chatgpt',...subject,
      date:args.date,occurredAt:args.occurredAt || (args.date === studySessionDay(recorded) ? recorded : args.date + 'T00:00:00.000Z'),timeKnown:Boolean(args.occurredAt),
      materialId,materialTitle:args.materialTitle || previousMaterial?.materialTitle || null,
      title:args.title || subject.examTitle + ' — учебная сессия',summary:args.summary || '',topics:args.topics,
      lastCompletedSlide:last,nextSlide:next,totalSlides:total,slideFrom:args.slideFrom ?? null,changes:[]};
    const saved = await sql.begin(async tx => {
      const created = await tx.unsafe('INSERT INTO personal_study_sessions(owner_hash,session_id,idempotency_key,request_fingerprint,semester_id,exam_id,material_id,session_date,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::timestamptz,$10::jsonb) ON CONFLICT(owner_hash,idempotency_key) DO NOTHING RETURNING session_id',[owner,session.id,args.idempotencyKey,fingerprint,args.semesterId,args.examId,materialId,args.date,session.occurredAt,tx.json(session)]);
      const rows = await tx.unsafe('SELECT ' + columns + ' FROM personal_study_sessions WHERE owner_hash=$1 AND idempotency_key=$2',[owner,args.idempotencyKey]);
      if (rows.length !== 1) throw new Error('Study session write could not be verified');
      if (rows[0].request_fingerprint !== fingerprint) sessionFail('Idempotency key already used with different session data', 409);
      const persisted = sessionPayload(rows[0]);
      if (created.length && await sessionFingerprint(persisted) !== await sessionFingerprint(session)) sessionFail('Study session contents could not be verified',503);
      return {session:sessionRow(rows[0]),created:created.length === 1,contentFingerprint:await sessionFingerprint(persisted)};
    });
    const confirmed = await committed(owner,saved.session.id);
    if (confirmed.request_fingerprint !== fingerprint || await sessionFingerprint(sessionPayload(confirmed)) !== saved.contentFingerprint) sessionFail('Study session contents changed after commit; persistence was not confirmed',503);
    const verifiedSession = sessionRow(confirmed);
    return {saved:true,created:saved.created,verified:{committed:true,readBack:true,sessionId:verifiedSession.id},session:verifiedSession,resume:await resume(owner,{...subject,materialId:verifiedSession.materialId})};
  }
  return {save,history,resume,listResume};
}
