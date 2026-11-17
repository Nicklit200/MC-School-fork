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

export type OwnerWorkbookStatus = {
  enabled: boolean;
  eventId: string;
  state: 'NOT_STARTED' | 'NOT_ELIGIBLE' | 'ALREADY_ATTACHED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  updatedAt?: string;
};

export const aiPilotApi = {
  workbookStatus(eventId: string) {
    return fetch(`${BASE_URL}/ai-pilot/lessons/${encodeURIComponent(eventId)}/workbook-status`, {
      headers: headers(),
    }).then(parse<OwnerWorkbookStatus>);
  },
  generateWorkbook(eventId: string) {
    return fetch(`${BASE_URL}/ai-pilot/lessons/${encodeURIComponent(eventId)}/generate-workbook`, {
      method: 'POST', headers: headers(),
    }).then(parse<OwnerWorkbookStatus>);
  },
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
