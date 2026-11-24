import { useEffect } from 'react';
import { kolinApi, type KolinPageAnalysisCandidate, type KolinBoardSnapshot } from '../../api/kolin';

export const automaticPageAnalysisEnabled = import.meta.env.VITE_KOLYN_AUTO_PAGE_ANALYSIS === 'true';

const POLL_MS = 8000;
const MAX_LOCAL_SKIPS = 256;

export function matchesAnalysisCandidate(candidate: KolinPageAnalysisCandidate, snapshot: KolinBoardSnapshot): boolean {
  return snapshot.studentId === candidate.studentId && snapshot.boardId === candidate.boardId
    && snapshot.pageNumber === candidate.pageNumber && snapshot.documentVersion === candidate.documentVersion
    && (snapshot.sharedDocumentVersion ?? 0) === candidate.sharedDocumentVersion
    && snapshot.revision === candidate.revision && snapshot.scope === 'task_page';
}

/** The server selects quiet, not-yet-analyzed revisions. Capture only one page,
 * without navigating the teacher or pupil viewport. One request in flight per host tab;
 * the durable unique key protects across tabs/replicas. No automatic charge retry. */
export function useAutomaticPageAnalysis(classId: string, teacherId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !automaticPageAnalysisEnabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const skipped = new Set<string>();
    const schedule = () => { if (!stopped) timer = setTimeout(() => { void run(); }, POLL_MS); };
    async function run() {
      try {
        if (stopped || document.visibilityState === 'hidden') return;
        const candidates = await kolinApi.pageAnalysisCandidates(classId);
        if (stopped) return;
        for (const candidate of candidates) {
          if (stopped) return;
          const key = JSON.stringify(candidate);
          if (skipped.has(key)) continue;
          try {
            const { captureBoardPage } = await import('./boardExport');
            if (stopped) return;
            const snapshot = await captureBoardPage(classId, candidate.studentId, candidate.boardId,
              candidate.pageNumber - 1, null, 'task_page', true);
            if (stopped) return;
            if (!matchesAnalysisCandidate(candidate, snapshot)) continue;
            await kolinApi.analyzePage(classId, snapshot);
            break; // bounded: one paid analysis per polling cycle, sequential.
          } catch (error) {
            if (error instanceof Error && (error.message === 'NO_PUPIL_INK' || error.message === 'REVIEW_TOO_LARGE')) {
              if (skipped.size >= MAX_LOCAL_SKIPS) skipped.delete(skipped.values().next().value!);
              skipped.add(key);
              continue;
            }
            break; // network/race: re-read metadata, never replay an old snapshot blindly.
          }
        }
      } catch {
        // A failed optional review cannot interrupt live drawing or audio.
      } finally { schedule(); }
    }
    void run();
    return () => { stopped = true; clearTimeout(timer); };
  }, [classId, teacherId, enabled]);
}
