import { ApiRequestError, request } from './client';

export interface NotebookCamera {
  cameraId: string;
  eventId: string;
  classId?: string | null;
  ownerId: string;
  ownerName: string;
  status: 'PAIRING' | 'CONNECTED' | 'REVOKED' | 'EXPIRED';
  pairingExpiresAt: string;
  sessionExpiresAt: string;
}
export interface NotebookConnection {
  serverUrl: string;
  token: string;
  identity: string;
  roomName: string;
  expiresAt: string;
  phoneIdentity: string;
}
export interface CameraPairing { camera: NotebookCamera; pairingToken: string }
export interface CameraClaim { camera: NotebookCamera; sessionToken: string; connection: NotebookConnection }

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';
// Public phone calls deliberately omit the logged-in account's authorization.
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/public/notebook-cameras/${path}`, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), referrerPolicy: 'no-referrer',
  });
  let payload;
  try { payload = await response.json(); } catch { payload = undefined; }
  if (!response.ok) throw new ApiRequestError(response.status, payload?.errorCode ?? 'CAMERA_ERROR', payload?.message ?? 'Не удалось подключить камеру.');
  return payload as T;
}
export const notebookCamerasApi = {
  list: (eventId: string) => request<NotebookCamera[]>('GET', `/notebook-cameras/lessons/${encodeURIComponent(eventId)}`),
  pair: (eventId: string, studentId?: string, classId?: string) => request<CameraPairing>('POST', `/notebook-cameras/lessons/${encodeURIComponent(eventId)}`, { studentId, classId }),
  connection: (cameraId: string) => request<NotebookConnection>('POST', `/notebook-cameras/${encodeURIComponent(cameraId)}/connection`),
  revoke: (cameraId: string) => request<void>('DELETE', `/notebook-cameras/${encodeURIComponent(cameraId)}`),
  claim: (cameraId: string, token: string) => publicPost<CameraClaim>(`${encodeURIComponent(cameraId)}/claim`, { token }),
  phoneConnection: (cameraId: string, sessionToken: string) => publicPost<NotebookConnection>(`${encodeURIComponent(cameraId)}/connection`, { sessionToken }),
};

export function pairingUrl(origin: string, cameraId: string, token: string): string {
  const url = new URL('/', origin);
  url.searchParams.set('mindcraftiCamera', '1');
  url.hash = new URLSearchParams({ cameraId, token }).toString();
  return url.href;
}

export function notebookCameraError(reason: unknown): string {
  if (reason instanceof ApiRequestError) {
    if (reason.status === 503) return 'Камера тетради ещё не настроена на сервере. Сообщите преподавателю.';
    if ([401, 403, 404, 409, 410].includes(reason.status)) return 'Подключение больше недоступно. Откройте урок и создайте новый QR-код.';
  }
  if (reason instanceof Error && reason.name === 'NotAllowedError') return 'Разрешите камеру для этого сайта в настройках браузера и повторите подключение.';
  if (reason instanceof Error && reason.name === 'NotFoundError') return 'Камера не найдена. Откройте эту страницу на телефоне с камерой.';
  if (reason instanceof Error && reason.name === 'NotReadableError') return 'Камера занята. Закройте другое приложение с камерой и повторите.';
  return reason instanceof Error ? reason.message : 'Не удалось подключиться. Проверьте интернет и повторите.';
}
