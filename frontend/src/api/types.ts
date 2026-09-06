// TypeScript mirrors of the backend DTOs. Keep these in sync with the Java records.

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
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
  username: string | null;
  role: Role;
  status: UserStatus;
  preferredLanguage: Language;
}

export interface StudentListItem extends User {
  invitationToken: string | null;
  googleDriveFolderUrl: string | null;
  googleDriveHomeworkFolderId: string | null;
  parentId: string | null;
  parentFullName: string | null;
  parentEmail: string | null;
  parentStatus: UserStatus | null;
  parentInvitationToken: string | null;
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

export interface ParentInvitation {
  parent: User;
  invitationToken: string | null;
  invitationExpiresAt: string | null;
}

export interface ParentChildStatus {
  studentId: string;
  studentName: string;
  homeworkAssignedToday: number;
  homeworkCompletedToday: number;
  homeworkOpenToday: number;
  cardsDueToday: number;
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
  correctCount: number;
  incorrectCount: number;
  status: DailyReviewStatus;
  answers: DailyReviewAnswer[];
}

export interface TestReviewReminderResult {
  studentId: string;
  dueCount: number;
  sent: boolean;
}

export interface PilotDueCardResult {
  cardId: string;
  question: string;
  dueDate: string | null;
  repetitionNumber: number;
}

export interface Today {
  dueCount: number;
  hasDueCards: boolean;
  activeSessionId: string | null;
  homeworkCount: number;
  hasHomework: boolean;
}

export interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  totalCards: number;
  completedCards: number;
}

export interface Question {
  cardId: string;
  question: string;
  answers: string[];
}

export interface AnswerResult {
  correct: boolean;
  completedCards: number;
  totalCards: number;
  sessionCompleted: boolean;
}

export interface SessionReviewItem {
  cardId: string;
  question: string;
  selectedAnswer: string | null;
  correctAnswer: string;
  correct: boolean;
}

export interface SessionResult {
  sessionId: string;
  type: SessionType;
  totalCards: number;
  correctCount: number;
  incorrectCount: number;
  items: SessionReviewItem[];
}

export interface ParsedCard {
  question: string;
  correctAnswer: string;
}

export interface ImportPreview {
  cards: ParsedCard[];
  errors: string[];
}
