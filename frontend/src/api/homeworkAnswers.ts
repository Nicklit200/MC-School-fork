import { ApiRequestError, getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export interface HomeworkFinalAnswer {
  label: string;
  answer: string;
}

export interface HomeworkFinalAnswerResultItem {
  label: string;
  correct: boolean;
}

export interface HomeworkFinalAnswersResult {
  correctCount: number;
  totalCount: number;
  allCorrect: boolean;
  items: HomeworkFinalAnswerResultItem[];
}

export async function saveHomeworkFinalAnswers(homeworkId: string, answers: HomeworkFinalAnswer[]): Promise<HomeworkFinalAnswersResult> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}/study/homeworks/${homeworkId}/final-answers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ answers }),
  });

  if (response.ok) return response.json() as Promise<HomeworkFinalAnswersResult>;
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
  throw new ApiRequestError(
    response.status,
    payload?.errorCode ?? 'UNKNOWN',
    payload?.message ?? response.statusText,
  );
}
