import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kolinApi, type KolinTranscriptContext } from '../../api/kolin';
import { ApiRequestError } from '../../api/client';
import { I18nProvider } from '../../i18n/I18nContext';
import { KolinPanel } from './KolinPanel';
import { useKolinChat } from './useKolinChat';

vi.mock('../../api/kolin', async importOriginal => ({ ...await importOriginal<typeof import('../../api/kolin')>(),
  kolinApi: { status: vi.fn(), send: vi.fn(), worksheetPreview: vi.fn(), worksheetPdf: vi.fn(), appendWorksheet: vi.fn() } }));
const transcriptContext: KolinTranscriptContext = { state: 'included', segmentCount: 12, truncated: true,
  latestSegmentAt: '2026-11-07T15:45:00Z', fromMs: 120000, toMs: 525000, transcriptionActive: false };
function Harness({ currentWorkbookPage }: { currentWorkbookPage?: number } = {}) {
  const chat = useKolinChat('class-1', 'teacher', true);
  return <I18nProvider><button onClick={chat.toggle}>Kolyn</button>
    {chat.open && <KolinPanel chat={chat} context={{ targetType: 'student', studentId: 'alice',
      ...(currentWorkbookPage !== undefined ? { currentWorkbookPage } : {}) }} />}
  </I18nProvider>;
}
beforeEach(() => {
  localStorage.setItem('language', 'RU');
  vi.mocked(kolinApi.status).mockReset().mockResolvedValue({ configured: true });
  vi.mocked(kolinApi.send).mockReset().mockResolvedValue({ type: 'text', text: '1) 1/2 + 1/4\n2) 2/3 + 1/6' });
});

describe('Kolyn text panel', () => {
  it('sends Enter, keeps Shift+Enter as a newline and retains history after closing', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    expect(screen.getByText('AI-помощник преподавателя')).toBeInTheDocument();
    expect(screen.getByText('Я Kolyn. Помогу объяснить тему, разобрать решение и подготовить задания.')).toBeInTheDocument();
    expect(screen.getByText(/Когда вы задаёте вопрос, я использую сохранённую расшифровку/)).toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: 'Напишите Kolyn…' });
    await userEvent.type(input, 'Дай задания');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(input).toHaveValue('Дай задания\n');
    expect(kolinApi.send).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('log')).toHaveTextContent('1) 1/2 + 1/4'));
    expect(kolinApi.send).toHaveBeenCalledExactlyOnceWith('class-1', 'Дай задания', [], { targetType: 'student', studentId: 'alice' }, expect.any(String));
    expect(screen.queryByText('Я Kolyn. Помогу объяснить тему, разобрать решение и подготовить задания.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть Kolyn' }));
    expect(screen.queryByRole('complementary', { name: 'Kolyn' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    expect(screen.getByRole('log')).toHaveTextContent('1) 1/2 + 1/4');
    expect(screen.getAllByText('Дай задания')).toHaveLength(1);
  });

  it('shows pending state, blocks repeated sending and renders model content as plain text', async () => {
    let resolve!: (value: { type: 'text'; text: string }) => void;
    vi.mocked(kolinApi.send).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    await userEvent.type(screen.getByRole('textbox'), 'Ответ?');
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(screen.getByRole('status')).toHaveTextContent('Kolyn думает…');
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
    resolve({ type: 'text', text: '<img src=x onerror=alert(1)>\nОтвет: 3/4' });
    await waitFor(() => expect(screen.queryByText('Kolyn думает…')).not.toBeInTheDocument());
    expect(view.container.querySelector('img')).toBeNull();
    expect(screen.getByRole('log')).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(screen.queryByLabelText('Контекст расшифровки')).not.toBeInTheDocument();
  });

  it('shows the bounded transcript window, freshness and stopped state beside its answer', async () => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce({ type: 'text', text: 'Here is the exercise.', transcriptContext });
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    await userEvent.type(screen.getByRole('textbox'), 'Дай задание по уроку{Enter}');
    const note = await screen.findByLabelText('Контекст расшифровки');
    expect(note).toHaveAttribute('data-transcript-state', 'included');
    expect(note).toHaveTextContent('Расшифровка: 12 реплик, 02:00-08:45 урока. Фрагмент.');
    expect(note).toHaveTextContent('На момент запроса расшифровка была неактивна.');
    expect(note.querySelector('time')).toHaveAttribute('datetime', transcriptContext.latestSegmentAt);
    expect(note.querySelector('time')).toHaveTextContent(/\d{2}:\d{2}/);
    expect(note.closest('[data-role]')).toHaveAttribute('data-role', 'assistant');
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть Kolyn' }));
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    expect(screen.getByLabelText('Контекст расшифровки')).toHaveTextContent('12 реплик');
    expect(kolinApi.send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', 'Расшифровка: сохранённых реплик пока нет.'],
    ['unavailable', 'Расшифровку не удалось прочитать. Ответ без неё.'],
  ] as const)('explains %s transcript without hiding the answer', async (state, copy) => {
    vi.mocked(kolinApi.send).mockResolvedValueOnce({ type: 'text', text: 'Still a useful answer.',
      transcriptContext: { ...transcriptContext, state, segmentCount: 0, truncated: false, latestSegmentAt: null,
        fromMs: null, toMs: null, transcriptionActive: true } });
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    await userEvent.type(screen.getByRole('textbox'), 'Вопрос{Enter}');
    const note = await screen.findByLabelText('Контекст расшифровки');
    expect(note).toHaveTextContent(copy);
    expect(screen.getByRole('log')).toHaveTextContent('Still a useful answer.');
    expect(note.querySelector('time')).toBeNull();
    expect(note).not.toHaveTextContent('была неактивна');
  });

  it('localizes transcript context in German and handles an unknown freshness time', async () => {
    localStorage.setItem('language', 'DE');
    vi.mocked(kolinApi.send).mockResolvedValueOnce({ type: 'text', text: 'Die Aufgabe.',
      transcriptContext: { ...transcriptContext, latestSegmentAt: null, fromMs: null, truncated: false,
        transcriptionActive: true } });
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    expect(screen.getByText(/Bei Ihrer Frage nutze ich das gespeicherte Transkript/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox'), 'Noch eine Aufgabe{Enter}');
    const note = await screen.findByLabelText('Transkript-Kontext');
    expect(note).toHaveTextContent('Transkript: 12 Beiträge, bis 08:45 im Unterricht.');
    expect(note).toHaveTextContent('Zeit des letzten Beitrags unbekannt.');
    expect(note).not.toHaveTextContent('Ausschnitt');
  });

  it('keeps the draft after an error and exposes one retry action', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('private provider details'));
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    await userEvent.type(screen.getByRole('textbox'), 'Объясни проще');
    fireEvent.submit(screen.getByRole('button', { name: 'Отправить' }).closest('form')!);
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('private provider details');
    expect(screen.getByRole('textbox')).toHaveValue('Объясни проще');
    await userEvent.click(screen.getByRole('button', { name: 'Повторить отправку' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getAllByText('Объясни проще')).toHaveLength(1);
    expect(kolinApi.send).toHaveBeenCalledTimes(2);
  });

  it('resubmits the retained draft from Send after a page change without a second user bubble', async () => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new Error('generation failed'));
    const view = render(<Harness currentWorkbookPage={1} />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    const text = 'А ну дай пару заданий для виталины что по дробям';
    await userEvent.type(screen.getByRole('textbox'), text);
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByRole('alert');
    view.rerender(<Harness currentWorkbookPage={2} />);
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getAllByText(text)).toHaveLength(1);
    expect(vi.mocked(kolinApi.send).mock.calls[1]).toEqual(vi.mocked(kolinApi.send).mock.calls[0]);
  });

  it.each([
    ['RU', 'KOLIN_BUSY', 429, 'Kolyn ещё готовит ответ. Повторите через несколько секунд.'],
    ['RU', 'KOLIN_BUSY', 409, 'Kolyn ещё готовит ответ. Повторите через несколько секунд.'],
    ['RU', 'KOLIN_TASK_INVALID', 502, 'Не удалось проверить задания. Повторите запрос.'],
    ['RU', 'KOLIN_GENERATION_FAILED', 502, 'Kolyn не смог завершить ответ. Повторите запрос.'],
    ['DE', 'KOLIN_BUSY', 429, 'Kolyn bereitet die Antwort noch vor. Versuchen Sie es in ein paar Sekunden erneut.'],
    ['DE', 'KOLIN_TASK_INVALID', 502, 'Die Aufgaben konnten nicht überprüft werden. Bitte senden Sie die Anfrage erneut.'],
    ['DE', 'KOLIN_GENERATION_FAILED', 502, 'Kolyn konnte die Antwort nicht fertigstellen. Bitte senden Sie die Anfrage erneut.'],
  ])('shows fixed %s copy for %s (%s) without raw server details', async (language, code, status, copy) => {
    localStorage.setItem('language', language);
    vi.mocked(kolinApi.send).mockRejectedValueOnce(new ApiRequestError(Number(status), code, 'PRIVATE_PROVIDER_BODY_AND_KEY'));
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    await userEvent.type(screen.getByRole('textbox'), 'Задания{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(copy);
    expect(alert).not.toHaveTextContent('PRIVATE_PROVIDER_BODY_AND_KEY');
    expect(screen.getByRole('textbox')).toHaveValue('Задания');
  });

  it.each([
    new ApiRequestError(502, 'FUTURE_KOLIN_ERROR', 'PRIVATE_PROVIDER_BODY_AND_KEY'),
    new Error('KOLIN_TASK_INVALID PRIVATE_PROVIDER_BODY_AND_KEY'),
    { errorCode: 'KOLIN_TASK_INVALID', message: 'PRIVATE_PROVIDER_BODY_AND_KEY' },
  ])('uses safe generic copy for an unknown or untrusted failure %#', async error => {
    vi.mocked(kolinApi.send).mockRejectedValueOnce(error);
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
    await userEvent.type(screen.getByRole('textbox'), 'Вопрос{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Не удалось получить ответ. Повторите отправку.');
    expect(alert).not.toHaveTextContent('PRIVATE_PROVIDER_BODY_AND_KEY');
  });
});
