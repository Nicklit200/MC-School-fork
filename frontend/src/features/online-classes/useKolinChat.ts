import { useCallback, useMemo, useRef, useState } from 'react';
import { ApiRequestError } from '../../api/client';
import { kolinApi, parseKolinTranscriptContext, parseKolinWorksheet, parseKolinMaterials, type KolinContext, type KolinHistoryMessage, type KolinTranscriptContext, type KolinWorksheet } from '../../api/kolin';

export type KolinFailureCode = 'KOLIN_BUSY' | 'KOLIN_TASK_INVALID' | 'KOLIN_GENERATION_FAILED';

function failureCode(error: unknown): KolinFailureCode | null {
  if (!(error instanceof ApiRequestError)) return null;
  return error.errorCode === 'KOLIN_BUSY' || error.errorCode === 'KOLIN_TASK_INVALID'
    || error.errorCode === 'KOLIN_GENERATION_FAILED' ? error.errorCode : null;
}

export interface KolinMessage extends KolinHistoryMessage {
  id: string;
  type: 'text' | 'worksheet' | 'interactive' | 'materials';
  status: 'complete' | 'pending' | 'failed';
  transcriptContext?: KolinTranscriptContext;
  worksheet?: KolinWorksheet;
  materials?: KolinWorksheet[];
  materialAppendStatus?: Record<string, 'pending' | 'failed' | undefined>;
  appendStatus?: 'pending' | 'failed';
}

interface Submission {
  messageId: string;
  text: string;
  history: KolinHistoryMessage[];
  context: KolinContext;
}

interface Session {
  token: object;
  open: boolean;
  draft: string;
  messages: KolinMessage[];
  availability: 'idle' | 'checking' | 'ready' | 'unconfigured' | 'error';
  pending: boolean;
  error: 'connection' | 'response' | null;
  failureCode: KolinFailureCode | null;
  failed: Submission | null;
}

const initial = (token: object): Session => ({ token, open: false, draft: '', messages: [], availability: 'idle', pending: false, error: null, failureCode: null, failed: null });

/** One private, in-page teacher thread. Closing/resizing/changing pupil never changes its scope. */
export function useKolinChat(classId: string, teacherId: string, enabled: boolean) {
  const token = useMemo(() => ({}), [classId, teacherId, enabled]);
  const latest = useRef(token);
  latest.current = token;
  const [stored, setStored] = useState<Session>(() => initial(token));
  const session = stored.token === token ? stored : initial(token);
  const state = useRef(session);
  state.current = session;
  const statusFlight = useRef<object | null>(null);
  const responseFlight = useRef<object | null>(null);
  const appendFlights = useRef(new Map<string, object>());
  const change = useCallback((update: (current: Session) => Session) => {
    if (latest.current !== token) return;
    setStored(current => update(current.token === token ? current : initial(token)));
  }, [token]);

  const checkAvailability = useCallback(async () => {
    if (!enabled || statusFlight.current === token) return;
    statusFlight.current = token;
    change(current => ({ ...current, availability: 'checking', error: null, failureCode: null }));
    try {
      const result = await kolinApi.status(classId);
      change(current => ({ ...current, availability: result.configured ? 'ready' : 'unconfigured' }));
    } catch {
      change(current => ({ ...current, availability: 'error', error: 'connection' }));
    } finally {
      if (statusFlight.current === token) statusFlight.current = null;
    }
  }, [classId, enabled, token, change]);

  const toggle = useCallback(() => {
    if (!enabled) return;
    const current = state.current;
    change(value => ({ ...value, open: !current.open }));
    if (!current.open && (current.availability === 'idle' || current.availability === 'error')) void checkAvailability();
  }, [enabled, change, checkAvailability]);
  const close = useCallback(() => change(current => ({ ...current, open: false })), [change]);
  const setDraft = useCallback((draft: string) => change(current => ({ ...current, draft })), [change]);

  const run = useCallback(async (submission: Submission, append: boolean) => {
    if (!enabled || responseFlight.current === token || state.current.availability !== 'ready') return;
    responseFlight.current = token;
    change(current => ({ ...current, pending: true, error: null, failureCode: null, failed: null,
      messages: append ? [...current.messages, { id: submission.messageId, role: 'user', type: 'text', text: submission.text, status: 'pending' }]
        : current.messages.map(message => message.id === submission.messageId ? { ...message, status: 'pending' } : message),
    }));
    try {
      const result = await kolinApi.send(classId, submission.text, submission.history, submission.context, submission.messageId);
      if (result.type !== 'text' && result.type !== 'worksheet' && result.type !== 'interactive' && result.type !== 'materials' || typeof result.text !== 'string'
          || result.type === 'text' && !result.text.trim()) throw new Error('Empty response');
      const worksheet = result.type !== 'text' ? parseKolinWorksheet(result.worksheet) : undefined;
      const materials = result.type === 'materials' ? parseKolinMaterials(result.materials) : undefined;
      if (result.type === 'materials' ? !materials : result.type !== 'text' && !worksheet) throw new Error('Invalid worksheet');
      const transcriptContext = parseKolinTranscriptContext(result.transcriptContext);
      change(current => ({ ...current, pending: false,
        draft: current.draft.trim() === submission.text ? '' : current.draft,
        messages: [...current.messages.map(message => message.id === submission.messageId ? { ...message, status: 'complete' as const } : message),
          { id: crypto.randomUUID(), role: 'assistant', type: result.type, text: result.text, status: 'complete',
            ...(worksheet ? { worksheet } : {}),
            ...(materials ? { materials } : {}),
            ...(transcriptContext ? { transcriptContext } : {}) }],
      }));
    } catch (error) {
      change(current => ({ ...current, pending: false, error: 'response', failureCode: failureCode(error), failed: submission,
        messages: current.messages.map(message => message.id === submission.messageId ? { ...message, status: 'failed' } : message),
      }));
    } finally {
      if (responseFlight.current === token) responseFlight.current = null;
    }
  }, [classId, enabled, token, change]);

  const send = useCallback((context: KolinContext) => {
    const current = state.current;
    const text = current.draft.trim();
    if (!enabled || !text || text.length > 2000 || current.pending) return;
    // Page navigation or late board initialization must not create a new request on retry.
    if (current.failed?.text === text && current.failed.context.studentId === context.studentId
        && current.failed.context.targetType === context.targetType && current.failed.context.format === context.format) return run(current.failed, false);
    const history = current.messages.filter(message => message.status === 'complete')
      .slice(-8).map(message => ({ role: message.role, text: message.text }));
    return run({ messageId: crypto.randomUUID(), text, history, context: { ...context } }, true);
  }, [enabled, run]);

  const retry = useCallback(() => {
    if (state.current.error === 'connection') return checkAvailability();
    if (state.current.failed) return run(state.current.failed, false);
  }, [run, checkAvailability]);

  const appendWorksheet = useCallback(async (id: string) => {
    const worksheet = state.current.messages.flatMap(message => message.materials ?? (message.worksheet ? [message.worksheet] : []))
      .find(material => material.id === id);
    if (!enabled || !worksheet || worksheet.state === 'ADDED' || appendFlights.current.get(id) === token) return;
    appendFlights.current.set(id, token);
    const updateMaterial = (message: KolinMessage, status: 'pending' | 'failed' | undefined, added?: KolinWorksheet): KolinMessage =>
      message.materials?.some(material => material.id === id)
        ? { ...message, materialAppendStatus: { ...message.materialAppendStatus, [id]: status },
          materials: added ? message.materials.map(material => material.id === id ? added : material) : message.materials }
        : message.worksheet?.id === id ? { ...message, appendStatus: status, worksheet: added ?? message.worksheet } : message;
    change(current => ({ ...current, messages: current.messages.map(message => updateMaterial(message, 'pending')) }));
    try {
      const added = parseKolinWorksheet(await kolinApi.appendWorksheet(classId, id));
      if (!added || added.id !== id || added.studentId !== worksheet.studentId || added.state !== 'ADDED')
        throw new Error('Invalid append result');
      change(current => ({ ...current, messages: current.messages.map(message => updateMaterial(message, undefined, added)) }));
      if (latest.current === token) window.dispatchEvent(new Event('mc-workbook-updated'));
    } catch {
      change(current => ({ ...current, messages: current.messages.map(message => updateMaterial(message, 'failed')) }));
    } finally {
      if (appendFlights.current.get(id) === token) appendFlights.current.delete(id);
    }
  }, [classId, enabled, token, change]);

  return { ...session, classId, toggle, close, setDraft, send, retry, appendWorksheet };
}
