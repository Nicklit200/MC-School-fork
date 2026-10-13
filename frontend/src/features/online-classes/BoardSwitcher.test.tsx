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
  it('lets a student choose between the shared board and only their own', async () => {
    const onChange = renderSwitcher(false);
    expect(screen.getByRole('button', { name: 'Общая доска' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Моя доска' }));
    expect(onChange).toHaveBeenCalledWith('personal-me');
    // No way to name another student's board from a student's UI.
    expect(screen.queryByText(/Alice|Bob/)).not.toBeInTheDocument();
  });

  it('lets the teacher open any student’s personal board', async () => {
    const onChange = renderSwitcher(true);
    const select = screen.getByRole('combobox');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await userEvent.selectOptions(select, 'personal-u2');
    expect(onChange).toHaveBeenCalledWith('personal-u2');
  });

  it('labels the teacher’s options with the student’s name', () => {
    renderSwitcher(true, 'personal-u1');
    expect(screen.getByRole('option', { name: 'Доска ученика: Alice' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('personal-u1');
  });
});
