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
  googleDriveTrialTranscriptFolderId: string | null;
}

export interface StudentListItem extends User {
  invitationToken: string | null;
  googleDriveFolderUrl: string | null;
  googleDriveHomeworkFolderId: string | null;
  googleDriveTranscriptFolderId: string | null;
  chatGptProjectUrl: string | null;
  parentId: string | null;
  parentFullName: string | null;
  parentEmail: string | null;
  parentStatus: UserStatus | null;
  parentInvitationToken: string | null;
}

export interface StudentGroup {
  id: string;
  name: string;
  googleDriveTranscriptFolderId: string | null;
  students: User[];
}

export interface GroupLesson {
  eventId: string;
  bindingKey: string;
  groupId: string | null;
  groupName: string | null;
  studentId: string | null;
  studentName: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  meetUrl: string | null;
  calendarUrl: string | null;
}

export interface LessonPreparation {
  eventId: string;
  homeworkNotes: string | null;
  difficulties: string | null;
  lessonPlan: string | null;
  hasWorkbook: boolean;
  workbookFilename: string | null;
  hasAnswers: boolean;
  answersFilename: string | null;
  answersUploadHint?: string | null;
}

export interface GoogleCalendarConnection {
  connected: boolean;
  authorizationUrl: string | null;
}

export interface GoogleMeetEventStatus {
  configured: boolean;
  subscribed: boolean;
  lastLeftAt: string | null;
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

export interface Card {
  id: string;
  homeworkId: string | null;
  question: string;
  correctAnswer: string;
  wrongAnswer1: string | null;
  wrongAnswer2: string | null;
  wrongAnswer3: string | null;
  status: CardStatus;
  nextReviewOn: string | null;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  mistakes: number;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedCard {
  question: string;
  correctAnswer: string;
  wrongAnswer1?: string | null;
  wrongAnswer2?: string | null;
  wrongAnswer3?: string | null;
}

export interface ImportPreview {
  cards: ParsedCard[];
  warnings: string[];
}

export interface HomeworkPageOverlay {
  pageIndex: number;
  imageDataUrl: string;
}

export interface Homework {
  id: string;
  studentId: string;
  startDate: string;
  status: HomeworkStatus;
  hasWorksheet: boolean;
  worksheetFilename: string | null;
  submitted: boolean;
  submissionFilename: string | null;
  createdAt: string;
}

export interface CardSummary {
  total: number;
  active: number;
  learned: number;
  dueNow: number;
  awaitingRepetition: number;
}

export interface DailyReviewHistoryAnswer {
  cardId: string;
  question: string;
  correct: boolean;
  selectedAnswer: string | null;
  correctAnswer: string | null;
}

export interface DailyReviewHistoryItem {
  date: string;
  dueCount: number;
  reviewedCount: number;
  correctCount: number;
  wrongCount: number;
  status: DailyReviewStatus;
  answers: DailyReviewHistoryAnswer[];
}

export interface PilotDueCardResult {
  cardId: string;
  nextReviewOn: string;
  status: CardStatus;
}

export interface TestReviewReminderResult {
  studentId: string;
  dueCount: number;
  sent: boolean;
}

export interface Today {
  date: string;
  dueCards: number;
  availableHomeworks: number;
}

export interface Session {
  id: string;
  type: SessionType;
  status: SessionStatus;
  homeworkId: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface Question {
  cardId: string;
  question: string;
  options: string[];
}

export interface AnswerResult {
  correct: boolean;
  correctAnswer: string;
  completed: boolean;
}

export interface SessionResult {
  sessionId: string;
  reviewed: number;
  correct: number;
  wrong: number;
  percent: number;
  elapsedSeconds: number;
}
