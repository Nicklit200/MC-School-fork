// TypeScript mirrors of the backend DTOs. Keep these in sync with the Java records.

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'INACTIVE';
export type Language = 'DE' | 'RU';
export type CardStatus = 'ACTIVE' | 'LEARNED';
export type HomeworkStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED';
export type SessionType = 'SCHEDULED' | 'PRACTICE';
export type SessionStatus = 'IN_PROGRESS' | 'COMPLETED';
export type DailyReviewStatus = 'COMPLETED' | 'PARTIAL' | 'MISSED';

export interface User { id: string; fullName: string; email: string | null; username: string | null; role: Role; status: UserStatus; preferredLanguage: Language; googleDriveTrialTranscriptFolderId: string | null; }
export interface AdminAccount extends User { teacherId: string | null; teacherFullName: string | null; }
export interface TeacherAssignmentOption { id: string; fullName: string; status: UserStatus; archived: boolean; }
export interface StudentTransferResponse { student: AdminAccount; copiedFutureLessons: number; transferredGroups: number; futureGroupLessonsNotTransferred: number; }
export interface TransferStudentsResponse { fromTeacherId: string; fromTeacherName: string; toTeacherId: string; toTeacherName: string; transferredStudents: number; transferredGroups: number; copiedFutureLessons: number; groupsWithLessonsNotTransferred: number; }
export interface StudentLessonHistoryDocument { id: string; boardId: string; filename: string; savedAt: string; }
export interface StudentLessonHistoryItem { sourceTeacherId: string; sourceTeacherName: string; eventId: string; title: string; groupName: string | null; startsAt: string; endsAt: string; hasWorkbook: boolean; hasAnswers: boolean; hasTranscript: boolean; }
export interface StudentLessonHistoryDetail extends StudentLessonHistoryItem { homeworkNotes: string | null; difficulties: string | null; lessonPlan: string | null; coveredMaterial: string | null; transcriptText: string | null; transcriptFilename: string | null; workbookFilename: string | null; answersFilename: string | null; }
export type SchoolType = 'GYMNASIUM' | 'REALSCHULE' | 'MITTELSCHULE' | 'WIRTSCHAFTSSCHULE' | 'FACHOBERSCHULE' | 'GESAMTSCHULE' | 'WERKREALSCHULE' | 'OTHER';
export type LearningPace = 'SLOW' | 'NORMAL' | 'FAST';
export interface StudentListItem extends User { invitationToken: string | null; googleDriveFolderUrl: string | null; googleDriveHomeworkFolderId: string | null; googleDriveTranscriptFolderId: string | null; chatGptProjectUrl: string | null; grade: number | null; schoolType: SchoolType | null; learningPace: LearningPace | null; learningStrengths: string | null; learningDifficulties: string | null; explanationStyle: string | null; learningNotes: string | null; parentId: string | null; parentFullName: string | null; parentEmail: string | null; parentStatus: UserStatus | null; parentInvitationToken: string | null; }
export interface StudentLearningProfileUpdate { grade: number | null; schoolType: SchoolType | null; learningPace: LearningPace | null; learningStrengths: string; learningDifficulties: string; explanationStyle: string; learningNotes: string; }
export interface StudentGroup { id: string; name: string; googleDriveTranscriptFolderId: string | null; students: User[]; }
export interface CreateLessonSeriesRequest { title: string; startDate: string; startTime: string; durationMinutes: number; period: 'TWO_WEEKS' | 'THREE_WEEKS' | 'MONTH'; weekdays: number[]; groupId: string | null; studentId: string | null; }
export interface CreateLessonRequest { title: string; startsAt: string; endsAt: string; groupId: string | null; studentId: string | null; }
export interface GroupLesson { eventId: string; bindingKey: string; groupId: string | null; groupName: string | null; studentId: string | null; studentName: string | null; participantStudentIds: string[]; title: string; startsAt: string; endsAt: string; meetUrl: string | null; calendarUrl: string | null; }
export interface StudentLesson { eventId: string; title: string; groupName: string | null; startsAt: string; endsAt: string; meetUrl: string | null; hasSharedDocument: boolean; sharedDocumentFilename: string | null; }
export interface LessonPreparation { eventId: string; coveredMaterial?: string | null; homeworkNotes: string | null; difficulties: string | null; lessonPlan: string | null; transcriptText: string | null; hasTranscript: boolean; transcriptFilename: string | null; hasWorkbook: boolean; workbookFilename: string | null; hasAnswers: boolean; answersFilename: string | null; answersUploadHint?: string | null; siteOpenedAt?: string | null; }
export interface GoogleCalendarConnection { connected: boolean; authorizationUrl: string | null; }
export interface GoogleMeetEventStatus { configured: boolean; subscribed: boolean; lastLeftAt: string | null; }
export interface AuthResponse { accessToken: string; tokenType: string; expiresAt: string; user: User; }
export interface TeacherInvitation { teacher: User; invitationToken: string; invitationExpiresAt: string; }
export interface StudentInvitation { student: User; invitationToken: string; invitationExpiresAt: string; }
export interface ParentInvitation { parent: User; invitationToken: string | null; invitationExpiresAt: string | null; }
export interface ParentHomeworkStatus { homeworkId: string; startDate: string; hasWorksheet: boolean; filename: string | null; submitted: boolean; submittedAt: string | null; deadlineAt: string; overdue: boolean; submittedLate: boolean; totalCards: number; learnedCards: number; }
export interface ParentChildStatus { studentId: string; studentName: string; homeworkAssignedToday: number; homeworkCompletedToday: number; homeworkOpenToday: number; cardsDueToday: number; homeworks: ParentHomeworkStatus[]; }
export interface ParentAccountChild { id: string; fullName: string; }
export interface ParentAccount { id: string; fullName: string; username: string | null; email: string | null; status: UserStatus; children: ParentAccountChild[]; }
export interface ParentCredentials { parent: User; temporaryPassword: string; }
export interface Card { id: string; homeworkId: string; question: string; correctAnswer: string; status: CardStatus; repetitionNumber: number; dueDate: string | null; timeLimitSeconds: number | null; }
export interface Homework { id: string; studentId: string; startDate: string; createdAt: string; totalCards: number; notStarted: number; inProgress: number; learned: number; status: HomeworkStatus; hasWorksheet: boolean; worksheetFilename: string | null; worksheetPageCount: number | null; submitted: boolean; submittedAt: string | null; deadlineAt: string; overdue: boolean; submittedLate: boolean; }
export interface HomeworkPageOverlay { pageIndex: number; imageBase64: string; }
export interface CardSummary { total: number; dueNow: number; awaitingRepetition: number; learned: number; }
export interface DailyReviewAnswer { cardId: string; question: string; selectedAnswer: string | null; correctAnswer: string; correct: boolean; }
export interface DailyReviewHistoryItem { date: string; dueCount: number; completedCount: number; status: DailyReviewStatus; answers: DailyReviewAnswer[]; }
export interface TestReviewReminderResult { studentId: string; dueCount: number; reminderAttempted: boolean; }
export interface PilotDueCardResult { id: string; question: string; dueDate: string; }
export interface ParsedCard { question: string; correctAnswer: string; wrongAnswer1: string; wrongAnswer2: string; wrongAnswer3: string; timeLimitSeconds: number | null; }
export interface ImportPreview { cards: ParsedCard[]; warnings: string[]; }
export interface Today { totalCards: number; dueCardCount: number; learnedCount: number; minCardsToStart: number; canStartScheduled: boolean; canPractice: boolean; inProgressSessionId: string | null; }
export interface Session { id: string; sessionType: SessionType; status: SessionStatus; totalCards: number; answeredCards: number; }
export interface Question { cardId: string; question: string; options: string[]; answeredCount: number; totalCards: number; timeLimitSeconds: number | null; }
export interface AnswerResult { correct: boolean; correctAnswer: string; sessionCompleted: boolean; remaining: number; }
export interface SessionReviewItem { cardId: string; question: string; selectedAnswer: string | null; correctAnswer: string; correct: boolean; }
export interface SessionResult { type: SessionType; totalCards: number; correctFirstTry: number; nextReviewDate: string | null; review: SessionReviewItem[]; }


export interface MonthlyPlanResponse {
  id: string | null;
  targetType: 'STUDENT' | 'GROUP';
  targetId: string;
  month: string;
  planJson: string;
  hasDocument: boolean;
  documentFilename: string | null;
  version: number;
  updatedAt: string | null;
}

export interface StudentTimeSummary {studentId:string;studentName:string;cardSeconds:number;homeworkSeconds:number;cardSessions:number;homeworkAssignments:number;activeDays:number;lastActivityAt:string|null}
export interface StudentTimeDetail {kind:'CARDS'|'HOMEWORK';referenceId:string;seconds:number;label:string;lastActivityAt:string|null;completedAt:string|null}
export interface StudentTimeReport {summary:StudentTimeSummary;details:StudentTimeDetail[]}
