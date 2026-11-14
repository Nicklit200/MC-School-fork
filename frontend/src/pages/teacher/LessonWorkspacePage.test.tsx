import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nContext';
import { LessonWorkspacePage } from './LessonWorkspacePage';
import { api, request } from '../../api/client';
import { completedLessonApi, lessonPreparationApi } from '../../api/lessonPreparation';
vi.mock('../../api/client',()=>({api:{lessons:{groupLessons:vi.fn()}},request:vi.fn()}));
vi.mock('../../api/lessonPreparation',()=>({lessonPreparationApi:{get:vi.fn(),update:vi.fn(),assignHomeworkSeries:vi.fn()},completedLessonApi:{list:vi.fn()}}));
vi.mock('./PersonalWorkbooksPanel',()=>({PersonalWorkbooksPanel:()=> <div>Мелисса: тетрадь и решения</div>}));
vi.mock('./GoogleDrivePdfPicker',()=>({GoogleDrivePdfPicker:()=> <button>Google Drive</button>}));
vi.mock('../../components/LessonHomeworkSeriesPanel',()=>({LessonHomeworkSeriesPanel:()=> <div>Настройки срока и файла</div>}));
vi.mock('../../features/online-classes/StartOnlineClassButton',()=>({StartOnlineClassButton:()=> <button>Начать онлайн-урок</button>}));
beforeEach(()=>{
  cleanup();localStorage.clear();vi.mocked(request).mockResolvedValue([] as never);
  vi.mocked(api.lessons.groupLessons).mockResolvedValue([{eventId:'lesson-1',title:'Дроби',groupName:'Математика',startsAt:'2026-11-05T14:00:00Z',endsAt:'2026-11-05T15:00:00Z'}] as never);
  vi.mocked(lessonPreparationApi.get).mockResolvedValue({eventId:'lesson-1',homeworkNotes:'Задания 1-3',difficulties:'Знаки',coveredMaterial:'Дроби',lessonPlan:'План',manualTranscriptText:null,transcriptText:'Автоматическая запись'} as never);
  vi.mocked(completedLessonApi.list).mockResolvedValue([]);
  vi.mocked(lessonPreparationApi.update).mockResolvedValue({} as never);
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
});
function mount(){render(<I18nProvider><MemoryRouter initialEntries={['/teacher/lessons/lesson-1']}><Routes><Route path="/teacher/lessons/:eventId" element={<LessonWorkspacePage/>}/></Routes></MemoryRouter></I18nProvider>);}
describe('lesson workspace',()=>{
  it('keeps assignment settings in a dialog and removes the retired panels',async()=>{
    mount();await screen.findByRole('heading',{name:'Дроби'});
    expect(screen.queryByText('AI пилот Николая')).not.toBeInTheDocument();
    expect(screen.queryByText('Камера тетради')).not.toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Документ пройденного урока'})).toBeInTheDocument();
    expect(screen.queryByText('Просмотреть текст')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Все документы'}));
    expect(screen.getByRole('dialog')).toHaveTextContent('Документ добавится после урока.');
    fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));
    expect(screen.getByText('Настройки срока и файла')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Выдать домашку'}));
    expect(screen.getByText('Настройки срока и файла')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Закрыть'}));
    expect(screen.getByText('Настройки срока и файла')).not.toBeVisible();
  });
  it('saves edited notes without replacing preserved fields or automatic transcript',async()=>{
    mount();await screen.findByRole('heading',{name:'Дроби'});
    fireEvent.change(screen.getByRole('textbox',{name:'Информация о домашке'}),{target:{value:'Задания 4-6'}});
    fireEvent.click(screen.getByRole('button',{name:'Сохранить информацию'}));
    await waitFor(()=>expect(lessonPreparationApi.update).toHaveBeenCalledWith('lesson-1',{homeworkNotes:'Задания 4-6',difficulties:'Знаки',coveredMaterial:'Дроби',lessonPlan:'План',transcriptText:''}));
    await screen.findByRole('status');
  });
});
