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

export const parentApi = {
  linkToStudent: (studentId: string, fullName: string, email: string) =>
    jsonRequest<ParentInvitation>('POST', `/students/${studentId}/parent`, { fullName, email }),
  children: () => jsonRequest<ParentChildStatus[]>('GET', '/parent/children'),
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
