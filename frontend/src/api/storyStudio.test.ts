import { describe, expect, it } from 'vitest';
import { serializeStudioProject } from './storyStudio';

const logo = 'data:image/webp;base64,YQ==';
const first = { id: 'template-1', name: 'Новости образования', story: { headline_1: 'Исходник', custom: { untouched: ['unknown', 7] } },
  css: '\r\n:root { --custom:  12px; }\n', html: '<div data-custom="yes">{{headline_1}}</div>' };
const second = { id: 'template-2', name: 'Результаты учеников', story: { kind: 'progress', skills: [{ before: 55, after: 70 }] }, css: '.results{}', html: '<div>{{student_label}}</div>' };
const collection = { schema: 'mindcrafti.story-studio/2', activeTemplateId: 'template-2', assets: { logoSrc: logo }, templates: [first, second] };

describe('Stories Studio project formats', () => {
  it('retains both named sources and an existing original logo exactly and serializes idempotently', () => {
    const serialized = serializeStudioProject(JSON.stringify(collection), 'data:image/png;base64,Yg==');
    expect(JSON.parse(serialized)).toEqual(collection);
    expect(serializeStudioProject(serialized, logo)).toBe(serialized);
  });

  it('preserves original legacy fields and logo while permitting a missing legacy logo fallback', () => {
    const legacy = { story: first.story, css: first.css, html: first.html, assets: { logoSrc: logo } };
    expect(JSON.parse(serializeStudioProject(JSON.stringify(legacy), 'data:image/png;base64,Yg=='))).toEqual({ schema: 'mindcrafti.story-studio/1', ...legacy });
    const { assets: _assets, ...withoutLogo } = legacy;
    expect(JSON.parse(serializeStudioProject(JSON.stringify(withoutLogo), logo)).assets.logoSrc).toBe(logo);
  });

  it('rejects invalid collections instead of reducing them to a single template', () => {
    for (const invalid of [
      { ...collection, templates: [] }, { ...collection, templates: [first, first] }, { ...collection, activeTemplateId: 'missing' },
      { ...collection, templates: [{ ...first, id: '<bad>' }] }, { ...collection, templates: [{ ...first, name: ' ' }] },
      { ...collection, templates: [{ ...first, name: 'x'.repeat(81) }] }, { ...collection, templates: [{ ...first, css: '' }] },
      { ...collection, templates: [{ ...first, story: [] }] }, { ...collection, assets: { logoSrc: 'https://example.test/logo.png' } },
      { ...collection, assets: undefined }, { ...collection, schema: 'mindcrafti.story-studio/999' },
      { ...collection, templates: Array.from({ length: 21 }, (_, index) => ({ ...first, id: `id-${index}` })) },
    ]) expect(() => serializeStudioProject(JSON.stringify(invalid), logo)).toThrow();
  });

  it('retains the existing whole-project character limit', () => {
    const large = { ...collection, templates: [{ ...first, css: 'x'.repeat(1_900_001) }, second] };
    expect(() => serializeStudioProject(JSON.stringify(large), logo)).toThrow('too large');
  });
});
