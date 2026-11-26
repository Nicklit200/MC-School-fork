import { getAccessToken } from './client';
import type { ParentAccount, ParentChildStatus, ParentInvitation, Role } from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

async function jsonRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(payload?.message ?? response.statusText);
  }
  return payload as T;
}

async function multipartRequest<T>(path: string, form: FormData): Promise<T> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await response.text();
  let payload: any;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
  if (!response.ok) throw new Error(payload?.message ?? response.statusText);
  return payload as T;
}

async function blobRequest(path: string): Promise<Blob> {
  const token = getAccessToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const text = await response.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
    throw new Error(payload?.message ?? response.statusText);
  }
  return response.blob();
}

export interface ParentTeacherMessage {
  id: string;
  studentId: string;
  senderId: string;
  senderName: string;
  senderRole: Role;
  text: string | null;
  hasImage: boolean;
  imageFilename: string | null;
  createdAt: string;
}

export interface ParentSkillEvidence {
  skillId: string; skillTitle: string; previous: number | null; current: number | null;
  autonomy: string; explanation: string; excerpt: string | null;
  origin: string; changed: boolean;
}
export interface ParentSkillPractice extends ParentSkillEvidence {
  sourceType: 'HOMEWORK' | 'TEST' | 'TEACHER_OBSERVATION'; sourceRef: string; at: string; cycleLessonId: string | null;
}
export interface ParentSkillsDashboard {
  studentId: string; studentName: string; grade: number | null; schoolType: string | null;
  boardId: string | null; boardTitle: string | null; curriculumSource: string | null;
  confirmedPercent: number | null; assessedAveragePercent: number | null;
  assessedSkills: number; totalSkills: number; updatedAt: string | null;
  topics: { id: string; title: string; totalSkills: number; assessedSkills: number; averagePercent: number | null; confirmedPercent: number }[];
  skills: { id: string; title: string; germanTitle: string | null; topicId: string | null; mastery: number | null; updatedAt: string | null }[];
  trend: { at: string; confirmedPercent: number; assessedSkills: number; skillId: string; previous: number; current: number }[];
  lessonProgress: { lessonId: string; lessonTitle: string; endedAt: string; confirmedPercent: number | null; assessedSkills: number; changes: { skillId: string; skillTitle: string; previous: number | null; current: number; changedAt: string; sourceType: string; explanation: string; excerpt: string | null }[] }[];
  lessons: { id: string; title: string; endedAt: string; reviewState: string; summary: string | null; summarySource: string; evidence: ParentSkillEvidence[]; observations: { topic: string; outcome: 'PRACTICED' | 'INDEPENDENT' | 'WITH_HELP' | 'DIFFICULTY'; explanation: string; excerpt: string }[] }[];
  practice: ParentSkillPractice[];
}

export const parentApi = {
  linkToStudent: (studentId: string, fullName: string, email: string) =>
    jsonRequest<ParentInvitation>('POST', `/students/${studentId}/parent`, { fullName, email }),
  children: () => jsonRequest<ParentChildStatus[]>('GET', '/parent/children'),
  skills: (studentId: string) => jsonRequest<ParentSkillsDashboard>('GET', `/parent/children/${encodeURIComponent(studentId)}/skills`),
};

export const teacherParentApi = {
  list: () => jsonRequest<ParentAccount[]>('GET', '/parents'),
  create: (fullName: string, password: string) =>
    jsonRequest<ParentAccount>('POST', '/parents', { fullName, password }),
  linkStudent: (parentId: string, studentId: string) =>
    jsonRequest<ParentAccount>('POST', `/parents/${parentId}/students/${studentId}`),
  changePassword: (parentId: string, password: string) =>
    jsonRequest<ParentAccount>('PUT', `/parents/${parentId}/password`, { password }),
};

export const parentChatApi = {
  list: (studentId: string) =>
    jsonRequest<ParentTeacherMessage[]>('GET', `/students/${studentId}/messages`),
  send: (studentId: string, text: string, image?: File | null) => {
    const form = new FormData();
    if (text.trim()) form.append('text', text.trim());
    if (image) form.append('image', image);
    return multipartRequest<ParentTeacherMessage>(`/students/${studentId}/messages`, form);
  },
  image: (messageId: string) => blobRequest(`/messages/${messageId}/image`),
};
