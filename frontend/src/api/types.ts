// TypeScript mirrors of the backend DTOs. Keep these in sync with the Java records.

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';
export type UserStatus = 'INVITED' | 'ACTIVE';
export type Language = 'DE' | 'RU';
export type CardStatus = 'ACTIVE' | 'LEARNED';
export type HomeworkStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';
export type SessionType = 'SCHEDULED' | 'PRACTICE';
export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED';
export type DailyReviewStatus = 'COMPLETED' | 'PARTIAL' | 'MISSED';

export interface User {
  id: string;
  fullName: string;
  email: string | null;
  role: Role;
  status: UserStatus;
  preferredLanguage: Language;
}

export interface StudentListItem extends User {
  invitationToken: string | null;
  googleDriveFolderUrl: string | null;
  googleDriveHomeworkFolderId: string | null;
}

export interface StudentGroup {
  id: string;
  name: string;
  students: User[];
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
  homeworkId: string;
  question: string;
  correctAnswer: string;
  status: CardStatus;
  repetitionNumber: number;
  dueDate: string | null;
}

export interface Homework {
  id: string;
  studentId: string;
  startDate: string;
  createdAt: string;
  totalCards: number;
  notStarted: number;
  inProgress: number;
  learned: number;
  status: HomeworkStatus;
  hasWorksheet: boolean;
  worksheetFilename: string | null;
  worksheetPageCount: number | null;
  submitted: boolean;
  submittedAt: string | null;
}

export interface HomeworkPageOverlay {
  pageIndex: number;
  imageBase64: string;
}

export interface CardSummary {
  total: number;
  dueNow: number;
  awaitingRepetition: number;
  learned: number;
}

export interface DailyReviewAnswer {
  cardId: string;
  question: string;
  selectedAnswer: string | null;
  correctAnswer: string;
  correct: boolean;
}

export interface DailyReviewHistoryItem {
  date: string;
  dueCount: number;
  completedCount: number;
  status: DailyReviewStatus;
  answers: DailyReviewAnswer[];
}

export interface TestReviewReminderResult {
  studentId: string;
  dueCount: number;
  reminderAttempted: boolean;
}

export interface PilotDueCardResult {
  id: string;
  question: string;
  dueDate: string;
}

export interface ParsedCard {
  question: string;
  correctAnswer: string;
  wrongAnswer1: string;
  wrongAnswer2: string;
  wrongAnswer3: string;
}

export interface ImportPreview {
  cards: ParsedCard[];
  warnings: string[];
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
  review: SessionReviewItem[];
}

export interface SessionReviewItem {
  cardId: string;
  question: string;
  selectedAnswer: string;
  correctAnswer: string;
  correct: boolean;
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
