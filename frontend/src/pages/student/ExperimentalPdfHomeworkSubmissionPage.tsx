import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import type { Homework } from '../../api/types';
import { PdfHomeworkWithSubmissionPage } from './PdfHomeworkWithSubmissionPage';
import { HomeworkFinalAnswersEditor } from './HomeworkFinalAnswersEditor';

export function ExperimentalPdfHomeworkSubmissionPage() {
  const { homeworkId = '' } = useParams();
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
        // The regular homework workspace displays API errors.
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

  return (
    <>
      <PdfHomeworkWithSubmissionPage />

      {awaitingAnswers && (
        <div
          id="final-homework-answers"
          style={{
            width: 'min(100%, 760px)',
            margin: '22px auto max(32px, env(safe-area-inset-bottom))',
          }}
        >
          <HomeworkFinalAnswersEditor
            homeworkId={homeworkId}
            answerCount={answerCount}
            onCompleted={() => void refresh()}
          />
        </div>
      )}
    </>
  );
}
