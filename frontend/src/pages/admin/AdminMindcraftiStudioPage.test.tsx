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
});
