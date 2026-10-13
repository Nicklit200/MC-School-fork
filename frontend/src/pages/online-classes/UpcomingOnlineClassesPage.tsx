import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nContext';
import { onlineClassesApi, type OnlineClass } from '../../api/onlineClasses';

/**
 * Entry point listing the caller's upcoming and live classes. The backend
 * filters by ownership/binding, so a student only ever receives their own.
 */
export function UpcomingOnlineClassesPage() {
  const { t, language } = useI18n();
  const [classes, setClasses] = useState<OnlineClass[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  if (failed) return <p role="alert">{t('onlineClass.unavailable')}</p>;
  if (!classes) return <p>{t('common.loading')}</p>;

  const locale = language === 'DE' ? 'de-DE' : 'ru-RU';

  return (
    <div className="online-classes">
      <h1>{t('onlineClass.upcoming')}</h1>
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
