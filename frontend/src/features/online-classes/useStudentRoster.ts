import { useEffect, useState } from 'react';
import { onlineClassesApi } from '../../api/onlineClasses';

export interface RosterStudent {
  userId: string;
  displayName: string;
}

const POLL_MS = 10000;

/** Admitted students of the class, for the teacher's board picker. */
export function useStudentRoster(classId: string, enabled: boolean): RosterStudent[] {
  const [students, setStudents] = useState<RosterStudent[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = async () => {
      try {
        const roster = await onlineClassesApi.listParticipants(classId);
        if (!active) return;
        setStudents(
          roster
            .filter((entry) => entry.classRole === 'STUDENT' && entry.admissionState === 'ADMITTED')
            .map((entry) => ({ userId: entry.userId, displayName: entry.displayName })),
        );
      } catch {
        // Keep the last known list; the picker must not blank mid-lesson.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [classId, enabled]);

  return students;
}
