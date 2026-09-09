import { getAccessToken } from './client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1';

export type TrialLeadStatus =
  | 'NEW'
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
  setStatus: async (id: string, status: TrialLeadStatus): Promise<void> => {
    await parse(await fetch(`${BASE_URL}/admin/trial-leads/${id}/status`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ status }),
    }));
  },
};
