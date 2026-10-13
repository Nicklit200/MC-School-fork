import { useState } from 'react';
import { onlineClassesApi } from '../../api/onlineClasses';
import { useI18n } from '../../i18n/I18nContext';

/**
 * Teacher switch: may students share their screen in this class?
 *
 * <p>Takes effect immediately for everyone already in the room (the server
 * pushes the new permission to connected students), so the teacher can open
 * sharing for a moment and close it again.
 */
export function StudentScreenShareToggle({
  classId,
  initiallyEnabled,
}: {
  classId: string;
  initiallyEnabled: boolean;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onlineClassesApi.setStudentScreenShare(classId, !enabled);
      setEnabled((current) => !current);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="screen-share-toggle">
      <button type="button" aria-pressed={enabled} onClick={() => void toggle()} disabled={busy}>
        {enabled ? t('onlineClass.studentShare.on') : t('onlineClass.studentShare.off')}
      </button>
      {failed && (
        <span role="alert" className="screen-share-toggle__error">
          {t('onlineClass.studentShare.failed')}
        </span>
      )}
    </span>
  );
}
