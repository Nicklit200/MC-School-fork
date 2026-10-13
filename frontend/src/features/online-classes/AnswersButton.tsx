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
}: {
  status: AnswersStatus;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const missing = status === 'none';
  const disabled = status !== 'available';

  return (
    <button
      type="button"
      className={open ? 'answers-button is-active' : 'answers-button'}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={open}
      aria-controls="answers-panel"
      aria-expanded={open}
    >
      {missing ? t('onlineClass.answers.none') : t('onlineClass.answers.button')}
    </button>
  );
}
