import { getAccessToken } from './client';
import type { ParentChildStatus, ParentInvitation } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

async function jsonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(payload?.message ?? response.statusText);
  }
  return payload as T;
}

export const parentApi = {
  linkToStudent: (studentId: string, fullName: string, email: string) =>
    jsonRequest<ParentInvitation>('POST', `/students/${studentId}/parent`, { fullName, email }),
  children: () => jsonRequest<ParentChildStatus[]>('GET', '/parent/children'),
};
