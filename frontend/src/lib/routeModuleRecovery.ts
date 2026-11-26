// A tab can outlive a deployment, while its lazily imported asset URLs
// point to the previous release. Reload once to acquire the current HTML.
// Never retry lesson-start POSTs or refresh an already mounted classroom.
const RELOAD_KEY = 'mindcrafti.route-module-reload-at';
const COOLDOWN_MS = 60_000;

export function isRouteModuleLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|unable to preload css|chunkloaderror|loading chunk [\w-]+ failed|failed to fetch module/i
    .test(error.name + ' ' + error.message);
}

export function claimRouteReload(storage: Pick<Storage, 'getItem' | 'setItem'>, now: number): boolean {
  try {
    const previous = storage.getItem(RELOAD_KEY);
    if (previous !== null && now - Number(previous) < COOLDOWN_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    // If storage is unavailable, we cannot guarantee a bounded retry.
    return false;
  }
}

export async function loadRouteModule<T>(load: () => Promise<T>): Promise<T> {
  const target = window.location.href;
  try {
    return await load();
  } catch (error) {
    if (isRouteModuleLoadError(error) && window.location.href === target && navigator.onLine !== false) {
      let reload = false;
      try { reload = claimRouteReload(window.sessionStorage, Date.now()); } catch { /* disabled storage */ }
      if (reload) window.location.reload();
    }
    // Runtime exceptions, offline failures and repeated load errors must
    // show a recoverable error screen rather than an infinite refresh loop.
    throw error;
  }
}
