import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { PdfHomeworkWithSubmissionPage } from './PdfHomeworkWithSubmissionPage';
import { HomeworkFinalAnswersEditor } from './HomeworkFinalAnswersEditor';

export function ExperimentalPdfHomeworkSubmissionPage() {
  const { homeworkId = '' } = useParams();
  const { language } = useI18n();
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const homework = (await api.study.homeworks()).find((item) => item.id === homeworkId);
        if (!cancelled) setSubmitted(Boolean(homework?.submitted));
      } catch {
        // The regular homework screen displays API errors.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [homeworkId]);

  return (
    <>
      {!submitted && (
        <div className="banner banner--info" style={{ marginBottom: 14 }}>
          <strong>{language === 'DE' ? 'Testmodus: Endantworten' : 'Тестовый режим: ответы в конце'}</strong>
          <div style={{ marginTop: 4 }}>
            {language === 'DE'
              ? 'Löse die Hausaufgabe wie gewohnt. Scrolle danach ganz nach unten, trage die Endantworten ein und speichere sie. Erst danach lässt der Server die Abgabe zu.'
              : 'Реши домашку как обычно. Потом пролистай в самый низ, введи конечные ответы и сохрани их. Только после этого сервер разрешит сдать работу.'}
          </div>
        </div>
      )}

      <PdfHomeworkWithSubmissionPage />

      {!submitted && <HomeworkFinalAnswersEditor homeworkId={homeworkId} />}
    </>
  );
}
