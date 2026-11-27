import { useEffect, useState } from 'react';
import { kolinApi, type KolinPageAnalysisCandidate, type KolinBoardSnapshot } from '../../api/kolin';

export interface ManualPageCheckSummary {
  checked: number;
  skipped: number;
  failed: number;
}

export function matchesAnalysisCandidate(candidate: KolinPageAnalysisCandidate, snapshot: KolinBoardSnapshot): boolean {
  return snapshot.studentId === candidate.studentId && snapshot.boardId === candidate.boardId
    && snapshot.pageNumber === candidate.pageNumber && snapshot.documentVersion === candidate.documentVersion
    && (snapshot.sharedDocumentVersion ?? 0) === candidate.sharedDocumentVersion
    && snapshot.revision === candidate.revision && snapshot.scope === 'task_page';
}

/** Keep the teacher feature gate, but never poll for paid page checks. */
export function useAutomaticPageAnalysis(classId: string, teacherId: string, enabled: boolean) {
  const scope = JSON.stringify([classId, teacherId]);
  const [permission, setPermission] = useState<{ scope: string; enabled: boolean }>();
  const pageAnalysisEnabled = enabled && permission?.scope === scope && permission.enabled;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    void kolinApi.pageAnalysisEnabled(classId).then(result => {
      if (!stopped) setPermission({ scope, enabled: result.enabled === true });
    }).catch(() => {
      if (!stopped) setPermission({ scope, enabled: false });
    });
    return () => { stopped = true; };
  }, [classId, scope, enabled]);
  return Boolean(pageAnalysisEnabled);
}

/** Check only the selected pupil's changed pages. The server returns metadata
 * for pupil-ink revisions not previously checked; unchanged pages are never
 * captured or sent to the vision model again. Calls run sequentially per click. */
export async function checkStudentPages(
  classId: string,
  studentId: string,
  isCurrent: () => boolean = () => true,
): Promise<ManualPageCheckSummary> {
  const summary: ManualPageCheckSummary = { checked: 0, skipped: 0, failed: 0 };
  if (!isCurrent()) return summary;
  const candidates = await kolinApi.manualPageAnalysisCandidates(classId, studentId);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!isCurrent()) break;
    if (candidate.studentId !== studentId) {
      summary.skipped++;
      continue;
    }
    const key = JSON.stringify(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const { captureBoardPage } = await import('./boardExport');
      if (!isCurrent()) break;
      const snapshot = await captureBoardPage(classId, studentId, candidate.boardId,
        candidate.pageNumber - 1, null, 'task_page', true);
      if (!isCurrent()) break;
      if (!matchesAnalysisCandidate(candidate, snapshot)) {
        summary.skipped++;
        continue;
      }
      const receipt = await kolinApi.analyzePage(classId, snapshot);
      if (receipt.state === 'READY') summary.checked++;
      else if (receipt.state === 'RUNNING') summary.skipped++;
      else summary.failed++;
    } catch (error) {
      if (error instanceof Error && error.message === 'NO_PUPIL_INK') summary.skipped++;
      else summary.failed++;
    }
  }
  return summary;
}
