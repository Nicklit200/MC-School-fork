import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../../i18n/I18nContext';
import { LessonWorkspacePage } from './LessonWorkspacePage';
import { api, request } from '../../api/client';
import { completedLessonApi, lessonPreparationApi } from '../../api/lessonPreparation';
// The workspace is mounted for a signed-in teacher, outside the private pilot.
vi.mock('../../auth/AuthContext',()=>({useAuth:()=>({user:{id:'teacher-1',role:'TEACHER'}})}));
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
    expect(screen.getByRole('button',{name:'Создать документ'})).toBeInTheDocument();
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
  it('switches the displayed homework error with previous and next arrows, wrapping at both ends',async()=>{
    vi.mocked(lessonPreparationApi.get).mockResolvedValue({
      eventId:'lesson-1',
      homeworkNotes:'София: задано 2, сдано 2, ещё не сдано 0.',
      difficulties:JSON.stringify({kind:'homework_errors_v1',issues:[
        {student:'София', difficulty:'Знак', task:'Первое задание', studentAnswer:'-1', correctAnswer:'1', source:'sofia-2026-11-21.pdf', page:'Aufgabe 1'},
        {student:'Виталина', difficulty:'Раскрытие скобок', task:'Второе задание', studentAnswer:'2', correctAnswer:'3', source:'vitalina-2026-11-21.pdf', page:'Aufgabe 2'},
        {student:'Мелисса', difficulty:'Вычисление', task:'Третье задание', studentAnswer:'4', correctAnswer:'5', source:'melissa-2026-11-21.pdf', page:'Aufgabe 3'},
      ]}),
      coveredMaterial:'Дроби',lessonPlan:'План',manualTranscriptText:null,transcriptText:'Автоматическая запись',
    } as never);
    mount();await screen.findByRole('heading',{name:'Дроби'});
    expect(screen.getByText('Первое задание')).toBeInTheDocument();
    expect(screen.getByText('Ошибка 1 из 3')).toBeInTheDocument();
    expect(screen.queryByText('Второе задание')).not.toBeInTheDocument();
    expect(screen.queryByText('Показать остальные ошибки: 2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Следующая ошибка'}));
    expect(screen.getByText('Второе задание')).toBeInTheDocument();
    expect(screen.getByText('Ошибка 2 из 3')).toBeInTheDocument();
    expect(screen.queryByText('Первое задание')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Предыдущая ошибка'}));
    expect(screen.getByText('Первое задание')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Предыдущая ошибка'}));
    expect(screen.getByText('Третье задание')).toBeInTheDocument();
    expect(screen.getByText('Ошибка 3 из 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Следующая ошибка'}));
    expect(screen.getByText('Ошибка 1 из 3')).toBeInTheDocument();
  });

  it('typesets fractions and square roots in the exercise and both answers',async()=>{
    vi.mocked(lessonPreparationApi.get).mockResolvedValue({
      eventId:'lesson-1', homeworkNotes:'',
      difficulties:JSON.stringify({kind:'homework_errors_v1',issues:[{
        student:'София', difficulty:'Дроби', task:'-1/2+3/4-(-1/4), вычислить',
        studentAnswer:'12/8', correctAnswer:'1/2, так как -4/8+6/8+2/8=4/8',
        source:'sofia_2026-11-21.pdf', page:'Aufgabe 1',
      }]}),
      coveredMaterial:'Дроби',lessonPlan:'План',manualTranscriptText:null,transcriptText:'',
    } as never);
    mount();await screen.findByRole('heading',{name:'Дроби'});
    const card = screen.getByRole('article');
    expect(card.querySelectorAll('mfrac')).toHaveLength(9);
    expect(card).toHaveTextContent('вычислить');
    expect(card).toHaveTextContent('так как');
  });
  it('shows only key real homework mistakes and never the manual note fields',async()=>{
    vi.mocked(lessonPreparationApi.get).mockResolvedValue({
      eventId:'lesson-1',
      homeworkNotes:'Мелисса: задано 7, сдано 5, ещё не сдано 2. В анализе 5 работ.\nСофия: задано 7, сдано 6, ещё не сдано 1.',
      difficulties:JSON.stringify({kind:'homework_errors_v1',issues:[
        {student:'София',difficulty:'Знаки перед скобками',task:'Berechne -3 + 8.',
         studentAnswer:'-5',correctAnswer:'5',source:'sofia_2026-11-21.pdf',page:'Aufgabe 2'}
      ]}),
      coveredMaterial:'Дроби',lessonPlan:'План',manualTranscriptText:null,transcriptText:'Автоматическая запись'
    } as never);
    mount(); await screen.findByRole('heading',{name:'Дроби'});
    expect(screen.getByText('Ошибка со знаком')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Berechne');
    expect(screen.getByText('Ученик')).toBeInTheDocument();
    expect(screen.getByText('Правильно')).toBeInTheDocument();
    expect(screen.getByText('Мелисса')).toBeInTheDocument();
    expect(screen.getByRole('progressbar',{name:'Сданная домашняя работа, всего'})).toHaveAttribute('aria-valuenow','79');
    expect(screen.getByRole('progressbar',{name:'Домашка: Мелисса'})).toHaveAttribute('aria-valuenow','71');
    expect(screen.getByRole('progressbar',{name:'Домашка: София'})).toHaveAttribute('aria-valuenow','86');
    expect(screen.getByText('11/14 · 79%')).toBeInTheDocument();
    expect(screen.getByText('Не сдано: 3')).toBeInTheDocument();
    expect(screen.getByText('Главных ошибок для разбора: 1')).toBeInTheDocument();
    expect(screen.getByText('Только основные подтверждённые примеры, не общее число всех ошибок.')).toBeInTheDocument();
    expect(screen.getAllByText('София').length).toBeGreaterThan(0);
    expect(screen.queryByRole('textbox',{name:'Информация о домашке'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Сохранить информацию'})).not.toBeInTheDocument();
    expect(lessonPreparationApi.update).not.toHaveBeenCalled();
  });
});
