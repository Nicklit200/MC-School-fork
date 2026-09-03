import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { StudentListItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { DriveFolderPicker } from './DriveFolderPicker';

export function StudentDrivePage() {
  const { studentId = '' } = useParams();
  const { t } = useI18n();
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.students.get(studentId)
      .then(setStudent)
      .catch((e) => setError(toErrorMessage(e, t)));
  }, [studentId, t]);

  return (
    <div>
      <p><Link to={`/students/${studentId}`} className="muted">← {t('common.back')}</Link></p>
      <h1>Google Drive — {student?.fullName ?? 'ученик'}</h1>
      <p className="muted">Для каждого ученика отдельно выберите, куда сохранять результаты карточек и куда сохранять сданные PDF-домашки.</p>
      {error && <div className="banner banner--error">{error}</div>}

      <DriveFolderPicker
        kind="cards"
        studentId={studentId}
        savedFolderId={student?.googleDriveFolderUrl ?? null}
      />

      <DriveFolderPicker
        kind="homework"
        studentId={studentId}
        savedFolderId={student?.googleDriveHomeworkFolderId ?? null}
      />
    </div>
  );
}
