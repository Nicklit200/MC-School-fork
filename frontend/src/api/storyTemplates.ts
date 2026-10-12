import { getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';
const URL = `${BASE_URL}/admin/stories/master`;

export type StoryTemplateInfo = {
  configured: boolean;
  filename: string | null;
  version: number;
  sha256: string | null;
  sizeBytes: number;
  updatedAt: string | null;
  slideCount: number;
  format: string;
  safeZone: { top: number; bottom: number; left: number; right: number; canvasWidth: number; canvasHeight: number };
  rules: string;
};

function headers(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function check(response: Response): Promise<void> {
  if (response.ok) return;
  let message = response.statusText;
  try {
    const payload = await response.json();
    message = payload?.message ?? message;
  } catch {
    // Retain the response status.
  }
  throw new Error(message);
}

export const storyTemplatesApi = {
  async get(): Promise<StoryTemplateInfo> {
    const response = await fetch(URL, { headers: headers() });
    await check(response);
    return response.json() as Promise<StoryTemplateInfo>;
  },
  async upload(file: File): Promise<StoryTemplateInfo> {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`${URL}/upload`, { method: 'POST', headers: headers(), body: form });
    await check(response);
    return response.json() as Promise<StoryTemplateInfo>;
  },
  async download(): Promise<void> {
    const response = await fetch(`${URL}/download`, { headers: headers() });
    await check(response);
    const blob = await response.blob();
    const address = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = address;
    link.download = 'Mindcrafti_Stories_MASTER.pptx';
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(address), 60_000);
  },
};
