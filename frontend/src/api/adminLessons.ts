import type { GroupLesson, LessonPreparation } from './types';
import { ApiRequestError, getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
  if (!response.ok) throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  return payload as T;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
  if (!response.ok) throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  return payload as T;
}

async function blob(path: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!response.ok) {
    const text = await response.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
    throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  }
  return response.blob();
}

function root(teacherId: string) {
  return `/admin/teachers/${teacherId}`;
}

export const adminLessonsApi = {
  list: (teacherId: string) => request<GroupLesson[]>('GET', `${root(teacherId)}/lessons`),
  getPreparation: (teacherId: string, eventId: string) => request<LessonPreparation>('GET', `${root(teacherId)}/lesson-preparations/${encodeURIComponent(eventId)}`),
  updatePreparation: (teacherId: string, eventId: string, body: { homeworkNotes: string; difficulties: string; lessonPlan: string }) => request<LessonPreparation>('PUT', `${root(teacherId)}/lesson-preparations/${encodeURIComponent(eventId)}`, body),
  uploadWorkbook: (teacherId: string, eventId: string, file: File) => upload<LessonPreparation>(`${root(teacherId)}/lesson-preparations/${encodeURIComponent(eventId)}/workbook`, file),
  uploadAnswers: (teacherId: string, eventId: string, file: File) => upload<LessonPreparation>(`${root(teacherId)}/lesson-preparations/${encodeURIComponent(eventId)}/answers`, file),
  workbook: (teacherId: string, eventId: string) => blob(`${root(teacherId)}/lesson-preparations/${encodeURIComponent(eventId)}/workbook`),
  answers: (teacherId: string, eventId: string) => blob(`${root(teacherId)}/lesson-preparations/${encodeURIComponent(eventId)}/answers`),
};
