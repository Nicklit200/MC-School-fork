import { describe, expect, it, vi } from 'vitest';
import { claimRouteReload, isRouteModuleLoadError, loadRouteModule } from './routeModuleRecovery';

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}

describe('route module recovery', () => {
  it('identifies browser chunk and stylesheet load failures, not component bugs', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: /assets/old.js',
      'Importing a module script failed.',
      'error loading dynamically imported module',
      'Unable to preload CSS for /assets/old.css',
      'Loading chunk 12 failed',
    ]) expect(isRouteModuleLoadError(new Error(message))).toBe(true);
    expect(isRouteModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
  it('permits at most one automatic reload per minute, even across page reloads', () => {
    const storage = memoryStorage();
    expect(claimRouteReload(storage, 100_000)).toBe(true);
    expect(claimRouteReload(storage, 100_001)).toBe(false);
    expect(claimRouteReload(storage, 159_999)).toBe(false);
    expect(claimRouteReload(storage, 160_000)).toBe(true);
  });
  it('does not risk a loop if session storage is blocked', () => {
    expect(claimRouteReload({
      getItem: () => { throw new Error('Storage denied'); },
      setItem: vi.fn(),
    }, 100_000)).toBe(false);
  });
  it('loads a healthy route normally and does not swallow runtime exceptions', async () => {
    const module = { default: 'ready' };
    expect(await loadRouteModule(() => Promise.resolve(module))).toEqual(module);
    const error = new Error('Module initialization failed');
    await expect(loadRouteModule(() => Promise.reject(error))).rejects.toBe(error);
  });
});
