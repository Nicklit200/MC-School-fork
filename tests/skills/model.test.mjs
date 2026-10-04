import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBoard,clone,descendants } from '../../frontend/public/skills-board/model.js';
const sql=readFileSync(new URL('../../backend/src/main/resources/db/migration/V65__add_skill_boards.sql',import.meta.url),'utf8');
const seed=JSON.parse(sql.split('$seed$')[1]);
test('grade-six seed is a valid 61-skill graph',()=>{
  assert.equal(validateBoard(seed),true);
  assert.equal(seed.nodes.filter(n=>n.kind==='skill').length,61);
  assert.equal(seed.nodes.filter(n=>n.kind==='topic').length,10);
});
test('self edges are rejected',()=>{
  const b=clone(seed);b.edges.push({id:'bad-cycle',source:'skill-7-8',target:'skill-7-8',kind:'prerequisite'});
  assert.throws(()=>validateBoard(b));
});
test('two-node prerequisite cycle is rejected',()=>{
  const b=clone(seed);b.edges=b.edges.filter(e=>e.kind==='contains');
  b.edges.push({id:'p1',source:'skill-7-1',target:'skill-7-2',kind:'prerequisite'},{id:'p2',source:'skill-7-2',target:'skill-7-1',kind:'prerequisite'});
  assert.throws(()=>validateBoard(b),/цикл/);
});
test('duplicate parents rejected',()=>{
  const b=clone(seed);b.edges.push({id:'extra-parent',source:'topic-2',target:'skill-7-1',kind:'contains'});
  assert.throws(()=>validateBoard(b));
});
test('archiving retains identity and connections',()=>{
  const b=clone(seed);b.nodes.find(n=>n.id==='skill-7-1').archived=true;
  assert.equal(validateBoard(b),true);assert.equal(b.nodes.length,seed.nodes.length);assert.equal(descendants(b,'topic-7').size,10);
});
test('invalid IDs, kinds, dangling links and coordinates rejected',()=>{
  for(const field of ['id','kind','color']){const b=clone(seed);b.nodes[0][field]=null;assert.throws(()=>validateBoard(b));}
  const b=clone(seed);b.nodes[0].x=Infinity;assert.throws(()=>validateBoard(b));
  const c=clone(seed);c.edges[0].source='missing';assert.throws(()=>validateBoard(c));
});
