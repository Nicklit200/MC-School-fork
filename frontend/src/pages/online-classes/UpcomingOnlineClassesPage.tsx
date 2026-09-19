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
      await onlineClassesApi.start(onlineClass.id);
      navigate(`/online-classes/${onlineClass.id}`);
    } catch {
      setFailed(true);
    } finally {
      setCreatingTestClass(false);
    }
  }

  if (failed && !classes) return <p role="alert">{t('onlineClass.unavailable')}</p>;
  if (!classes) return <p>{t('common.loading')}</p>;

  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';

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
          {failed && <p role="alert" className="online-class-error">Не удалось создать тестовый урок.</p>}
        </div>
      )}

      {classes.length === 0 ? (
        <p>{t('onlineClass.none')}</p>
      ) : (
        <ul>
          {classes.map((item) => (
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
