import { useI18n } from '../../i18n/I18nContext';
import { SHARED_BOARD_ID, personalBoardId } from './boards';
import type { RosterStudent } from './useStudentRoster';

/**
 * Picks which board is on screen.
 *
 * A student toggles between the shared board and their own. The teacher picks
 * the shared board or any student's personal board; looking at one does not move
 * anyone else, because personal boards take no part in follow mode.
 */
export function BoardSwitcher({
  isHost,
  currentUserId,
  students,
  activeId,
  onChange,
}: {
  isHost: boolean;
  currentUserId: string;
  students: RosterStudent[];
  activeId: string;
  onChange: (boardId: string) => void;
}) {
  const { t } = useI18n();

  if (isHost) {
    return (
      <label className="board-switcher">
        <span className="visually-hidden">{t('onlineClass.board.switch')}</span>
        <select value={activeId} onChange={(event) => onChange(event.target.value)}>
          <option value={SHARED_BOARD_ID}>{t('onlineClass.board.shared')}</option>
          {students.map((student) => (
            <option key={student.userId} value={personalBoardId(student.userId)}>
              {t('onlineClass.board.studentBoard', { name: student.displayName })}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const mine = personalBoardId(currentUserId);
  return (
    <div className="board-switcher" role="group" aria-label={t('onlineClass.board.switch')}>
      {([
        [SHARED_BOARD_ID, 'onlineClass.board.shared'],
        [mine, 'onlineClass.board.mine'],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={activeId === id}
          className={activeId === id ? 'is-active' : undefined}
          onClick={() => onChange(id)}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}
