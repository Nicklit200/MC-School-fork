import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nContext';
import { PageNavigator } from './PageNavigator';

function renderNav(props: Partial<React.ComponentProps<typeof PageNavigator>> = {}) {
  const handlers = { onPrevious: vi.fn(), onNext: vi.fn(), onAdd: vi.fn() };
  render(
    <I18nProvider>
      <PageNavigator current={2} count={24} {...handlers} {...props} />
    </I18nProvider>,
  );
  return handlers;
}

describe('PageNavigator', () => {
  it('shows the current page and total as "3 / 24"', () => {
    renderNav();
    expect(screen.getByRole('status')).toHaveTextContent('3 / 24');
  });

  it('fires previous, next and add', async () => {
    const user = userEvent.setup();
    const handlers = renderNav();
    await user.click(screen.getByRole('button', { name: 'Предыдущая страница' }));
    await user.click(screen.getByRole('button', { name: 'Следующая страница' }));
    await user.click(screen.getByRole('button', { name: 'Добавить страницу' }));
    expect(handlers.onPrevious).toHaveBeenCalledOnce();
    expect(handlers.onNext).toHaveBeenCalledOnce();
    expect(handlers.onAdd).toHaveBeenCalledOnce();
  });

  it('disables the arrows at the ends of the document', () => {
    renderNav({ current: 0 });
    expect(screen.getByRole('button', { name: 'Предыдущая страница' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeEnabled();
  });

  it('disables next on the last page', () => {
    renderNav({ current: 23 });
    expect(screen.getByRole('button', { name: 'Следующая страница' })).toBeDisabled();
  });

  it('makes everything inert when navigation is locked', () => {
    renderNav({ disabled: true });
    for (const name of ['Предыдущая страница', 'Следующая страница', 'Добавить страницу']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('has no add button where pages cannot be added', () => {
    renderNav({ onAdd: undefined });
    expect(screen.queryByRole('button', { name: 'Добавить страницу' })).not.toBeInTheDocument();
  });
});
