// Card content lives in the existing quiz snapshot; review data is never rewritten.
export class StudyCardError extends Error {
  constructor(message) { super(message); this.name = 'StudyCardError'; }
}
const cardFields = ['question','answer','wrongAnswer1','wrongAnswer2','wrongAnswer3','explanation'];
const cardObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const cardFail = message => { throw new StudyCardError(message); };
const cardText = (value, field, max = 10000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) cardFail('Invalid ' + field);
  return value.trim();
};
const cardKeys = (input, allowed) => {
  if (!cardObject(input)) cardFail('Expected an object');
  for (const key of Object.keys(input)) if (!allowed.includes(key)) cardFail('Unknown field: ' + key);
};
const cardNormalized = text => String(text || '').normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
const cardSignature = card => cardNormalized(card.question);
function cardValues(input, partial = false) {
  cardKeys(input, partial ? cardFields : ['skillId',...cardFields]);
  const out = {};
  if (!partial) out.skillId = cardText(input.skillId,'skillId',200);
  for (const key of cardFields) if (!partial || key in input) out[key] = cardText(input[key],key);
  if (partial && !Object.keys(out).length) cardFail('No card fields supplied');
  return out;
}
function cardAnswers(card) {
  const values = [card.answer,card.wrongAnswer1,card.wrongAnswer2,card.wrongAnswer3];
  if (values.every(x => typeof x === 'string' && x.trim()) && new Set(values.map(cardNormalized)).size !== 4) cardFail('All four answers must differ');
}
export function studyCardRows(catalog, snapshot = {}) {
  if (!Array.isArray(catalog?.semesters)) throw Error('Invalid catalog');
  const rows = [], skills = new Map(), ids = new Set();
  for (const semester of catalog.semesters) for (const exam of semester.exams || []) for (const skill of exam.skills || []) {
    if (skills.has(skill.id)) throw Error('Ambiguous skill ID');
    const binding = {semesterId:semester.id,examId:exam.id,skillId:skill.id,skillTitle:skill.title};
    skills.set(skill.id,binding);
    for (const original of skill.flashcards || []) {
      const card = {...original,...snapshot.overrides?.[original.id]};
      if (ids.has(original.id)) throw Error('Ambiguous card ID');
      ids.add(original.id);
      rows.push({...card,...binding,id:original.id,cardId:original.id,answer:card.answer ?? card.correctAnswer,source:'catalog'});
    }
  }
  for (const card of snapshot.custom || []) {
    if (!skills.has(card.skillId)) continue;
    if (ids.has(card.id)) throw Error('Ambiguous card ID');
    ids.add(card.id);
    rows.push({...card,...skills.get(card.skillId),cardId:card.id,source:'custom'});
  }
  return rows.map(card => ({...card,deleted:Boolean(card.deleted || Object.hasOwn(snapshot.deleted || {},card.id))}));
}
export function createStudyCardStore({sql,loadCatalog}) {
  let ready;
  async function init() {
    if (!ready) ready = (async () => {
      await sql.unsafe("CREATE TABLE IF NOT EXISTS personal_quiz_snapshots(owner_hash TEXT PRIMARY KEY,payload JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
      await sql.unsafe('CREATE TABLE IF NOT EXISTS personal_study_card_operations(owner_hash TEXT NOT NULL,idempotency_key TEXT NOT NULL,request JSONB NOT NULL,result JSONB NOT NULL,PRIMARY KEY(owner_hash,idempotency_key))');
    })().catch(error => { ready = null; throw error; });
    await ready;
  }
  async function snapshot(db,owner,lock = false) {
    const rows = await db.unsafe('SELECT payload FROM personal_quiz_snapshots WHERE owner_hash=$1' + (lock ? ' FOR UPDATE' : ''),[owner]);
    const value = rows[0]?.payload ?? {};
    if (!cardObject(value) || (value.custom !== undefined && !Array.isArray(value.custom))) throw Error('Invalid quiz snapshot');
    return value;
  }
  function subject(catalog,args) {
    const semester = catalog.semesters?.find(x => x.id === args.semesterId);
    const exam = semester?.exams?.find(x => x.id === args.examId);
    if (!exam) cardFail('Unknown semesterId or examId');
    return exam;
  }
  async function get(owner,args) {
    cardKeys(args,['semesterId','examId','skillId']);
    for (const key of ['semesterId','examId']) cardText(args[key],key,200);
    const catalog = await loadCatalog(), exam = subject(catalog,args);
    if (args.skillId !== undefined && !exam.skills?.some(x => x.id === args.skillId)) cardFail('Unknown skillId');
    await init();
    const rows = studyCardRows(catalog,await snapshot(sql,owner)).filter(x => !x.deleted && x.semesterId === args.semesterId && x.examId === args.examId && (!args.skillId || x.skillId === args.skillId));
    return {cards:rows,count:rows.length,semesterId:args.semesterId,examId:args.examId};
  }
  async function mutate(owner,args,operation) {
    const allowed = operation === 'add' ? ['semesterId','examId','cards','idempotencyKey'] : operation === 'update' ? ['cardId',...cardFields] : ['cardId','confirm'];
    cardKeys(args,allowed);
    let normalized;
    if (operation === 'add') {
      normalized = {};
      for (const key of ['semesterId','examId','idempotencyKey']) normalized[key] = cardText(args[key],key,200);
      if (!Array.isArray(args.cards) || args.cards.length < 1 || args.cards.length > 100) cardFail('Supply 1–100 cards');
      normalized.cards = args.cards.map(x => { const c = cardValues(x); cardAnswers(c); return c; });
    } else {
      cardText(args.cardId,'cardId',180);
      if (operation === 'delete' && args.confirm !== true) cardFail('Deletion requires confirm=true');
      if (operation === 'update') { const {cardId,...patch} = args; normalized = cardValues(patch,true); }
    }
    const catalog = await loadCatalog();
    if (operation === 'add') {
      const exam = subject(catalog,normalized);
      for (const card of normalized.cards) if (!exam.skills?.some(x => x.id === card.skillId)) cardFail('Unknown skillId: ' + card.skillId);
    }
    await init();
    let expectedCards = [];
    const result = await sql.begin(async tx => {
      await tx.unsafe('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
      await tx.unsafe("INSERT INTO personal_quiz_snapshots(owner_hash,payload) VALUES($1,'{}'::jsonb) ON CONFLICT DO NOTHING",[owner]);
      const state = await snapshot(tx,owner,true);
      if (operation === 'add') {
        const previous = await tx.unsafe('SELECT request,result FROM personal_study_card_operations WHERE owner_hash=$1 AND idempotency_key=$2',[owner,normalized.idempotencyKey]);
        if (previous.length) {
          if (JSON.stringify(previous[0].request) !== JSON.stringify(JSON.parse(JSON.stringify(normalized)))) {
            // JSONB does not preserve object key order.
            if (JSON.stringify(canonical(previous[0].request)) !== JSON.stringify(canonical(normalized))) cardFail('Idempotency key already used with different data');
          }
          return previous[0].result;
        }
      }
      const rows = studyCardRows(catalog,state);
      let output;
      if (operation === 'add') {
        const seen = new Set(rows.filter(x => x.examId === normalized.examId && x.semesterId === normalized.semesterId).map(cardSignature));
        const added = [], cardIds = [];
        let skippedDuplicates = 0;
        for (const card of normalized.cards) {
          const signature = cardSignature(card);
          if (seen.has(signature)) { skippedDuplicates++; continue; }
          seen.add(signature);
          const id = 'user-card-' + crypto.randomUUID();
          added.push({id,...card}); cardIds.push(id);
        }
        expectedCards = added;
        state.custom = [...(state.custom || []),...added];
        output = {createdCount:added.length,skippedDuplicates,cardIds,examId:normalized.examId};
      } else {
        const card = rows.find(x => x.id === args.cardId);
        if (!card) cardFail('Unknown cardId');
        if (operation === 'update') {
          if (card.deleted) cardFail('Card is deleted');
          const changed = {...card,...normalized}; cardAnswers(changed);
          if (rows.some(x => x.id !== card.id && x.semesterId === card.semesterId && x.examId === card.examId && cardSignature(x) === cardSignature(changed))) cardFail('Duplicate question');
          if (card.source === 'custom') state.custom = state.custom.map(x => x.id === card.id ? {...x,...normalized} : x);
          else state.overrides = {...state.overrides,[card.id]:{...state.overrides?.[card.id],...normalized}};
        } else state.deleted = {...state.deleted,[card.id]:state.deleted?.[card.id] || {deletedAt:new Date().toISOString(),question:card.question}};
        output = {cardId:card.id,deleted:operation === 'delete'};
      }
      // Content revision prevents stale browser metadata from overwriting MCP edits.
      state.cardContentRevision = (Number(state.cardContentRevision) || 0) + 1;
      await tx.unsafe("UPDATE personal_quiz_snapshots SET payload=jsonb_set(jsonb_set(jsonb_set(jsonb_set(payload,'{custom}',$2::jsonb,true),'{overrides}',$3::jsonb,true),'{deleted}',$4::jsonb,true),'{cardContentRevision}',$5::jsonb,true),updated_at=NOW() WHERE owner_hash=$1",[owner,tx.json(state.custom || []),tx.json(state.overrides || {}),tx.json(state.deleted || {}),tx.json(state.cardContentRevision)]);
      if (operation === 'add') await tx.unsafe('INSERT INTO personal_study_card_operations(owner_hash,idempotency_key,request,result) VALUES($1,$2,$3::jsonb,$4::jsonb)',[owner,normalized.idempotencyKey,tx.json(normalized),tx.json(output)]);
      return output;
    });
    const persisted = studyCardRows(catalog,await snapshot(sql,owner));
    if (operation === 'add') {
      for (const id of result.cardIds) if (!persisted.some(x => x.id === id)) throw Error('Committed card readback failed');
      for (const expected of expectedCards) {
        const actual = persisted.find(x => x.id === expected.id);
        if (Object.entries(expected).some(([key,value]) => actual?.[key] !== value)) throw Error('Committed card content readback failed');
      }
    } else {
      const card = persisted.find(x => x.id === args.cardId);
      if (!card || (operation === 'delete' ? !card.deleted : Object.entries(normalized).some(([k,v]) => card[k] !== v))) throw Error('Committed card readback failed');
    }
    return {saved:true,...result,verified:true};
  }
  return {get,add:(owner,args) => mutate(owner,args,'add'),update:(owner,args) => mutate(owner,args,'update'),delete:(owner,args) => mutate(owner,args,'delete')};
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (cardObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
