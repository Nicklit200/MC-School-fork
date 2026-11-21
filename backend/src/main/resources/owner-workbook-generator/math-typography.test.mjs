import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPlainMathText} from './math-typography.mjs';
import {richText,renderMath} from './math.mjs';
import {functionLabel,graphSvg} from './diagrams.mjs';
import {compileVisual} from './visual-tasks.mjs';

test('quadratic functions use raised exponents instead of caret text', () => {
  const label=functionLabel({kind:'quadratic',a:1,b:0,c:-1});
  assert.equal(label,'f(x) = x^2 - 1', 'canonical numeric source remains unchanged');
  assert.equal(formatPlainMathText(label),'f(x) = x<sup>2</sup> - 1');
  assert.equal(richText(label),'f(x) = x<sup>2</sup> - 1');
  assert.ok(!richText(label).includes('x^2'));
});

test('draw visual task prints correct raised powers without changing math evaluation', () => {
  const task=compileVisual({type:'graph',language:'de',objective:'draw',
    series:[{kind:'quadratic',parameters:[1,0,-1]}],
    xRange:[-3,3],yRange:[-2,6]});
  assert.equal(task.blocks[1].text,'f(x) = x^2 - 1');
  assert.equal(richText(task.blocks[1].text),'f(x) = x<sup>2</sup> - 1');
  assert.equal(task.blocks[2].type,'coordinateGrid');
  assert.ok(!task.blocks[2].series);
});

test('all graph legends show powers as superscripts for polynomial curves', () => {
  const rendered=graphSvg({series:[{kind:'quadratic',a:1,b:0,c:-1}],
    xRange:[-3,3],yRange:[-2,6]});
  assert.match(rendered,/f\(x\) = x<sup>2<\/sup> - 1/);
  assert.ok(!rendered.includes('f(x) = x^2 - 1'));
});

test('covers multi-digit, negative and parenthesized powers in plain instructions', () => {
  assert.equal(formatPlainMathText('a^10 + b^-2 + (x+1)^2'),
    'a<sup>10</sup> + b<sup>-2</sup> + (x+1)<sup>2</sup>');
  assert.equal(formatPlainMathText('f(x) = e^(x - 2)'),
    'f(x) = e<sup>x - 2</sup>');
  assert.equal(formatPlainMathText('log_10(x) = y_1'),
    'log<sub>10</sub>(x) = y<sub>1</sub>');
  assert.equal(richText({type:'richText',content:[{text:'Bestimme y=x^2.'}]}),
    'Bestimme y=x<sup>2</sup>.');
});

test('only safe renderer-generated sup and sub tags survive escaping', () => {
  assert.equal(formatPlainMathText('<img src=x onerror=alert(1)> x^2 & a'),
    '&lt;img src=x onerror=alert(1)&gt; x<sup>2</sup> &amp; a');
  assert.equal(formatPlainMathText('x<sup>2</sup>'),
    'x&lt;sup&gt;2&lt;/sup&gt;');
  assert.ok(!formatPlainMathText('<script>alert(1)</script>^2').includes('<script>'));
});
