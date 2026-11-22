import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInlineFractions,normalizeLessonMath,validateLesson} from './schema.mjs';
import {primeMath,richText} from './math.mjs';

test('ordinary fractional arithmetic is converted to math segments, never plain 5/12',async()=>{
  const source='Berechne 5/12 + 3/12. Kürze, wenn möglich.';
  const converted=normalizeInlineFractions(source);
  assert.equal(converted.type,'richText');
  assert.deepEqual(converted.content.filter(x=>x.math).map(x=>x.math.latex),
    ['\\frac{5}{12}','\\frac{3}{12}']);
  await primeMath({source:converted});
  const html=richText(converted);
  assert.equal((html.match(/data-qa="math"/g)||[]).length,2);
  assert.equal((html.match(/<svg /g)||[]).length,2);
  assert.doesNotMatch(html,/>5\/12</);
});

test('fraction normalization avoids school dates, URLs and paths',()=>{
  const examples=['2026/11/22','https://school.example/12/20/7','Klasse 6a/6b','A4/2026','1/2/3'];
  for(const source of examples)assert.equal(normalizeInlineFractions(source),source);
});

test('lesson normalization converts student conditions and private teacher solution text',async()=>{
  const lesson={meta:{school:'MINDCRAFTI SCHOOL',durationMinutes:90},
    workbookPages:[{title:'D',blocks:[{type:'exercise',number:'01',
      title:'Brüche ohne Hilfen',subtitle:'Berechne 5/12 + 3/12. Kürze.',
      writeLines:3}]}],
    teacherPages:[{title:'L',blocks:[{type:'solutions',section:'L',
      items:[{label:'01',text:'5/12 + 3/12 = 8/12 = 2/3.'}]}]}],
    qa:{algebra:[{kind:'equivalence',expression:'5/12+3/12',answer:'2/3'}]}
  };
  normalizeLessonMath(lesson);
  validateLesson(lesson);
  const instruction=lesson.workbookPages[0].blocks[0].subtitle;
  const answer=lesson.teacherPages[0].blocks[0].items[0].text;
  assert.equal(instruction.content.filter(x=>x.math).length,2);
  assert.equal(answer.content.filter(x=>x.math).length,4);
  assert.equal(lesson.qa.algebra[0].expression,'5/12+3/12');
  await primeMath(lesson);
  assert.equal((richText(instruction).match(/<svg /g)||[]).length,2);
  assert.equal((richText(answer).match(/<svg /g)||[]).length,4);
});
