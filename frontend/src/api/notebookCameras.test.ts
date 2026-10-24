import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAccessToken } from './client';
import { notebookCamerasApi, pairingUrl } from './notebookCameras';

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); });
describe('notebook pairing credentials', () => {
  it('keeps the single-use token in the URL fragment and uses a root entry URL', () => {
    const url = new URL(pairingUrl('https://school.example', 'camera-123', 'secret-abc'));
    expect(url.pathname).toBe('/'); expect(url.searchParams.get('mindcraftiCamera')).toBe('1');
    expect(url.search).not.toContain('secret'); expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe('secret-abc');
  });
  it('does not send a school account token, cookies or phone secret in the claim URL', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sessionToken: 'new-session' }) })); vi.stubGlobal('fetch', fetch);
    setAccessToken('school-account-secret'); await notebookCamerasApi.claim('camera-1', 'phone-secret');
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/public\/notebook-cameras\/camera-1\/claim$/), {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'phone-secret' }), referrerPolicy: 'no-referrer',
    });
  });
});
