import { request } from './client';

export type SchoolAssessmentKind = 'KLASSENARBEIT'|'TEST'|'EXAM'|'QUIZ'|'OTHER';
export type AssessmentSource = 'TRANSCRIPT'|'STUDENT_REPORTED'|'TEACHER_NOTE'|'VOICE_NOTE'|'SCHOOL_DOCUMENT';
export type ConfirmationStatus = 'REPORTED'|'SCHOOL_CONFIRMED';
export type SchoolAssessment = {
 id:string;teacherId:string;studentId:string;studentName:string;
 examDate:string;kind:SchoolAssessmentKind;title:string;topics:string[];
 notes:string|null;sourceType:AssessmentSource;sourceRef:string|null;
 sourceExcerpt:string|null;confirmationStatus:ConfirmationStatus;revision:number;
 createdAt:string;updatedAt:string;
};
export type SchoolAssessmentDraft = {
 teacherId?:string; studentId:string;examDate:string;kind:SchoolAssessmentKind;
 title:string;topics:string[];notes:string;sourceType:AssessmentSource;
 sourceRef?:string;sourceExcerpt?:string;confirmationStatus:ConfirmationStatus;
};
export const schoolAssessmentsApi = {
 list: ()=>request<SchoolAssessment[]>('GET','/school-assessments'),
 create: (data:SchoolAssessmentDraft,idempotencyKey:string)=>
   request<SchoolAssessment>('POST','/school-assessments',{...data,idempotencyKey}),
 update: (id:string,data:Omit<SchoolAssessmentDraft,'studentId'|'teacherId'> & {expectedRevision:number})=>
   request<SchoolAssessment>('PUT','/school-assessments/'+encodeURIComponent(id),data)
};
