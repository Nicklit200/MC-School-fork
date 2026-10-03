import { ApiRequestError, getAccessToken } from './client';
import type { LessonPreparation } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

function headers(): Record<string, string> {
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

export type AiPilotStatus = {
  pilot: boolean;
  configured: boolean;
  model: string;
  teacherId: string;
};

export type AiPilotSettings = {
  enabled: boolean;
  preparationTime: string;
  zone: string;
};

export const aiPilotApi = {
  status() {
    return fetch(`${BASE_URL}/ai-pilot/status`, { headers: headers() }).then(parse<AiPilotStatus>);
  },
  settings() {
    return fetch(`${BASE_URL}/ai-pilot/settings`, { headers: headers() }).then(parse<AiPilotSettings>);
  },
  updateSettings(enabled: boolean, preparationTime: string) {
    return fetch(`${BASE_URL}/ai-pilot/settings`, {
      method: 'PUT',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, preparationTime }),
    }).then(parse<AiPilotSettings>);
  },
  prepareLesson(eventId: string) {
    return fetch(`${BASE_URL}/ai-pilot/lessons/${encodeURIComponent(eventId)}/prepare`, {
      method: 'POST',
      headers: headers(),
    }).then(parse<LessonPreparation>);
  },
  analyzeTranscript(eventId: string) {
    return fetch(`${BASE_URL}/ai-pilot/lessons/${encodeURIComponent(eventId)}/analyze`, {
      method: 'POST',
      headers: headers(),
    }).then(parse<LessonPreparation>);
  },
};
