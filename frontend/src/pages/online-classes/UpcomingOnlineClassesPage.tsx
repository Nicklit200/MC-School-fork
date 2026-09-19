import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';

const IS_STAGING_HOST = typeof window !== 'undefined'
  && window.location.hostname === 'staging-web-production.up.railway.app';

/**
 * Entry point listing the caller's upcoming and live classes. The backend
 * filters by ownership/binding, so a student only ever receives their own.
 */
export function UpcomingOnlineClassesPage() {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState<OnlineClass[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creatingTestClass, setCreatingTestClass] = useState(false);
  const [providerMissing, setProviderMissing] = useState(false);

  useEffect(() => {
    let active = true;
    onlineClassesApi
      .listUpcoming()
      .then((loaded) => {
        if (active) setClasses(loaded);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createStagingTestClass() {
    if (creatingTestClass) return;
    setCreatingTestClass(true);
    setFailed(false);
    setProviderMissing(false);
    try {
      const students = await api.students.list();
      const testStudent = students.find((student) =>
        student.username?.toLowerCase() === 'test-student'
        || student.email?.toLowerCase() === 'test-student@mindcrafti.local'
        || student.fullName === 'Test Student'
      );
      if (!testStudent) throw new Error('Test Student not found');
      const onlineClass = await onlineClassesApi.createTestClass(
        testStudent.id,
        undefined,
        'Тестовый онлайн-урок',
      );
      try {
        await onlineClassesApi.start(onlineClass.id);
        navigate(`/online-classes/${onlineClass.id}`);
      } catch {
        // The test class itself was created successfully. A 409 here on staging
        // normally means LiveKit is not configured yet, so keep the class and
        // explain the next setup step instead of claiming creation failed.
        setClasses((current) => current
          ? [onlineClass, ...current.filter((item) => item.id !== onlineClass.id)]
          : [onlineClass]);
        setProviderMissing(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setCreatingTestClass(false);
    }
  }

  if (failed && !classes) return <p role="alert">{t('onlineClass.unavailable')}</p>;
  if (!classes) return <p>{t('common.loading')}</p>;

  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';
  const statusRank: Record<OnlineClass['status'], number> = {
    LIVE: 0,
    LOBBY_OPEN: 1,
    SCHEDULED: 2,
    ENDED: 3,
    CANCELLED: 4,
  };
  const visibleClasses = [...classes].sort((a, b) => {
    const byStatus = statusRank[a.status] - statusRank[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.scheduledStartAt).getTime() - new Date(a.scheduledStartAt).getTime();
  });

  return (
    <div className="online-classes">
      <h1>{t('onlineClass.upcoming')}</h1>

      {IS_STAGING_HOST && user?.role === 'TEACHER' && (
        <div className="panel" style={{ marginBottom: 16, padding: 16 }}>
          <strong>Тест онлайн-урока</strong>
          <p className="muted" style={{ marginTop: 5 }}>
            Создаст отдельный тестовый урок между Test Teacher и Test Student.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            disabled={creatingTestClass}
            onClick={() => void createStagingTestClass()}
          >
            {creatingTestClass ? 'Создаём…' : 'Создать тестовый онлайн-урок'}
          </button>
          {providerMissing && (
            <p role="status" className="online-class-error">
              Урок создан. Чтобы запустить видео и звук, подключите LiveKit.
            </p>
          )}
          {failed && <p role="alert" className="online-class-error">Не удалось создать тестовый урок.</p>}
        </div>
      )}

      {visibleClasses.length === 0 ? (
        <p>{t('onlineClass.none')}</p>
      ) : (
        <ul>
          {visibleClasses.map((item) => (
            <li key={item.id}>
              <Link to={`/online-classes/${item.id}`}>
                {item.title} — {new Date(item.scheduledStartAt).toLocaleString(locale)}
              </Link>
              {item.status === 'LIVE' && <span className="badge">{t('onlineClass.live')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
