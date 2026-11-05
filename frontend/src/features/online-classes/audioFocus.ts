import type { ClassAudioFocus } from '../../api/onlineClasses';

/** Only server-owned room metadata controls listening, never pupil data packets. */
export function parseAudioFocus(metadata: string | undefined, classId: string, teacherId: string | null): ClassAudioFocus | null {
  if (!metadata || !teacherId) return null;
  try {
    const value = JSON.parse(metadata).mcAudioFocus;
    if (!value || value.version !== 1 || value.classId !== classId || value.teacherId !== teacherId
        || typeof value.announceAll !== 'boolean'
        || !(value.studentId === null || typeof value.studentId === 'string' && value.studentId.length > 0 && value.studentId !== teacherId)
        || value.studentId === null && value.announceAll) return null;
    return value;
  } catch { return null; }
}

/** Pedagogical listening layout, not a confidentiality boundary or recording exclusion. */
export function canHearClassAudio(listenerId: string, speakerId: string, teacherId: string | null, focus: ClassAudioFocus | null): boolean {
  if (listenerId === teacherId || !focus?.studentId) return true;
  if (speakerId === teacherId) return listenerId === focus.studentId || focus.announceAll;
  if (speakerId === focus.studentId) return false;
  if (listenerId === focus.studentId) return false;
  return true;
}
