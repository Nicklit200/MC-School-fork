import { useI18n } from '../../i18n/I18nContext';

interface Props {
  /** Zero-based index of the visible page. */
  current: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
  /** Omitted where pages cannot be added (the answers file). */
  onAdd?: () => void;
  /** Student under follow mode: arrows and "+" are shown but inert. */
  disabled?: boolean;
  className?: string;
}

/**
 * Compact "‹ 3 / 12 ›  +" page switcher.
 *
 * Shared by the main board and the answers panel so both use the same arrows
 * and the same logic.
 */
export function PageNavigator({
  current,
  count,
  onPrevious,
  onNext,
  onAdd,
  disabled = false,
  className,
}: Props) {
  const { t } = useI18n();
  const atStart = current <= 0;
  const atEnd = current >= count - 1;

  return (
    <nav
      className={className ? `page-nav ${className}` : 'page-nav'}
      aria-label={t('onlineClass.board.page.nav')}
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={disabled || atStart}
        aria-label={t('onlineClass.board.page.prev')}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <span
        className="page-nav__label"
        role="status"
        aria-live="polite"
        aria-label={t('onlineClass.board.page.current', { current: current + 1, total: count })}
      >
        {current + 1} / {count}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={disabled || atEnd}
        aria-label={t('onlineClass.board.page.next')}
      >
        <span aria-hidden="true">›</span>
      </button>
      {onAdd && (
        <button
          type="button"
          className="page-nav__add"
          onClick={onAdd}
          disabled={disabled}
          aria-label={t('onlineClass.board.page.add')}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}
    </nav>
  );
}
