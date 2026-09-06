import { ApiRequestError, getAccessToken } from './client';
import type { LessonPreparation } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
  if (!response.ok) throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  return payload as T;
}

export const lessonPreparationApi = {
  get(eventId: string) {
    return fetch(`${BASE_URL}/lesson-preparations/${encodeURIComponent(eventId)}`, { headers: authHeaders() }).then(parse<LessonPreparation>);
  },
  update(eventId: string, payload: { homeworkNotes: string; difficulties: string; lessonPlan: string }) {
    return fetch(`${BASE_URL}/lesson-preparations/${encodeURIComponent(eventId)}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(parse<LessonPreparation>);
  },
  uploadWorkbook(eventId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${BASE_URL}/lesson-preparations/${encodeURIComponent(eventId)}/workbook`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    }).then(parse<LessonPreparation>);
  },
  async workbookUrl(eventId: string) {
    const response = await fetch(`${BASE_URL}/lesson-preparations/${encodeURIComponent(eventId)}/workbook`, { headers: authHeaders() });
    if (!response.ok) throw new ApiRequestError(response.status, 'WORKBOOK', response.statusText);
    return URL.createObjectURL(await response.blob());
  },
};
