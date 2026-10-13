import { useEffect, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { onlineClassesApi } from '../../api/onlineClasses';

/**
 * Whether online classes work for this user on this server.
 *
 * <p>The class list answers 404 "not enabled" when the feature is switched off,
 * so the menu probes it once and only shows the entry when it works. The answer
 * is remembered per user: the layout remounts on every page change and must not
 * ask each time. A network hiccup is not remembered, so it is retried.
 */
const answers = new Map<string, boolean>();

export function resetOnlineClassesAvailability(): void {
  answers.clear();
}

export function useOnlineClassesAvailable(userId: string | undefined, active: boolean): boolean {
  const [available, setAvailable] = useState(() => (userId ? (answers.get(userId) ?? false) : false));

  useEffect(() => {
    if (!active || !userId) {
      setAvailable(false);
      return;
    }
    const known = answers.get(userId);
    if (known !== undefined) {
      setAvailable(known);
      return;
    }
    let live = true;
    onlineClassesApi
      .listUpcoming()
      .then(() => {
        answers.set(userId, true);
        if (live) setAvailable(true);
      })
      .catch((error: unknown) => {
        // A 404/403 is a real "no"; anything else may be temporary.
        if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
          answers.set(userId, false);
        }
        if (live) setAvailable(false);
      });
    return () => {
      live = false;
    };
  }, [userId, active]);

  return available;
}
