import { getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export type SchoolBrandGuide = {
  guideText: string;
  filename: string | null;
  hasPdf: boolean;
  sizeBytes: number;
  updatedAt: string | null;
};

type UpdateBrandGuidePayload = {
  guideText?: string;
  filename?: string;
  pdfBase64?: string;
};

async function request<T>(method: string, path = '', body?: unknown): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}/school-prompts/brand-guide${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(payload?.message ?? response.statusText);
  return payload as T;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function openPdf(): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}/school-prompts/brand-guide/pdf`, { headers });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const payload = await response.json();
      message = payload?.message ?? message;
    } catch {
      // keep status text
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const brandGuideApi = {
  get: () => request<SchoolBrandGuide>('GET'),
  updateText: (guideText: string) => request<SchoolBrandGuide>('PUT', '', { guideText }),
  uploadPdf: async (file: File, guideText?: string) => {
    const pdfBase64 = await fileToBase64(file);
    const payload: UpdateBrandGuidePayload = { filename: file.name, pdfBase64 };
    if (guideText !== undefined) payload.guideText = guideText;
    return request<SchoolBrandGuide>('PUT', '', payload);
  },
  openPdf,
};
