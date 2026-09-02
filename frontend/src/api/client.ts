import type {
  AnswerResult,
  AuthResponse,
  Card,
  CardSummary,
  DailyReviewHistoryItem,
  Homework,
  HomeworkPageOverlay,
  ImportPreview,
  Language,
  PilotDueCardResult,
  ParsedCard,
  Question,
  Session,
  SessionResult,
  SessionType,
  StudentGroup,
  StudentListItem,
  StudentInvitation,
  TestReviewReminderResult,
  TeacherInvitation,
  Today,
  User,
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

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
  if (token) localStorage.setItem('accessToken', token);
  else localStorage.removeItem('accessToken');
}

export function getAccessToken(): string | null {
  return accessToken;
}

function authHeaders(): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const code = payload?.errorCode ?? 'UNKNOWN';
    const message = payload?.message ?? response.statusText;
    throw new ApiRequestError(response.status, code, message);
  }
  return payload as T;
}

async function uploadFile(path: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!response.ok) {
    const text = await response.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
    throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  }
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  if (!response.ok) {
    const text = await response.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
    throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  }
  return response.blob();
}

async function requestText(path: string): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
  const text = await response.text();
  if (!response.ok) {
    let payload: any;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
    throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
  }
  return text;
}

export const api = {
  auth: {
    login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
    activate: (invitationToken: string, password: string) => request<AuthResponse>('POST', '/auth/activate', { invitationToken, password }),
    me: () => request<User>('GET', '/auth/me'),
  },
  users: {
    updateLanguage: (preferredLanguage: Language) => request<User>('PUT', '/users/me/settings', { preferredLanguage }),
  },
  push: {
    config: () => request<{ enabled: boolean; publicKey: string }>('GET', '/push/config'),
    subscribe: (subscription: { endpoint: string; p256dh: string; auth: string }) =>
      request<void>('POST', '/push/subscriptions', subscription),
    unsubscribe: (subscription: { endpoint: string; p256dh: string; auth: string }) =>
      request<void>('DELETE', '/push/subscriptions', subscription),
    test: () => request<void>('POST', '/push/test'),
  },
  teachers: {
    list: () => request<User[]>('GET', '/teachers'),
    create: (fullName: string, email: string) => request<TeacherInvitation>('POST', '/teachers', { fullName, email }),
  },
  students: {
    list: () => request<StudentListItem[]>('GET', '/students'),
    get: (studentId: string) => request<StudentListItem>('GET', `/students/${studentId}`),
    create: (fullName: string, email: string) => request<StudentInvitation>('POST', '/students', { fullName, email }),
    updateDriveFolder: (studentId: string, googleDriveFolderUrl: string) =>
      request<StudentListItem>('PUT', `/students/${studentId}/drive-folder`, { googleDriveFolderUrl }),
    testDriveFolder: (studentId: string) =>
      request<{ status: string; fileName?: string; fileUrl?: string; message?: string }>('POST', `/students/${studentId}/drive-folder/test`),
    testAutomaticExport: (studentId: string) =>
      request<{ status: string; fileName?: string; fileUrl?: string; message?: string }>('POST', `/students/${studentId}/drive-folder/test-export`),
    reviewHistory: (studentId: string) => request<DailyReviewHistoryItem[]>('GET', `/students/${studentId}/review-history`),
    testReviewReminder: (studentId: string) => request<TestReviewReminderResult>('POST', `/students/${studentId}/test-review-reminder`),
    makeOneCardDueToday: (studentId: string) => request<PilotDueCardResult>('POST', `/students/${studentId}/make-one-card-due-today`),
    remove: (studentId: string) => request<void>('DELETE', `/students/${studentId}`),
  },
  groups: {
    list: () => request<StudentGroup[]>('GET', '/groups'),
    get: (groupId: string) => request<StudentGroup>('GET', `/groups/${groupId}`),
    create: (name: string, emails: string[]) => request<StudentGroup>('POST', '/groups', { name, emails }),
    addMembers: (groupId: string, emails: string[]) => request<StudentGroup>('POST', `/groups/${groupId}/members`, { emails }),
    createCard: (groupId: string, startDate: string, question: string, correctAnswer: string) =>
      request<number>('POST', `/groups/${groupId}/cards`, { startDate, question, correctAnswer }),
    importCards: (groupId: string, startDate: string, cards: ParsedCard[]) =>
      request<number>('POST', `/groups/${groupId}/cards/import`, { startDate, cards }),
  },
  cards: {
    listForStudent: (studentId: string) => request<Card[]>('GET', `/students/${studentId}/cards`),
    summaryForStudent: (studentId: string) => request<CardSummary>('GET', `/students/${studentId}/cards/summary`),
    update: (cardId: string, question: string, correctAnswer: string) => request<Card>('PUT', `/cards/${cardId}`, { question, correctAnswer }),
    remove: (cardId: string) => request<void>('DELETE', `/cards/${cardId}`),
    importPreview: (rawText: string, questionAnswerSeparator: string, cardSeparator: string) =>
      request<ImportPreview>('POST', '/cards/import/preview', { rawText, questionAnswerSeparator, cardSeparator }),
    listForHomework: (homeworkId: string) => request<Card[]>('GET', `/homeworks/${homeworkId}/cards`),
    createInHomework: (homeworkId: string, question: string, correctAnswer: string) =>
      request<Card>('POST', `/homeworks/${homeworkId}/cards`, { question, correctAnswer }),
    importConfirmInHomework: (homeworkId: string, cards: ParsedCard[]) =>
      request<Card[]>('POST', `/homeworks/${homeworkId}/cards/import`, { cards }),
  },
  homeworks: {
    listForStudent: (studentId: string) => request<Homework[]>('GET', `/students/${studentId}/homeworks`),
    create: (studentId: string, startDate: string) => request<Homework>('POST', `/students/${studentId}/homeworks`, { startDate }),
    uploadWorksheet: (homeworkId: string, file: File) => uploadFile(`/homeworks/${homeworkId}/worksheet`, file),
    submission: (homeworkId: string) => requestBlob(`/homeworks/${homeworkId}/submission`),
  },
  study: {
    today: () => request<Today>('GET', '/study/today'),
    homeworks: () => request<Homework[]>('GET', '/study/homeworks'),
    homeworkCards: (homeworkId: string) => request<Card[]>('GET', `/study/homeworks/${homeworkId}/cards`),
    worksheetPage: (homeworkId: string, pageIndex: number) => requestBlob(`/study/homeworks/${homeworkId}/worksheet/pages/${pageIndex}`),
    worksheetPageDataUrl: (homeworkId: string, pageIndex: number) => requestText(`/study/homeworks/${homeworkId}/worksheet/pages/${pageIndex}/data-url`),
    submitPdfHomework: (homeworkId: string, overlays: HomeworkPageOverlay[]) =>
      request<void>('POST', `/study/homeworks/${homeworkId}/submit-pdf`, { overlays }),
    myCards: () => request<Card[]>('GET', '/study/cards'),
    startSession: (type: SessionType, homeworkId?: string) =>
      request<Session>('POST', '/study/sessions', homeworkId ? { type, homeworkId } : { type }),
    getSession: (sessionId: string) => request<Session>('GET', `/study/sessions/${sessionId}`),
    currentQuestion: (sessionId: string) => request<Question>('GET', `/study/sessions/${sessionId}/current-question`),
    answer: (sessionId: string, cardId: string, selectedAnswer: string) =>
      request<AnswerResult>('POST', `/study/sessions/${sessionId}/answer`, { cardId, selectedAnswer }),
    result: (sessionId: string) => request<SessionResult>('GET', `/study/sessions/${sessionId}/result`),
  },
};
