import assert from 'node:assert/strict';
import {SQL} from 'bun';
import {cardStoreScenarios} from './card-store-scenarios.mjs';
const url=process.env.STUDY_TEST_DATABASE_URL;
assert.ok(url);
assert.equal(new URL(url).pathname,'/study_sessions_test','Use only the isolated CI database');
const sql=new SQL(url);
try { await cardStoreScenarios(sql); } finally { await sql.close(); }
