import { useI18n } from '../../i18n/I18nContext';
import './parent-dashboard.css';

export function ParentSkillsPage() {
  const { language } = useI18n();
  const de = language === 'DE';

  return <div className="stack parent-dashboard">
    <header className="parent-dashboard__heading">
      <h1>{de ? 'Kompetenzkarte' : 'Карта навыков'}</h1>
    </header>
    <section className="panel parent-dashboard__skills" role="status">
      <h2>{de ? 'In Entwicklung' : 'В разработке'}</h2>
    </section>
  </div>;
}
