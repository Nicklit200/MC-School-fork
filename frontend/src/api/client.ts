import type {
  AnswerResult,
  AuthResponse,
  Card,
  CardSummary,
  ImportPreview,
  Language,
  ParsedCard,
  Question,
  ReviewSessionHistory,
  Session,
  SessionResult,
  SessionType,
  StudentInvitation,
  TeacherInvitation,
  Today,
  User,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

/** An API call that failed; carries the backend error code so the UI can localise it. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

let accessToken: string | null = localStorage.getItem('accessToken');

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) {
    localStorage.setItem('accessToken', token);
  } else {
    localStorage.removeItem('accessToken');
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const code = payload?.errorCode ?? 'UNKNOWN';
    const message = payload?.message ?? response.statusText;
    throw new ApiRequestError(response.status, code, message);
  }
  return payload as T;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<AuthResponse>('POST', '/auth/login', { email, password }),
    activate: (invitationToken: string, password: string) =>
      request<AuthResponse>('POST', '/auth/activate', { invitationToken, password }),
    me: () => request<User>('GET', '/auth/me'),
  },
  users: {
    updateLanguage: (preferredLanguage: Language) =>
      request<User>('PUT', '/users/me/settings', { preferredLanguage }),
  },
  teachers: {
    list: () => request<User[]>('GET', '/teachers'),
    create: (fullName: string, email: string) =>
      request<TeacherInvitation>('POST', '/teachers', { fullName, email }),
  },
  students: {
    list: () => request<User[]>('GET', '/students'),
    create: (fullName: string, email: string) =>
      request<StudentInvitation>('POST', '/students', { fullName, email }),
    reviewHistory: (studentId: string) =>
      request<ReviewSessionHistory[]>('GET', `/students/${studentId}/review-history`),
  },
  cards: {
    listForStudent: (studentId: string) =>
      request<Card[]>('GET', `/students/${studentId}/cards`),
    summaryForStudent: (studentId: string) =>
      request<CardSummary>('GET', `/students/${studentId}/cards/summary`),
    create: (studentId: string, question: string, correctAnswer: string) =>
      request<Card>('POST', `/students/${studentId}/cards`, { question, correctAnswer }),
    update: (cardId: string, question: string, correctAnswer: string) =>
      request<Card>('PUT', `/cards/${cardId}`, { question, correctAnswer }),
    remove: (cardId: string) => request<void>('DELETE', `/cards/${cardId}`),
    importPreview: (rawText: string, questionAnswerSeparator: string, cardSeparator: string) =>
      request<ImportPreview>('POST', '/cards/import/preview', {
        rawText,
        questionAnswerSeparator,
        cardSeparator,
      }),
    importConfirm: (studentId: string, cards: ParsedCard[]) =>
      request<Card[]>('POST', `/students/${studentId}/cards/import`, { cards }),
  },
  study: {
    today: () => request<Today>('GET', '/study/today'),
    myCards: () => request<Card[]>('GET', '/study/cards'),
    startSession: (type: SessionType) =>
      request<Session>('POST', '/study/sessions', { type }),
    getSession: (sessionId: string) => request<Session>('GET', `/study/sessions/${sessionId}`),
    currentQuestion: (sessionId: string) =>
      request<Question>('GET', `/study/sessions/${sessionId}/current-question`),
    answer: (sessionId: string, cardId: string, selectedAnswer: string) =>
      request<AnswerResult>('POST', `/study/sessions/${sessionId}/answer`, {
        cardId,
        selectedAnswer,
      }),
    result: (sessionId: string) =>
      request<SessionResult>('GET', `/study/sessions/${sessionId}/result`),
  },
};
