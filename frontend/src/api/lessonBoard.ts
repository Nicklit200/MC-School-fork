import { getAccessToken } from './client';

export interface BoardPoint {
  x: number;
  y: number;
}

export type BoardAction = {
  kind: 'STROKE' | 'ERASE' | 'TEXT' | 'CLEAR' | 'UNDO';
  points?: BoardPoint[];
  x?: number;
  y?: number;
  text?: string;
  color?: string;
  width?: number;
  targetId?: number;
};

export interface BoardOperation {
  id: number;
  kind: string;
  payload: string;
  actorId: string;
  createdAt: string;
}

export interface BoardSnapshot {
  title: string;
  eventId: string;
  teacher: boolean;
  meetUrl: string | null;
  operations: BoardOperation[];
}

const ROOT = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

async function request<T>(method: string, eventId: string, suffix = '', data?: unknown): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(
    `${ROOT}/lesson-board/${encodeURIComponent(eventId)}${suffix}`,
    {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    },
  );
  if (!response.ok) {
    if (response.status === 403) throw new Error('Доступ к тестовой доске пока закрыт.');
    if (response.status === 404) throw new Error('Доска недоступна: урок не найден или ещё не открыт преподавателем.');
    throw new Error(`Не удалось связаться с доской (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export const lessonBoardApi = {
  start: (eventId: string) => request<BoardSnapshot>('POST', eventId, '/start'),
  read: (eventId: string, after: number) =>
    request<BoardSnapshot>('GET', eventId, `?after=${after}`),
  append: (eventId: string, action: BoardAction) =>
    request<BoardOperation>('POST', eventId, '/actions', action),
};
