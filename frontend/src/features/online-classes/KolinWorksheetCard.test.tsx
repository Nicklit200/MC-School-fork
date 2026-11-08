import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { kolinApi, type KolinWorksheet } from '../../api/kolin';
import { I18nProvider } from '../../i18n/I18nContext';
import { KolinPanel } from './KolinPanel';
import { useKolinChat } from './useKolinChat';
import { openPdf } from './pdfDocument';

vi.mock('../../api/kolin', async importOriginal => ({ ...await importOriginal<typeof import('../../api/kolin')>(),
  kolinApi: { status: vi.fn(), send: vi.fn(), worksheetPreview: vi.fn(), worksheetPdf: vi.fn(), appendWorksheet: vi.fn() } }));
vi.mock('./pdfDocument', () => ({ openPdf: vi.fn() }));

const worksheet: KolinWorksheet = { id: 'saved-artifact', studentId: 'alice', studentName: 'Виталина', taskCount: 3, pageCount: 2, state: 'READY' };
const destroy = vi.fn();
function Harness({ studentId = 'alice' }: { studentId?: string }) {
  const chat = useKolinChat('class-1', 'teacher', true);
  return <I18nProvider><button onClick={chat.toggle}>Kolyn</button>
    {chat.open && <KolinPanel chat={chat} context={{ targetType: 'student', studentId }} />}
  </I18nProvider>;
}
beforeEach(() => {
  localStorage.setItem('language', 'RU');
  vi.mocked(kolinApi.status).mockReset().mockResolvedValue({ configured: true });
  vi.mocked(kolinApi.send).mockReset().mockResolvedValue({ type: 'worksheet', text: 'Задания готовы.', worksheet });
  vi.mocked(kolinApi.worksheetPreview).mockReset().mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  vi.mocked(kolinApi.worksheetPdf).mockReset().mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(3) } as Blob);
  vi.mocked(kolinApi.appendWorksheet).mockReset().mockResolvedValue({ ...worksheet, state: 'ADDED', fromPage: 5, toPage: 6 });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:authorized-preview');
    static revokeObjectURL = vi.fn();
  });
  destroy.mockReset();
  vi.mocked(openPdf).mockReset().mockResolvedValue({ pageCount: 2, destroy,
    renderPage: vi.fn(async () => ({ canvas: document.createElement('canvas'), aspect: 0.7 })) });
});
async function createCard() {
  await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
  await userEvent.type(screen.getByRole('textbox'), 'Создай и добавь три задания{Enter}');
  return screen.findByRole('button', { name: 'Добавить Виталине' });
}

it('creates a private interactive preview and only appends to its original pupil after confirmation', async () => {
  const interactive: KolinWorksheet={...worksheet,taskCount:1,pageCount:1,interactive:[{template:'graph',language:'ru',function:'linear',coefficients:[2,1]}]};
  vi.mocked(kolinApi.send).mockResolvedValue({type:'interactive',text:'График готов.',worksheet:interactive});
  vi.mocked(kolinApi.appendWorksheet).mockResolvedValue({...interactive,state:'ADDED'});
  const view=render(<Harness/>);
  await userEvent.click(screen.getByRole('button',{name:'Kolyn'}));
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'Формат заданий'}),'interactive');
  await userEvent.type(screen.getByRole('textbox'),'График для Виталины{Enter}');
  const add=await screen.findByRole('button',{name:'Добавить Виталине'});
  expect(vi.mocked(kolinApi.send).mock.calls[0][3]).toMatchObject({targetType:'student',studentId:'alice',format:'interactive'});
  expect(kolinApi.worksheetPreview).not.toHaveBeenCalled();
  expect(kolinApi.appendWorksheet).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button',{name:'Предпросмотр для Виталина'}));
  expect(screen.getByRole('dialog',{name:'Виталина'})).toBeInTheDocument();
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  view.rerender(<Harness studentId="bob"/>);
  await userEvent.click(add);
  expect(await screen.findByRole('button',{name:'Добавлено ✓'})).toBeDisabled();
  expect(kolinApi.appendWorksheet).toHaveBeenCalledExactlyOnceWith('class-1','saved-artifact');
  expect(kolinApi.send).toHaveBeenCalledTimes(1);
  expect(kolinApi.worksheetPdf).not.toHaveBeenCalled();
});

it('shows one confirmation action with a small clickable first-page preview and never auto-adds', async () => {
  render(<Harness />);
  await createCard();
  const card = screen.getByText('Виталина').closest('.kolin-worksheet')!;
  expect(within(card as HTMLElement).getAllByRole('button')).toHaveLength(2);
  expect(card).toHaveTextContent('3 задания · 2 стр.');
  expect(await screen.findByAltText('Первая страница PDF')).toHaveAttribute('src', 'blob:authorized-preview');
  expect(kolinApi.worksheetPreview).toHaveBeenCalledExactlyOnceWith('class-1', 'saved-artifact');
  expect(kolinApi.worksheetPdf).not.toHaveBeenCalled();
  expect(kolinApi.appendWorksheet).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Открыть|Изменить|Отменить/ })).not.toBeInTheDocument();
});

it('opens the authorized full PDF preview and closes with Escape or overlay without adding', async () => {
  render(<Harness />);
  await createCard();
  const thumbnail = screen.getByRole('button', { name: 'Предпросмотр PDF для Виталина' });
  await userEvent.click(thumbnail);
  const dialog = screen.getByRole('dialog', { name: 'Предпросмотр PDF для Виталина' });
  expect(screen.getByRole('button', { name: 'Закрыть предпросмотр' })).toHaveFocus();
  await waitFor(() => expect(within(dialog).getAllByRole('img')).toHaveLength(2));
  expect(kolinApi.worksheetPdf).toHaveBeenCalledExactlyOnceWith('class-1', 'saved-artifact');
  await userEvent.keyboard('{Tab}');
  expect(screen.getByRole('button', { name: 'Закрыть предпросмотр' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(thumbnail).toHaveFocus();
  expect(destroy).toHaveBeenCalledTimes(1);
  await userEvent.click(thumbnail);
  fireEvent.click(screen.getByTestId('kolin-pdf-overlay'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(kolinApi.appendWorksheet).not.toHaveBeenCalled();
});

it('keeps the recipient after board switches, blocks duplicate clicks and shows the disabled added state', async () => {
  let resolve!: (value: KolinWorksheet) => void;
  vi.mocked(kolinApi.appendWorksheet).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<Harness />);
  const button = await createCard();
  view.rerender(<Harness studentId="bob" />);
  await userEvent.click(button);
  expect(screen.getByRole('button', { name: 'Добавляем…' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Добавляем…' }));
  expect(kolinApi.appendWorksheet).toHaveBeenCalledExactlyOnceWith('class-1', 'saved-artifact');
  await act(async () => { resolve({ ...worksheet, state: 'ADDED' }); });
  expect(screen.getByRole('button', { name: 'Добавлено ✓' })).toBeDisabled();
  expect(screen.getByText('Виталина')).toBeInTheDocument();
});

it('retries the same artifact with the same button after uncertain append, without regenerating', async () => {
  vi.mocked(kolinApi.appendWorksheet).mockRejectedValueOnce(new Error('private backend details'));
  render(<Harness />);
  await userEvent.click(await createCard());
  expect(await screen.findByRole('alert')).toHaveTextContent('Добавление не подтверждено');
  expect(screen.getByRole('alert')).not.toHaveTextContent('private backend details');
  await userEvent.click(screen.getByRole('button', { name: 'Добавить Виталине' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Добавлено ✓' })).toBeDisabled());
  expect(vi.mocked(kolinApi.appendWorksheet).mock.calls).toEqual([
    ['class-1', 'saved-artifact'], ['class-1', 'saved-artifact'],
  ]);
  expect(kolinApi.send).toHaveBeenCalledTimes(1);
});

it('localizes the card and preview and revokes its preview URL after closing the panel', async () => {
  localStorage.setItem('language', 'DE');
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Kolyn' }));
  await userEvent.type(screen.getByRole('textbox'), 'Drei Aufgaben{Enter}');
  expect(await screen.findByRole('button', { name: 'Für Виталина hinzufügen' })).toBeEnabled();
  expect(await screen.findByAltText('Erste PDF-Seite')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'PDF-Vorschau für Виталина' }));
  expect(screen.getByRole('dialog', { name: 'PDF-Vorschau für Виталина' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Vorschau schließen' }));
  await userEvent.click(screen.getByRole('button', { name: 'Kolyn schließen' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:authorized-preview');
});
