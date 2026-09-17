import { ApiRequestError, getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export interface DriveItem {
  id: string;
  name: string;
}

export interface DriveUploadResult {
  id: string;
  name: string;
  webViewLink: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      payload?.errorCode ?? 'UNKNOWN',
      payload?.message ?? response.statusText,
    );
  }
  return payload as T;
}

function authHeaders(): HeadersInit {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const driveApi = {
  async listSharedDrives(): Promise<DriveItem[]> {
    const response = await fetch(`${BASE_URL}/drive/shared-drives`, {
      headers: authHeaders(),
    });
    return parseResponse<DriveItem[]>(response);
  },

  async listFolders(driveId: string, parentId?: string): Promise<DriveItem[]> {
    const params = new URLSearchParams({ driveId });
    if (parentId) params.set('parentId', parentId);
    const response = await fetch(`${BASE_URL}/drive/folders?${params.toString()}`, {
      headers: authHeaders(),
    });
    return parseResponse<DriveItem[]>(response);
  },

  async listPdfFiles(driveId: string, parentId?: string): Promise<DriveItem[]> {
    const params = new URLSearchParams({ driveId });
    if (parentId) params.set('parentId', parentId);
    const response = await fetch(`${BASE_URL}/drive/pdf-files?${params.toString()}`, {
      headers: authHeaders(),
    });
    return parseResponse<DriveItem[]>(response);
  },

  async downloadPdf(fileId: string, fileName: string): Promise<File> {
    const params = new URLSearchParams({ fileId, fileName });
    const response = await fetch(`${BASE_URL}/drive/download?${params.toString()}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const text = await response.text();
      let payload: any;
      try { payload = text ? JSON.parse(text) : undefined; } catch { payload = undefined; }
      throw new ApiRequestError(response.status, payload?.errorCode ?? 'UNKNOWN', payload?.message ?? response.statusText);
    }
    const blob = await response.blob();
    return new File([blob], fileName, { type: 'application/pdf' });
  },

  async upload(folderId: string, file: File): Promise<DriveUploadResult> {
    const formData = new FormData();
    formData.append('folderId', folderId);
    formData.append('file', file);
    const response = await fetch(`${BASE_URL}/drive/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    return parseResponse<DriveUploadResult>(response);
  },
};
