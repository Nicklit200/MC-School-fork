import { getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export type SchoolPromptSettings = {
  groupLessonPrompt: string;
  individualLessonPrompt: string;
  updatedAt: string | null;
};

async function promptRequest<T>(method: string, body?: unknown): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}/school-prompts`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(payload?.message ?? response.statusText);
  return payload as T;
}

export const promptSettingsApi = {
  get: () => promptRequest<SchoolPromptSettings>('GET'),
  update: (groupLessonPrompt: string, individualLessonPrompt: string) =>
    promptRequest<SchoolPromptSettings>('PUT', { groupLessonPrompt, individualLessonPrompt }),
};
