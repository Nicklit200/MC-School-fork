import { getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export type TrialLeadStatus =
  | 'NEW'
  | 'GRADE_SELECTED'
  | 'SCHOOL_SELECTED'
  | 'SUBJECT_SELECTED'
  | 'GOAL_SELECTED'
  | 'PRIORITY_SELECTED'
  | 'FORM_COMPLETED'
  | 'TEACHER_SELECTED'
  | 'CALENDAR_OPENED'
  | 'BOOKED'
  | 'CONTACTED'
  | 'CONTRACT'
  | 'DECLINED';

export type TrialLead = {
  id: string;
  trackingToken: string;
  phone: string;
  grade?: string | null;
  schoolType?: string | null;
  subject?: string | null;
  goal?: string | null;
  priority?: string | null;
  teacherId?: string | null;
  teacherName?: string | null;
  source?: string | null;
  status: TrialLeadStatus;
  createdAt: string;
  updatedAt: string;
};


export type SiteVisit = {
  id: string;
  sessionId: string;
  path?: string | null;
  source?: string | null;
  referrer?: string | null;
  deviceType?: string | null;
  deviceModel?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  browserName?: string | null;
  browserVersion?: string | null;
  screenSize?: string | null;
  viewportSize?: string | null;
  language?: string | null;
  userAgent?: string | null;
  funnelStage?: string | null;
  diagnosticStage?: string | null;
  grade?: string | null;
  goal?: string | null;
  priority?: string | null;
  firstInteractionLabel?: string | null;
  maxScrollPercent?: number | null;
  maxActiveSeconds?: number | null;
  clientError?: string | null;
  trialPageLoadedAt?: string | null;
  gradeOptionsVisibleAt?: string | null;
  firstInteractionAt?: string | null;
  firstScrollAt?: string | null;
  leadPhone?: string | null;
  leadStatus?: TrialLeadStatus | null;
  createdAt: string;
  updatedAt?: string | null;
};

function headers(): Record<string, string> {
  const token = getAccessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(payload?.message ?? response.statusText);
  return payload as T;
}

export const trialLeadsApi = {
  list: async (): Promise<TrialLead[]> => parse<TrialLead[]>(await fetch(`${BASE_URL}/admin/trial-leads`, { headers: headers() })),
  listVisits: async (): Promise<SiteVisit[]> => parse<SiteVisit[]>(await fetch(`${BASE_URL}/admin/site-visits`, { headers: headers() })),
  setStatus: async (id: string, status: TrialLeadStatus): Promise<void> => {
    await parse(await fetch(`${BASE_URL}/admin/trial-leads/${id}/status`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ status }),
    }));
  },
  delete: async (id: string): Promise<void> => {
    await parse(await fetch(`${BASE_URL}/admin/trial-leads/${id}`, {
      method: 'DELETE',
      headers: headers(),
    }));
  },
};
