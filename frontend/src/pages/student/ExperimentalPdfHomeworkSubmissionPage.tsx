import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { PdfHomeworkWithSubmissionPage } from './PdfHomeworkWithSubmissionPage';
import { HomeworkFinalAnswersEditor } from './HomeworkFinalAnswersEditor';

export function ExperimentalPdfHomeworkSubmissionPage() {
  const { homeworkId = '' } = useParams();
  const { language } = useI18n();
  const [homework, setHomework] = useState<Homework | null>(null);

  async function refresh() {
    const current = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
    setHomework(current);
    return current;
  }

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const poll = async () => {
      try {
        const current = (await api.study.homeworks()).find((item) => item.id === homeworkId) ?? null;
        if (cancelled) return;
        setHomework(current);
        if (current?.submitted) {
          if (timer) window.clearInterval(timer);
          return;
        }
      } catch {
        // The regular homework screen displays API errors.
      }
    };

    void poll();
    timer = window.setInterval(() => void poll(), 900);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [homeworkId]);

  const answerCount = homework?.finalAnswerCount ?? 0;
  const awaitingAnswers = Boolean(homework?.pdfUploaded && answerCount > 0 && homework?.submitted !== true);

  if (awaitingAnswers) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={language === 'DE' ? 'Antworten' : 'Ответы'}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3000,
          overflowY: 'auto',
          background: 'rgba(15, 23, 42, .58)',
          backdropFilter: 'blur(4px)',
          padding: 'max(18px, env(safe-area-inset-top)) 14px max(24px, env(safe-area-inset-bottom))',
        }}
      >
        <div style={{ width: 'min(100%, 620px)', margin: '0 auto' }}>
          <HomeworkFinalAnswersEditor
            homeworkId={homeworkId}
            answerCount={answerCount}
            onCompleted={() => void refresh()}
          />
        </div>
      </div>
    );
  }

  return <PdfHomeworkWithSubmissionPage />;
}
