// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrialAgendaCopyButton } from './TrialAgendaCopyButton';
import { trialInvitationsApi } from '../../api/trialInvitations';

vi.mock('../../api/trialInvitations', () => ({
  trialInvitationsApi: { issue: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(trialInvitationsApi.issue).mockResolvedValue({
    token: 'same-private-token',
    classId: 'class-a',
    expiresAt: '2026-11-12T18:00:00Z',
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('trial card copy action', () => {
  it('copies the original invitation from the preview without navigating', async () => {
    render(<TrialAgendaCopyButton eventId="local-a" de={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку на пробный урок' }));
    await waitFor(() => expect(trialInvitationsApi.issue).toHaveBeenCalledWith('local-a'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      window.location.origin + '/trial/join/same-private-token',
    ));
    expect(await screen.findByText('Ссылка скопирована')).toBeTruthy();
  });

  it('shows selectable URL when clipboard access is blocked', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('blocked'));
    render(<TrialAgendaCopyButton eventId="local-a" de={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку на пробный урок' }));
    expect(await screen.findByRole('textbox', { name: 'Ссылка для ученика' })).toHaveProperty(
      'value', window.location.origin + '/trial/join/same-private-token',
    );
  });
});
