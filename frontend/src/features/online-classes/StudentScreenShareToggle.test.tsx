import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineClassesApi } from '../../api/onlineClasses';
import { I18nProvider } from '../../i18n/I18nContext';
import { StudentScreenShareToggle } from './StudentScreenShareToggle';

vi.mock('../../api/onlineClasses', async () => {
  const actual = await vi.importActual<typeof import('../../api/onlineClasses')>('../../api/onlineClasses');
  return { ...actual, onlineClassesApi: { setStudentScreenShare: vi.fn() } };
});

const api = vi.mocked(onlineClassesApi);

function mount(initiallyEnabled: boolean) {
  render(
    <I18nProvider>
      <StudentScreenShareToggle classId="c1" initiallyEnabled={initiallyEnabled} />
    </I18nProvider>,
  );
}

describe('StudentScreenShareToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.setStudentScreenShare.mockResolvedValue(undefined);
  });

  it('starts off and turns student sharing on for the class', async () => {
    mount(false);
    const button = screen.getByRole('button', { name: 'Разрешить ученикам показывать экран' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);

    expect(api.setStudentScreenShare).toHaveBeenCalledWith('c1', true);
    expect(await screen.findByRole('button', { name: /показывать экран: вкл/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('turns it off again', async () => {
    mount(true);
    await userEvent.click(screen.getByRole('button', { name: /показывать экран: вкл/ }));
    expect(api.setStudentScreenShare).toHaveBeenCalledWith('c1', false);
    expect(await screen.findByRole('button', { name: 'Разрешить ученикам показывать экран' })).toBeInTheDocument();
  });

  it('keeps its state and says so when the change fails', async () => {
    api.setStudentScreenShare.mockRejectedValue(new Error('nope'));
    mount(false);
    await userEvent.click(screen.getByRole('button', { name: 'Разрешить ученикам показывать экран' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить разрешение');
    expect(screen.getByRole('button', { name: 'Разрешить ученикам показывать экран' })).toHaveAttribute('aria-pressed', 'false');
  });
});
