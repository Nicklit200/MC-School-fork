import { request } from './client';

/**
 * Online-class API. Kept in its own module rather than added to the `api`
 * object in client.ts so that file does not keep growing.
 */

export type OnlineClassStatus = 'SCHEDULED' | 'LOBBY_OPEN' | 'LIVE' | 'ENDED' | 'CANCELLED';

export type ClassFeatureState = 'INACTIVE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'FAILED';

export interface OnlineClass {
  id: string;
  eventId: string;
  bindingKey: string;
  title: string;
  scheduledStartAt: string;
  scheduledEndAt: string;
  studentId: string | null;
  groupId: string | null;
  status: OnlineClassStatus;
  waitingRoomEnabled: boolean;
  studentScreenShareEnabled: boolean;
  recordingState: ClassFeatureState;
  transcriptionState: ClassFeatureState;
  actualStartAt: string | null;
  actualEndAt: string | null;
  viewerIsHost: boolean;
  joinWindowOpen: boolean;
}

/**
 * Connection details. The token is short-lived and scoped to one room and one
 * identity; it is never persisted to storage.
 */
export interface OnlineClassConnection {
  serverUrl: string;
  token: string;
  identity: string;
  roomName: string;
  expiresAt: string;
  host: boolean;
  recordingActive: boolean;
  transcriptionActive: boolean;
}


export type JoinRequestState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
export type ClassRole = 'HOST' | 'STUDENT';
export type AdmissionState = 'PENDING' | 'ADMITTED' | 'REJECTED' | 'REMOVED';

export interface JoinRequest {
  id: string;
  userId: string;
  displayName: string;
  state: JoinRequestState;
  requestedAt: string;
  decidedAt: string | null;
}

/** Roster entry. Carries no e-mail: students can see this list. */
export interface ClassParticipant {
  userId: string;
  displayName: string;
  classRole: ClassRole;
  admissionState: AdmissionState;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  screenShareEnabled: boolean;
  connected: boolean;
  firstJoinedAt: string | null;
  lastLeftAt: string | null;
  totalConnectedSeconds: number;
}


export type ClassMessageType = 'USER' | 'SYSTEM';

export interface ChatMessage {
  id: string;
  clientMessageId: string;
  senderId: string;
  senderName: string;
  body: string;
  messageType: ClassMessageType;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface ChatPage {
  messages: ChatMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}


export type RecordingStatus =
  | 'REQUESTED' | 'STARTING' | 'ACTIVE' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';

export interface Recording {
  id: string;
  status: RecordingStatus;
  requestedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  byteSize: number | null;
  durationSeconds: number | null;
  failureReason: string | null;
  deleteAfter: string | null;
  /** Short-lived signed URL; present only when ready. Never persist it. */
  downloadUrl: string | null;
}


export interface TranscriptSegment {
  id: string;
  speakerLabel: string | null;
  userId: string | null;
  language: string | null;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
}


export type AnnotationTargetType = 'WHITEBOARD' | 'SCREEN_SHARE' | 'NOTEBOOK_CAMERA';

export interface AnnotationDocument {
  id: string;
  targetType: AnnotationTargetType;
  targetId: string;
  pageIndex: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
  revision: number;
  snapshotSavedAt: string | null;
}

export interface AnnotationOperation {
  id: string;
  operationId: string;
  sequence: number;
  actorId: string;
  layerOwnerId: string;
  operationType: string;
  payload: string;
  createdAt: string;
}

/**
 * Stable per-tab identifier so two tabs of the same account do not evict one
 * another. Session-scoped on purpose: a new tab is a new device.
 */
const DEVICE_ID_KEY = 'mc.onlineClass.deviceId';

export function deviceId(): string {
  try {
    const existing = sessionStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Private mode or blocked storage: fall back to an in-memory value.
    return Math.random().toString(36).slice(2, 10);
  }
}

export const onlineClassesApi = {
  materializeFromCalendar: (eventId: string) =>
    request<OnlineClass>('POST', `/online-classes/calendar/${encodeURIComponent(eventId)}`),

  createTestClass: (studentId?: string, groupId?: string, title?: string) => {
    const params = new URLSearchParams();
    if (studentId) params.set('studentId', studentId);
    if (groupId) params.set('groupId', groupId);
    if (title) params.set('title', title);
    const query = params.toString();
    return request<OnlineClass>('POST', `/online-classes/test-class${query ? `?${query}` : ''}`);
  },

  listUpcoming: () => request<OnlineClass[]>('GET', '/online-classes/upcoming'),

  get: (classId: string) => request<OnlineClass>('GET', `/online-classes/${classId}`),

  openLobby: (classId: string) => request<OnlineClass>('POST', `/online-classes/${classId}/open-lobby`),

  start: (classId: string) => request<OnlineClass>('POST', `/online-classes/${classId}/start`),

  end: (classId: string) => request<OnlineClass>('POST', `/online-classes/${classId}/end`),

  cancel: (classId: string) => request<OnlineClass>('POST', `/online-classes/${classId}/cancel`),

  connect: (classId: string) =>
    request<OnlineClassConnection>('POST', `/online-classes/${classId}/connection`, {
      deviceId: deviceId(),
    }),

  leave: (classId: string) => request<void>('POST', `/online-classes/${classId}/leave`),

  // --- Waiting room ---------------------------------------------------------

  knock: (classId: string) => request<JoinRequest>('POST', `/online-classes/${classId}/join-requests`),

  listJoinRequests: (classId: string) =>
    request<JoinRequest[]>('GET', `/online-classes/${classId}/join-requests`),

  approveJoinRequest: (classId: string, requestId: string) =>
    request<JoinRequest>('POST', `/online-classes/${classId}/join-requests/${requestId}/approve`),

  rejectJoinRequest: (classId: string, requestId: string) =>
    request<JoinRequest>('POST', `/online-classes/${classId}/join-requests/${requestId}/reject`),

  approveAllJoinRequests: (classId: string) =>
    request<JoinRequest[]>('POST', `/online-classes/${classId}/join-requests/approve-all`),

  // --- Participants and host controls ---------------------------------------

  listParticipants: (classId: string) =>
    request<ClassParticipant[]>('GET', `/online-classes/${classId}/participants`),

  attendance: (classId: string) =>
    request<ClassParticipant[]>('GET', `/online-classes/${classId}/attendance`),

  muteParticipant: (classId: string, userId: string) =>
    request<ClassParticipant>('POST', `/online-classes/${classId}/participants/${userId}/mute`),

  requestUnmute: (classId: string, userId: string) =>
    request<void>('POST', `/online-classes/${classId}/participants/${userId}/unmute-request`),

  removeParticipant: (classId: string, userId: string) =>
    request<ClassParticipant>('POST', `/online-classes/${classId}/participants/${userId}/remove`),

  muteAllStudents: (classId: string) =>
    request<ClassParticipant[]>('POST', `/online-classes/${classId}/mute-all-students`),

  setStudentScreenShare: (classId: string, enabled: boolean) =>
    request<void>('POST', `/online-classes/${classId}/settings/student-screen-share?enabled=${enabled}`),

  setWaitingRoom: (classId: string, enabled: boolean) =>
    request<void>('POST', `/online-classes/${classId}/settings/waiting-room?enabled=${enabled}`),

  // --- Chat -----------------------------------------------------------------

  sendMessage: (classId: string, clientMessageId: string, body: string) =>
    request<ChatMessage>('POST', `/online-classes/${classId}/messages`, { clientMessageId, body }),

  messageHistory: (classId: string, before?: string | null, size?: number) => {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    if (size) params.set('size', String(size));
    const query = params.toString();
    return request<ChatPage>('GET', `/online-classes/${classId}/messages${query ? `?${query}` : ''}`);
  },

  editMessage: (classId: string, messageId: string, body: string) =>
    request<ChatMessage>('PUT', `/online-classes/${classId}/messages/${messageId}`, {
      clientMessageId: messageId,
      body,
    }),

  deleteMessage: (classId: string, messageId: string) =>
    request<ChatMessage>('DELETE', `/online-classes/${classId}/messages/${messageId}`),

  // --- Recording ------------------------------------------------------------

  startRecording: (classId: string) =>
    request<Recording>('POST', `/online-classes/${classId}/recordings/start`),

  stopRecording: (classId: string) =>
    request<Recording>('POST', `/online-classes/${classId}/recordings/stop`),

  listRecordings: (classId: string) =>
    request<Recording[]>('GET', `/online-classes/${classId}/recordings`),

  acknowledgeRecording: (classId: string) =>
    request<void>('POST', `/online-classes/${classId}/recordings/acknowledge`),

  // --- Transcription --------------------------------------------------------

  startTranscription: (classId: string, languages?: string[]) => {
    const query = languages?.length ? `?languages=${languages.join(',')}` : '';
    return request<void>('POST', `/online-classes/${classId}/transcription/start${query}`);
  },

  stopTranscription: (classId: string) =>
    request<void>('POST', `/online-classes/${classId}/transcription/stop`),

  transcript: (classId: string) =>
    request<TranscriptSegment[]>('GET', `/online-classes/${classId}/transcript`),

  // --- Annotations ----------------------------------------------------------

  openAnnotationDocument: (
    classId: string,
    targetType: AnnotationTargetType,
    targetId: string,
    pageIndex = 0,
    sourceWidth?: number,
    sourceHeight?: number,
  ) => {
    const params = new URLSearchParams({ targetType, targetId, pageIndex: String(pageIndex) });
    if (sourceWidth) params.set('sourceWidth', String(sourceWidth));
    if (sourceHeight) params.set('sourceHeight', String(sourceHeight));
    return request<AnnotationDocument>(
      'POST',
      `/online-classes/${classId}/annotations/documents?${params}`,
    );
  },

  listAnnotationDocuments: (classId: string) =>
    request<AnnotationDocument[]>('GET', `/online-classes/${classId}/annotations/documents`),

  appendAnnotation: (
    classId: string,
    documentId: string,
    operationId: string,
    operationType: string,
    payload: string,
  ) =>
    request<AnnotationOperation>(
      'POST',
      `/online-classes/${classId}/annotations/documents/${documentId}/operations`,
      { operationId, operationType, payload },
    ),

  replayAnnotations: (classId: string, documentId: string, afterSequence = 0) =>
    request<AnnotationOperation[]>(
      'GET',
      `/online-classes/${classId}/annotations/documents/${documentId}/operations?afterSequence=${afterSequence}`,
    ),

  saveAnnotationSnapshot: (classId: string, documentId: string, pngBase64: string) =>
    request<AnnotationDocument>(
      'POST',
      `/online-classes/${classId}/annotations/documents/${documentId}/snapshot`,
      { pngBase64 },
    ),

  findByEvent: (eventId: string) =>
    request<OnlineClass[]>('GET', `/online-classes/by-event/${encodeURIComponent(eventId)}`),
};
