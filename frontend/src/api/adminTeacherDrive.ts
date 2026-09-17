import type { User } from './types';
import { ApiRequestError, getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export async function updateTeacherTrialTranscriptFolder(teacherId: string, folderId: string): Promise<User> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}/teachers/${teacherId}/trial-transcript-drive-folder`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ folderId }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  }
  return payload as User;
}
