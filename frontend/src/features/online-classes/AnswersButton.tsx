import { useI18n } from '../../i18n/I18nContext';
import type { AnswersStatus } from './useAnswersPanel';

/**
 * "Ответы" button for the teacher's action row.
 *
 * Without a bound answers file the button stays in place but is inert and says
 * so, instead of disappearing and shifting its neighbours.
 */
export function AnswersButton({
  status,
  open,
  onToggle,
  compact = false,
}: {
  status: AnswersStatus;
  open: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const missing = status === 'none';
  const disabled = status !== 'available';

  return (
    <button
      type="button"
      className={`answers-button${open ? ' is-active' : ''}${compact ? ' answers-button--compact board-toolbar__action' : ''}`}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={open}
      aria-controls="answers-panel"
      aria-expanded={open}
      aria-label={compact ? (missing ? t('onlineClass.answers.none') : t('onlineClass.answers.button')) : undefined}
      title={compact ? (missing ? t('onlineClass.answers.none') : t('onlineClass.answers.button')) : undefined}
    >
      {compact ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="18" rx="3" /><path d="M9 3v18M5 8h1m-1 4h1" /></svg> : missing ? t('onlineClass.answers.none') : t('onlineClass.answers.button')}
    </button>
  );
}
