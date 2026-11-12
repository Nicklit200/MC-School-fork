import { request } from './client';
import type { User } from './types';

export interface TrialGuestInvitation {
  title: string;
  startsAt: string;
  endsAt: string;
  canJoin: boolean;
  claimed: boolean;
}

export interface TrialGuestJoined {
  classId: string;
  auth: {
    accessToken: string;
    tokenType: string;
    expiresAt: string;
    user: User;
  };
}

export const trialInvitationsApi = {
  listMine: () => request<string[]>('GET', '/trial-invitations'),
  issue: (eventId: string) =>
    request<{ token: string; classId: string; expiresAt: string }>(
      'POST', '/trial-invitations/' + encodeURIComponent(eventId)),
  revoke: (eventId: string) =>
    request<void>('DELETE', '/trial-invitations/' + encodeURIComponent(eventId)),
  info: (token: string) =>
    request<TrialGuestInvitation>('GET', '/public/trial-invitations/' + encodeURIComponent(token)),
  join: (token: string, name: string) =>
    request<TrialGuestJoined>('POST', '/public/trial-invitations/' + encodeURIComponent(token) + '/join', { name }),
};
