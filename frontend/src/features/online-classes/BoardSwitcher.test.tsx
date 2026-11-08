import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { BoardSwitcher } from './BoardSwitcher';

const students = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
];

function renderSwitcher(isHost: boolean, activeId = 'board-1', onChange = vi.fn()) {
  render(
    <I18nProvider>
      <BoardSwitcher isHost={isHost} currentUserId="me" students={students} activeId={activeId} onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

describe('BoardSwitcher', () => {
  it('puts the optional teacher action immediately after All and never renders it to a pupil', () => {
    const props = { currentUserId: 'me', students, activeId: 'board-1', onChange: vi.fn(), teacherAction: <button>Kolyn</button> };
    const view = render(<I18nProvider><BoardSwitcher {...props} isHost /></I18nProvider>);
    const all = screen.getByRole('button', { name: 'Все ученики (2×2)' });
    expect(all.nextElementSibling).toBe(screen.getByRole('button', { name: 'Kolyn' }));
    view.rerender(<I18nProvider><BoardSwitcher {...props} isHost={false} /></I18nProvider>);
    expect(screen.queryByRole('button', { name: 'Kolyn' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
  it('lets a student choose between the shared board and only their own', async () => {
    const onChange = renderSwitcher(false);
    expect(screen.getByRole('button', { name: 'Общая доска' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));
    expect(onChange).toHaveBeenCalledWith('personal-me');
    // No way to name another student's board from a student's UI.
    expect(screen.queryByText(/Alice|Bob/)).not.toBeInTheDocument();
    expect(screen.queryByText('Все ученики (2×2)')).not.toBeInTheDocument();
  });

  it('lets the teacher open any student’s personal board', async () => {
    const onChange = renderSwitcher(true);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Все ученики (2×2)' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Bob' }));
    expect(onChange).toHaveBeenCalledWith('personal-u2');
    await userEvent.click(screen.getByRole('button', { name: 'Все ученики (2×2)' }));
    expect(onChange).toHaveBeenLastCalledWith('all-student-boards');
    await userEvent.click(screen.getByRole('button', { name: 'Общая группа' }));
    expect(onChange).toHaveBeenLastCalledWith('board-1');
  });

  it('labels teacher buttons with each pupil name and marks the selected board', () => {
    renderSwitcher(true, 'personal-u1');
    expect(screen.getByRole('button', { name: 'Доска ученика: Alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Доска ученика: Alice' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Доска ученика: Alice' })).toHaveTextContent('Alice');
  });

  it('always exposes exactly the shared board and My board to a pupil', async () => {
    const onChange = vi.fn();
    render(<I18nProvider><BoardSwitcher isHost={false} currentUserId="me" students={students}
      activeId="personal-me" onChange={onChange} /></I18nProvider>);
    expect(screen.getByRole('button', { name: 'Моя доска' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Персональный лист' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));
    expect(onChange).toHaveBeenCalledWith('personal-me');
    expect(screen.getByRole('button', { name: 'Общая доска' })).toBeInTheDocument();
  });

  it('uses one canonical board button for each assigned pupil before they join', async () => {
    const onChange = vi.fn();
    render(<I18nProvider><BoardSwitcher isHost currentUserId="teacher"
      activeId="board-1" onChange={onChange} students={students} /></I18nProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Доска ученика: Bob' }));
    expect(onChange).toHaveBeenCalledWith('personal-u2');
    expect(screen.getByRole('button', { name: 'Доска ученика: Bob' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });
});
