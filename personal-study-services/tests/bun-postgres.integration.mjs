// Real Bun 1.4.4/PostgreSQL integration. Never point this at personal data.
import assert from 'node:assert/strict';
import {SQL} from 'bun';
import {createStudySessionStore,validateStudySession} from '../study-sessions.js';

const databaseUrl = process.env.STUDY_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'Set STUDY_TEST_DATABASE_URL to the isolated integration database');
assert.equal(new URL(databaseUrl).pathname, '/study_sessions_test', 'Integration tests require the dedicated study_sessions_test database');
const sql = new SQL(databaseUrl);
const fresh = new SQL(databaseUrl);
const now = () => new Date('2026-11-06T12:00:00.000Z');
const subject = {semesterId:'ws-2026-27',examId:'exam-computergrafik'};
const catalog = {
  semesters:[{id:subject.semesterId,title:'Integration semester',exams:[{id:subject.examId,title:'Computergrafik'}]}],
  sessions:[{id:'integration-catalog-checkpoint',...subject,date:'2026-10-25',title:'Existing catalog history',
    summary:'An isolated fixture for the previously completed slide.',
    checkpoint:{document:'1Pipeline.pdf',lastExplainedPage:79,nextPage:80,totalPages:107}}]
};
const loadCatalog = async () => structuredClone(catalog);
const store = createStudySessionStore({sql,loadCatalog,now});
const freshStore = createStudySessionStore({sql:fresh,loadCatalog,now});
const owner = 'integration:new:' + crypto.randomUUID();
const oldOwner = 'integration:old:' + crypto.randomUUID();
const args = {
  ...subject,date:'2026-11-06',materialId:'1Pipeline.pdf',materialTitle:'1Pipeline.pdf',
  idempotencyKey:'integration-slide-90',lastCompletedSlide:90,nextSlide:91,totalSlides:107,
  title:'Integration fixture: completed slide 90',summary:'Only isolated test data.',topics:[]
};
const fingerprint = async input => {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(validateStudySession(input,now())))));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
};

try {
  // Establish the actual driver behavior that the previous fake SQL masked.
  await sql.begin(async tx => {
    await tx.unsafe('CREATE TEMP TABLE study_session_json_probe (label TEXT,payload JSONB) ON COMMIT DROP');
    await tx.unsafe('INSERT INTO study_session_json_probe(label,payload) VALUES($1,$2::jsonb)',
      ['stringified',JSON.stringify({id:'probe'})]);
    await tx.unsafe('INSERT INTO study_session_json_probe(label,payload) VALUES($1,$2::jsonb)',
      ['object',tx.json({id:'probe'})]);
    const rows = await tx.unsafe('SELECT label,jsonb_typeof(payload) AS kind,payload FROM study_session_json_probe ORDER BY label');
    assert.equal(rows.find(row => row.label === 'stringified').kind,'string');
    assert.equal(typeof rows.find(row => row.label === 'stringified').payload,'string');
    assert.equal(rows.find(row => row.label === 'object').kind,'object');
    assert.deepEqual(rows.find(row => row.label === 'object').payload,{id:'probe'});
  });
  console.log('PASS real Bun prepared JSON binding: stringified input differs from a JSON object');

  const saved = await store.save(owner,args);
  assert.equal(saved.saved,true);
  assert.equal(saved.created,true);
  assert.equal(typeof saved.session.id,'string');
  assert.equal(saved.session.lastCompletedSlide,90);
  assert.equal(saved.session.nextSlide,91);

  // Independent SQL client + store must see the committed row, not a transaction-local value.
  const persisted = await fresh.unsafe('SELECT session_id,jsonb_typeof(payload) AS kind,payload FROM personal_study_sessions WHERE owner_hash=$1 AND idempotency_key=$2',[owner,args.idempotencyKey]);
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].kind,'object');
  assert.equal(persisted[0].payload.id,saved.session.id);
  const history = await freshStore.history(owner,{...subject,materialId:args.materialId,date:args.date});
  assert.equal(history.sessions.length,1);
  assert.equal(history.sessions[0].id,saved.session.id);
  const resumed = await freshStore.resume(owner,{...subject,materialId:args.materialId});
  assert.equal(resumed.lastCompletedSlide,90);
  assert.equal(resumed.nextSlide,91);
  assert.equal(resumed.positionSession.id,saved.session.id);
  assert.equal((await freshStore.history(owner,{...subject})).sessions.find(row => row.id === 'integration-catalog-checkpoint').lastCompletedSlide,79);
  const replay = await freshStore.save(owner,args);
  assert.equal(replay.saved,true);
  assert.equal(replay.created,false);
  assert.equal(replay.session.id,saved.session.id);
  const count = await fresh.unsafe('SELECT COUNT(*)::int AS count FROM personal_study_sessions WHERE owner_hash=$1 AND idempotency_key=$2',[owner,args.idempotencyKey]);
  assert.equal(Number(count[0].count),1);
  console.log('PASS committed object survives fresh client history/resume and same-key retry creates no duplicate');

  // Reproduce a row created by the previous implementation, using SQL text -> JSON scalar.
  // Reading or replaying this event must recover its existing identity rather than add a new row.
  const legacyArgs = {...args,idempotencyKey:'integration-existing-string-row'};
  const legacyId = 'study-integration-existing-' + crypto.randomUUID();
  const legacySession = {
    id:legacyId,type:'study_session',source:'chatgpt',...subject,semesterTitle:'Integration semester',examTitle:'Computergrafik',
    date:legacyArgs.date,occurredAt:'2026-11-06T10:00:00.000Z',timeKnown:false,
    materialId:legacyArgs.materialId,materialTitle:legacyArgs.materialTitle,title:legacyArgs.title,summary:legacyArgs.summary,
    topics:[],lastCompletedSlide:90,nextSlide:91,totalSlides:107,slideFrom:null,changes:[]
  };
  await sql.unsafe('INSERT INTO personal_study_sessions(owner_hash,session_id,idempotency_key,request_fingerprint,semester_id,exam_id,material_id,session_date,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::timestamptz,to_jsonb($10::text))',
    [oldOwner,legacyId,legacyArgs.idempotencyKey,await fingerprint(legacyArgs),subject.semesterId,subject.examId,legacyArgs.materialId,legacyArgs.date,legacySession.occurredAt,JSON.stringify(legacySession)]);
  const recovered = await freshStore.history(oldOwner,{...subject,materialId:legacyArgs.materialId,date:legacyArgs.date});
  assert.equal(recovered.sessions.length,1);
  assert.equal(recovered.sessions[0].id,legacyId);
  assert.equal(recovered.sessions[0].lastCompletedSlide,90);
  assert.equal((await freshStore.resume(oldOwner,{...subject,materialId:legacyArgs.materialId})).nextSlide,91);
  const recoveredReplay = await freshStore.save(oldOwner,legacyArgs);
  assert.equal(recoveredReplay.saved,true);
  assert.equal(recoveredReplay.created,false);
  assert.equal(recoveredReplay.session.id,legacyId);
  assert.equal(Number((await fresh.unsafe('SELECT COUNT(*)::int AS count FROM personal_study_sessions WHERE owner_hash=$1',[oldOwner]))[0].count),1);
  console.log('PASS existing scalar row recovers as the same event; replay retains ID and row count');

  // A database-side corruption cannot be mistaken for a successful durable save.
  await sql.unsafe(`CREATE OR REPLACE FUNCTION study_test_corrupt_payload() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.idempotency_key='integration-reject-corrupt-row' THEN NEW.payload='null'::jsonb; END IF;
      RETURN NEW;
    END;
  $$`);
  await sql.unsafe('CREATE TRIGGER study_test_corrupt_payload BEFORE INSERT ON personal_study_sessions FOR EACH ROW EXECUTE FUNCTION study_test_corrupt_payload()');
  await assert.rejects(() => store.save(owner,{...args,idempotencyKey:'integration-reject-corrupt-row'}));
  assert.equal(Number((await fresh.unsafe('SELECT COUNT(*)::int AS count FROM personal_study_sessions WHERE owner_hash=$1 AND idempotency_key=$2',[owner,'integration-reject-corrupt-row']))[0].count),0);
  console.log('PASS malformed database payload rejects save and is not reported as saved:true');
} finally {
  // The exact dedicated database guard above keeps this cleanup away from personal data.
  await sql.unsafe('DROP TRIGGER IF EXISTS study_test_corrupt_payload ON personal_study_sessions').catch(() => {});
  await sql.unsafe('DROP FUNCTION IF EXISTS study_test_corrupt_payload()').catch(() => {});
  await sql.close();
  await fresh.close();
}
