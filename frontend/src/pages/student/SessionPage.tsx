import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiRequestError, api } from '../../api/client';
import type { Question } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { toErrorMessage } from '../../lib/errors';
import { useScreenshotGuard } from './useScreenshotGuard';

type Feedback = {
  correct: boolean;
  correctAnswer: string;
  selectedAnswer: string;
  timedOut: boolean;
};

/**
 * The study screen. Choosing an option submits immediately, briefly shows
 * correct/wrong feedback, then advances. Two exam features layer on top:
 *  - a per-card countdown (set by the teacher); running out submits the card as
 *    "timed out", which the backend scores as incorrect, and the card returns later;
 *  - best-effort screenshot deterrence (see useScreenshotGuard) — the content is
 *    blurred whenever the app loses focus (so app-switcher/OS snapshots don't
 *    capture it) and a per-student watermark is overlaid.
 */
export function SessionPage() {
  const { sessionId = '' } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [question, setQuestion] = useState<Question | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const countdownTimer = useRef<number | null>(null);
  // Always points at a handler that times out the *current* question.
  const timeoutHandler = useRef<() => void>(() => {});

  const { blurred, guardProps } = useScreenshotGuard();

  const goToResult = useCallback(
    () => navigate(`/session/${sessionId}/result`, { replace: true }),
    [navigate, sessionId],
  );

  function stopCountdown() {
    if (countdownTimer.current !== null) {
      window.clearInterval(countdownTimer.current);
      countdownTimer.current = null;
    }
  }

  const loadQuestion = useCallback(async () => {
    setSelected(null);
    setFeedback(null);
    try {
      setQuestion(await api.study.currentQuestion(sessionId));
      setError(null);
    } catch (e) {
      if (e instanceof ApiRequestError && e.errorCode === 'SESSION_COMPLETED') {
        goToResult();
        return;
      }
      setError(toErrorMessage(e, t));
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, goToResult]);

  useEffect(() => {
    loadQuestion();
  }, [loadQuestion]);

  useEffect(() => () => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
    }
    stopCountdown();
  }, []);

  const submitAnswer = useCallback(
    async (option: string, timedOut: boolean) => {
      if (submitting || feedback || !question) {
        return;
      }
      stopCountdown();
      setSelected(timedOut ? null : option);
      setSubmitting(true);
      try {
        const result = await api.study.answer(sessionId, question.cardId, timedOut ? '' : option, timedOut);
        setFeedback({
          correct: result.correct,
          correctAnswer: result.correctAnswer,
          selectedAnswer: timedOut ? '' : option,
          timedOut,
        });
        const delay = result.correct ? 1000 : 1500;
        advanceTimer.current = window.setTimeout(() => {
          advanceTimer.current = null;
          if (result.sessionCompleted) {
            goToResult();
          } else {
            void loadQuestion();
          }
        }, delay);
      } catch (e) {
        setError(toErrorMessage(e, t));
        setSelected(null);
        setFeedback(null);
        setSubmitting(false);
      }
    },
    [submitting, feedback, question, sessionId, goToResult, loadQuestion, t],
  );

  // Keep the timeout handler current so the interval always times out this question.
  timeoutHandler.current = () => void submitAnswer('', true);

  // Start/reset the countdown whenever a new question with a limit appears.
  useEffect(() => {
    stopCountdown();
    if (!question || question.timeLimitSeconds == null) {
      setSecondsLeft(null);
      return;
    }
    const limit = question.timeLimitSeconds;
    const startedAt = Date.now();
    setSecondsLeft(limit);
    countdownTimer.current = window.setInterval(() => {
      const left = limit - Math.floor((Date.now() - startedAt) / 1000);
      if (left <= 0) {
        setSecondsLeft(0);
        stopCountdown();
        timeoutHandler.current();
      } else {
        setSecondsLeft(left);
      }
    }, 250);
    return stopCountdown;
  }, [question]);

  if (error) {
    return <div className="banner banner--error">{error}</div>;
  }
  if (!question) {
    return <p className="muted">{t('common.loading')}</p>;
  }

  const progress = Math.round((question.answeredCount / question.totalCards) * 100);
  const locked = submitting || feedback !== null;

  return (
    <div className={`session-guard${blurred ? ' session-guard--blurred' : ''}`} {...guardProps}>
      {/* Per-student watermark: any screenshot carries the student's identity. */}
      <div className="watermark" aria-hidden="true">
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i}>{user?.email ?? 'Mindcraft School'}</span>
        ))}
      </div>

      <div className="stack">
        <div>
          <div className="progressbar">
            <div className="progressbar__fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 14 }}>
              {t('session.progress', { done: question.answeredCount, total: question.totalCards })}
            </span>
            {secondsLeft !== null && (
              <span className={`session-timer${secondsLeft <= 3 ? ' session-timer--low' : ''}`}>
                ⏱ {secondsLeft}
              </span>
            )}
          </div>
        </div>

        <div className="question">{question.question}</div>

        <div>
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className={optionClassName(option, selected, feedback)}
              disabled={locked}
              onClick={() => submitAnswer(option, false)}
            >
              {option}
            </button>
          ))}
        </div>

        {feedback && (
          <div className={`answer-feedback ${feedback.correct ? 'answer-feedback--correct' : 'answer-feedback--wrong'}`}>
            {feedback.correct
              ? t('session.feedbackCorrect')
              : feedback.timedOut
                ? t('session.timeUp')
                : t('session.feedbackWrong')}
          </div>
        )}

        <div className="muted center" style={{ fontSize: 12 }}>{t('session.noScreenshotHint')}</div>
      </div>

      {/* Shown when the app loses focus (app switch / capture attempt). */}
      {blurred && <div className="screen-shield" aria-hidden="true" />}
    </div>
  );
}

function optionClassName(option: string, selected: string | null, feedback: Feedback | null) {
  const classes = ['option'];
  if (!feedback && option === selected) {
    classes.push('option--selected');
  }
  if (feedback && option === feedback.correctAnswer) {
    classes.push('option--correct');
  }
  if (feedback && !feedback.correct && option === feedback.selectedAnswer) {
    classes.push('option--wrong');
  }
  return classes.join(' ');
}
