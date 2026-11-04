// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from '../../api/client';
import { readStudioLogo, serializeStudioProject, storyStudioApi, type StudioInfo } from '../../api/storyStudio';
import { AdminMindcraftiStudioPage } from './AdminMindcraftiStudioPage';
import html from './mindcrafti-studio.html?raw';

vi.mock('../../api/client', () => ({
  api: { auth: { me: vi.fn() } }, request: vi.fn(),
  ApiRequestError: class extends Error { constructor(public status: number, public errorCode: string, message: string) { super(message); } },
}));

const user = { id: 'admin-one' } as Awaited<ReturnType<typeof api.auth.me>>;
const logo = readStudioLogo(html);
const project = (headline: string) => JSON.stringify({ story: { headline_1: headline, items: [] }, css: '.story{color:#123}', html: '<div>{{headline_1}}</div>' });
const canonical = (headline: string) => serializeStudioProject(project(headline), logo);
const info = (version: number): StudioInfo => ({ configured: true, version, sha256: 'hash', chunkCount: 1, sizeBytes: 100, updatedAt: '2026-10-29T10:00:00Z' });

async function message(type: string, payload?: string, foreign = false) {
  const frame = screen.getByTitle('Mindcrafti Stories Studio') as HTMLIFrameElement;
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', {
      source: foreign ? window : frame.contentWindow,
      data: { type: `mindcrafti-studio:${type}`, payload }, origin: 'null',
    }));
  });
}
async function settle(ms = 801) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(api.auth.me).mockResolvedValue(user);
  vi.spyOn(storyStudioApi, 'get').mockResolvedValue({ ...info(0), configured: false, projectJson: null });
  vi.spyOn(storyStudioApi, 'save').mockImplementation(async (version) => info(version + 1));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('Stories Studio cloud connection', () => {
  it('migrates the original browser project without requiring manual PPTX upload', async () => {
    localStorage.setItem('mindcrafti.admin-studio.project.v1', project('Original'));
    render(<AdminMindcraftiStudioPage />);
    const frame = screen.getByTitle('Mindcrafti Stories Studio') as HTMLIFrameElement;
    const hydrate = vi.spyOn(frame.contentWindow!, 'postMessage');
    await message('ready');
    expect(hydrate).toHaveBeenCalledWith({ type: 'mindcrafti-studio:hydrate', payload: canonical('Original') }, '*');
    await message('save', project('Original'));
    await settle();
    expect(storyStudioApi.save).toHaveBeenCalledWith(0, canonical('Original'));
    expect(JSON.parse(localStorage.getItem('mindcrafti.admin-studio.project.v2:admin-one')!).pending).toBe(false);
  });

  it('hydrates the latest cloud version and does not rewrite unchanged content', async () => {
    vi.mocked(storyStudioApi.get).mockResolvedValue({ ...info(4), projectJson: canonical('Cloud') });
    render(<AdminMindcraftiStudioPage />);
    const frame = screen.getByTitle('Mindcrafti Stories Studio') as HTMLIFrameElement;
    const hydrate = vi.spyOn(frame.contentWindow!, 'postMessage');
    await message('ready');
    expect(hydrate).toHaveBeenCalledWith({ type: 'mindcrafti-studio:hydrate', payload: canonical('Cloud') }, '*');
    await message('save', project('Cloud'));
    await settle();
    expect(storyStudioApi.save).not.toHaveBeenCalled();
  });

  it('saves the migrated collection using the existing cloud version and preserves both templates on the next edit', async () => {
    vi.mocked(storyStudioApi.get).mockResolvedValue({ ...info(7), projectJson: canonical('Original') });
    render(<AdminMindcraftiStudioPage />); await message('ready');
    const first = { id: 'template-1', name: 'Новости образования', ...JSON.parse(project('Original')) };
    const second = { id: 'template-2', name: 'Результаты учеников', ...JSON.parse(project('Results')) };
    const collection = { schema: 'mindcrafti.story-studio/2', activeTemplateId: 'template-1', assets: { logoSrc: logo }, templates: [first, second] };
    await message('save', JSON.stringify(collection)); await settle();
    expect(storyStudioApi.save).toHaveBeenLastCalledWith(7, serializeStudioProject(JSON.stringify(collection), logo));
    collection.templates[1] = { ...second, name: 'Переименовано' }; collection.activeTemplateId='template-2';
    await message('save', JSON.stringify(collection)); await settle();
    expect(storyStudioApi.save).toHaveBeenLastCalledWith(8, serializeStudioProject(JSON.stringify(collection), logo));
    const stored = JSON.parse(JSON.parse(localStorage.getItem('mindcrafti.admin-studio.project.v2:admin-one')!).projectJson);
    expect(stored.templates[0]).toEqual(first); expect(stored.templates[1].name).toBe('Переименовано');
  });

  it('preserves archived stories through cloud hydration, a visible-template edit, save and reload', async () => {
    const news={id:'template-1',name:'Шаблон новостей',...JSON.parse(project('Новости'))};
    const results={id:'results-template',name:'Результаты учеников',...JSON.parse(project('Результаты'))};
    const archivedStories=Array.from({length:4},(_,index)=>({...JSON.parse(project('Архив '+index)),id:`completed-${index}`,name:'Готовая история',css:'\r\n.story { --custom:  12px; }\n',story:{headline_1:'Учебный пример',unknown:{retained:true}}}));
    const collection={schema:'mindcrafti.story-studio/2',activeTemplateId:'results-template',assets:{logoSrc:logo},templates:[news,results],archivedStories,customRoot:{retained:true}};
    vi.mocked(storyStudioApi.get).mockResolvedValue({...info(9),projectJson:JSON.stringify(collection)});
    const view=render(<AdminMindcraftiStudioPage />);
    const frame=screen.getByTitle('Mindcrafti Stories Studio') as HTMLIFrameElement;
    const hydrate=vi.spyOn(frame.contentWindow!,'postMessage');await message('ready');
    expect(JSON.parse(hydrate.mock.lastCall![0].payload)).toEqual(collection);
    const edited=structuredClone(collection);edited.templates[1].story.headline_1='Измененный результат';
    await message('save',JSON.stringify(edited));await settle();
    const [version,saved]=vi.mocked(storyStudioApi.save).mock.lastCall!;
    expect(version).toBe(9);expect(JSON.parse(saved)).toEqual(edited);
    expect(JSON.parse(saved).templates).toHaveLength(2);expect(JSON.parse(saved).archivedStories).toEqual(archivedStories);
    view.unmount();vi.mocked(storyStudioApi.get).mockResolvedValue({...info(10),projectJson:saved});
    render(<AdminMindcraftiStudioPage />);
    const reloaded=screen.getByTitle('Mindcrafti Stories Studio') as HTMLIFrameElement;
    const rehydrate=vi.spyOn(reloaded.contentWindow!,'postMessage');await message('ready');
    expect(JSON.parse(rehydrate.mock.lastCall![0].payload)).toEqual(edited);
  });

  it('keeps a stale local draft as recovery rather than overwriting cloud data', async () => {
    localStorage.setItem('mindcrafti.admin-studio.project.v2:admin-one', JSON.stringify({ projectJson: canonical('Local'), baseVersion: 1, pending: true }));
    vi.mocked(storyStudioApi.get).mockResolvedValue({ ...info(4), projectJson: canonical('Cloud') });
    render(<AdminMindcraftiStudioPage />);
    await message('ready');
    expect(localStorage.getItem('mindcrafti.admin-studio.project.v2:admin-one.recovery')).toBe(canonical('Local'));
    await message('save', project('Cloud'));
    await settle();
    expect(storyStudioApi.save).not.toHaveBeenCalled();
  });

  it('ignores messages from unrelated windows', async () => {
    render(<AdminMindcraftiStudioPage />);
    await message('ready', undefined, true);
    await message('save', project('Untrusted'), true);
    await settle();
    expect(api.auth.me).not.toHaveBeenCalled();
    expect(storyStudioApi.save).not.toHaveBeenCalled();
  });

  it('serializes saves and uses the returned version for the next edit', async () => {
    let resolveFirst!: (value: StudioInfo) => void;
    vi.mocked(storyStudioApi.save).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    render(<AdminMindcraftiStudioPage />);
    await message('ready');
    await message('save', project('One'));
    await settle();
    await message('save', project('Two'));
    await settle();
    expect(storyStudioApi.save).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFirst(info(1)); });
    await settle();
    expect(storyStudioApi.save).toHaveBeenLastCalledWith(1, canonical('Two'));
  });

  it('stops on a revision conflict and keeps the unsaved draft', async () => {
    vi.mocked(storyStudioApi.save).mockRejectedValue(new ApiRequestError(409, 'CONFLICT', 'Changed'));
    render(<AdminMindcraftiStudioPage />);
    await message('ready');
    await message('save', project('Draft'));
    await settle();
    expect(localStorage.getItem('mindcrafti.admin-studio.project.v2:admin-one.recovery')).toBe(canonical('Draft'));
    await settle(5000);
    expect(storyStudioApi.save).toHaveBeenCalledTimes(1);
  });

  it('does not save to an unknown server version after a failed initial read', async () => {
    vi.mocked(storyStudioApi.get).mockRejectedValue(new Error('Offline'));
    render(<AdminMindcraftiStudioPage />);
    await message('ready');
    await message('save', project('Offline draft'));
    await settle();
    expect(storyStudioApi.save).not.toHaveBeenCalled();
    expect(localStorage.getItem('mindcrafti.admin-studio.project.v2:admin-one.recovery')).toBe(canonical('Offline draft'));
  });

  it('does not import legacy content already claimed by another account', async () => {
    localStorage.setItem('mindcrafti.admin-studio.project.v1', project('Other admin'));
    localStorage.setItem('mindcrafti.admin-studio.project.v1.migrated-owner', 'other-admin');
    render(<AdminMindcraftiStudioPage />);
    const frame = screen.getByTitle('Mindcrafti Stories Studio') as HTMLIFrameElement;
    const hydrate = vi.spyOn(frame.contentWindow!, 'postMessage');
    await message('ready');
    expect(hydrate).toHaveBeenCalledWith({ type: 'mindcrafti-studio:hydrate', payload: null }, '*');
  });
});

describe('exact project serialization', () => {
  it('preserves the story, CSS, HTML and exact original logo', () => {
    const raw = JSON.parse(project('Exact'));
    const result = JSON.parse(serializeStudioProject(JSON.stringify(raw), logo));
    expect(result.story).toEqual(raw.story);
    expect(result.css).toBe(raw.css);
    expect(result.html).toBe(raw.html);
    expect(result.assets.logoSrc).toBe(logo);
  });
  it('rejects malformed projects', () => {
    for (const raw of ['{}', '[]', 'null', 'not json']) expect(() => serializeStudioProject(raw, logo)).toThrow();
  });

  it('retains both named sources and an existing original logo byte for byte', () => {
    const original = { id: 'template-1', name: 'Новости образования', ...JSON.parse(project('Original')), css: '\r\n:root { --custom:  12px; }\n', html: '<div data-custom="yes">{{headline_1}}</div>' };
    original.story.custom = { untouched: ['unknown', 7] };
    const other = { id: 'template-2', name: 'Результаты учеников', story: { kind: 'progress', skills: [{ before: 55, after: 70 }] }, css: '.results{}', html: '<div>{{student_label}}</div>' };
    const collection = { schema: 'mindcrafti.story-studio/2', activeTemplateId: 'template-2', assets: { logoSrc: 'data:image/png;base64,YQ==' }, templates: [original, other] };
    const serialized = serializeStudioProject(JSON.stringify(collection), logo);
    expect(JSON.parse(serialized)).toEqual(collection);
    expect(serializeStudioProject(serialized, logo)).toBe(serialized);
  });

  it('rejects invalid collections instead of reducing them to a single template', () => {
    const template = { id: 'template-1', name: 'Новости', ...JSON.parse(project('Original')) };
    const base = { schema: 'mindcrafti.story-studio/2', activeTemplateId: 'template-1', assets: { logoSrc: logo }, templates: [template] };
    for (const invalid of [
      { ...base, templates: [] }, { ...base, templates: [template, template] }, { ...base, activeTemplateId: 'missing' },
      { ...base, templates: [{ ...template, id: '<bad>' }] }, { ...base, templates: [{ ...template, name: ' ' }] },
      { ...base, templates: [{ ...template, css: '' }] }, { ...base, templates: [{ ...template, story: [] }] },
      { ...base, assets: { logoSrc: 'https://example.test/logo.png' } }, { ...base, assets: undefined },
      { ...base, schema: 'mindcrafti.story-studio/999' },
    ]) expect(() => serializeStudioProject(JSON.stringify(invalid), logo)).toThrow();
  });
});
