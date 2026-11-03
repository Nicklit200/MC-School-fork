import type { AnnotationDocument, AnnotationTargetType } from '../../api/onlineClasses';

export const MAX_ANNOTATION_PAGES = 10_000;

/** Only persisted pages of this exact surface may enlarge its page list. */
export function annotationPageCount(
  documents: ReadonlyArray<Pick<AnnotationDocument, 'targetType' | 'targetId' | 'pageIndex'>>,
  targetType: AnnotationTargetType,
  targetId: string,
  floor = 1,
): number {
  let count = Number.isFinite(floor) ? Math.min(MAX_ANNOTATION_PAGES, Math.max(1, Math.trunc(floor))) : 1;
  for (const document of documents) {
    if (document.targetType !== targetType || document.targetId !== targetId
      || !Number.isInteger(document.pageIndex) || document.pageIndex < 0 || document.pageIndex >= MAX_ANNOTATION_PAGES) continue;
    count = Math.max(count, document.pageIndex + 1);
  }
  return count;
}
