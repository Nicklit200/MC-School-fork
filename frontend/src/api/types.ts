// TypeScript mirrors of the backend DTOs. Keep these in sync with the Java records.

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type UserStatus = 'INVITED' | 'ACTIVE';
export type Language = 'DE' | 'RU';
export type CardStatus = 'ACTIVE' | 'LEARNED';
export type SessionType = 'SCHEDULED' | 'PRACTICE';
export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  status: UserStatus;
  preferredLanguage: Language;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
  user: User;
}

export interface TeacherInvitation {
  teacher: User;
  invitationToken: string;
  invitationExpiresAt: string;
}

export interface StudentInvitation {
  student: User;
  invitationToken: string;
  invitationExpiresAt: string;
}

export interface Card {
  id: string;
  question: string;
  correctAnswer: string;
  status: CardStatus;
  repetitionNumber: number;
  dueDate: string | null;
}

export interface CardSummary {
  total: number;
  dueNow: number;
  awaitingRepetition: number;
  learned: number;
}

export interface ParsedCard {
  question: string;
  correctAnswer: string;
}

export interface ImportPreview {
  cards: ParsedCard[];
  warnings: string[];
}

export interface DriveItem {
  id: string;
  name: string;
}

export interface DriveUploadResult {
  id: string;
  name: string;
  webViewLink: string;
}

export interface Today {
  totalCards: number;
  dueCardCount: number;
  learnedCount: number;
  minCardsToStart: number;
  canStartScheduled: boolean;
  canPractice: boolean;
  inProgressSessionId: string | null;
}

export interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  totalCards: number;
  answeredCount: number;
  remaining: number;
}

export interface Question {
  cardId: string;
  question: string;
  options: string[];
  answeredCount: number;
  totalCards: number;
}

export interface AnswerResult {
  correct: boolean;
  correctAnswer: string;
  sessionCompleted: boolean;
  remaining: number;
}

export interface SessionResult {
  type: SessionType;
  totalCards: number;
  correctFirstTry: number;
  nextReviewDate: string | null;
}

/** Shape of the backend's error body; `errorCode` drives user-facing messages. */
export interface ApiError {
  timestamp: string;
  status: number;
  errorCode: string;
  message: string;
  path: string;
  fieldErrors?: { field: string; message: string }[];
}
