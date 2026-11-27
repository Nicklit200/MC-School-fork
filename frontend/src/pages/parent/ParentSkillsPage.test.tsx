import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParentSkillsPage } from './ParentSkillsPage';
import { parentApi, type ParentSkillsDashboard } from '../../api/parent';

vi.mock('../../api/parent', () => ({
  parentApi: { children: vi.fn(), skills: vi.fn(), skillsTree: vi.fn() },
}));
vi.mock('../../i18n/I18nContext', () => ({
  useI18n: () => ({ language: 'RU' }),
}));

const classroom = '11111111-1111-4111-8111-111111111111';
function dashboard(changes: ParentSkillsDashboard['lessonProgress'][number]['changes']):
  ParentSkillsDashboard {
  return {
    studentId: '22222222-2222-4222-8222-222222222222',
    studentName: 'Тестовый ученик', grade: 5, schoolType: 'GYMNASIUM',
    boardId: 'grade-5', boardTitle: 'Математика — навыки к концу 5 класса',
    curriculumSource: null, confirmedPercent: 15.1,
    assessedAveragePercent: 45, assessedSkills: 6, totalSkills: 39,
    updatedAt: null,
    topics: [{
      id: 'topic-1', title: 'Числа и вычисления', totalSkills: 9,
      assessedSkills: 6, averagePercent: 45, confirmedPercent: 30,
    }],
    skills: [
      { id: 'g5-1-7', title: 'Степени и степени десяти', germanTitle: null,
        topicId: 'topic-1', mastery: 45, updatedAt: null },
      { id: 'g5-1-1', title: 'Разряды и большие числа', germanTitle: null,
        topicId: 'topic-1', mastery: 60, updatedAt: null },
    ],
    trend: [],
    lessonProgress: [{
      lessonId: classroom, lessonTitle: 'Индивидуальный урок',
      endedAt: '2026-11-20T18:00:00Z', confirmedPercent: 15.1,
      assessedSkills: 6, changes,
    }],
    lessons: [{
      id: classroom, title: 'Индивидуальный урок', endedAt: '2026-11-20T18:00:00Z',
      reviewState: 'DONE', summary: 'Разобрали степени и возведение в степень.',
      summarySource: 'AI_TRANSCRIPT_RECAP',
      evidence: [], observations: [], improvements: [],
    }],
    practice: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parentApi.children).mockResolvedValue([{
    studentId: '22222222-2222-4222-8222-222222222222',
    studentName: 'Тестовый ученик', homeworkAssignedToday: 0,
    homeworkCompletedToday: 0, homeworkOpenToday: 0, cardsDueToday: 0,
    homeworks: [],
  }]);
});
afterEach(() => cleanup());

describe('parent curriculum changes per lesson', () => {
  it('hides all grade-wide assessed counters and lists only changed skills', async () => {
    vi.mocked(parentApi.skills).mockResolvedValue(dashboard([{
      skillId: 'g5-1-7', skillTitle: 'Степени и степени десяти',
      previous: 40, current: 45, changedAt: '2026-11-20T19:01:00Z',
      sourceType: 'LESSON', explanation: 'Самостоятельно вычислены степени.',
      excerpt: 'Авторство этих ответов подтверждено транскрипцией с userId Семёна',
    }]));
    render(<ParentSkillsPage />);
    const point = await screen.findByRole('button', { name: /Индивидуальный урок/ });
    expect(screen.queryByText(/проверено/)).not.toBeInTheDocument();
    expect(screen.queryByText('Разряды и большие числа')).not.toBeInTheDocument();
    // The newest lesson is selected automatically on opening the skills tab.
    expect(point).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Изменившиеся навыки')).toBeInTheDocument();
    expect(screen.getAllByText('Степени и степени десяти').length).toBeGreaterThan(0);
    expect(screen.getByText('40% → 45%')).toBeInTheDocument();
    expect(screen.getByText('Самостоятельно вычислены степени.')).toBeInTheDocument();
    expect(screen.queryByText(/userId|транскрипц|Авторство|Основание:/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Разряды и большие числа')).not.toBeInTheDocument();
    expect(screen.queryByText(/6\s*\/\s*9/)).not.toBeInTheDocument();
  });

  it('does not invent a changed skill when no mastery history exists', async () => {
    vi.mocked(parentApi.skills).mockResolvedValue(dashboard([]));
    render(<ParentSkillsPage />);
    expect((await screen.findByRole('button', { name: /Индивидуальный урок/ })))
      .toHaveAttribute('aria-pressed','true');
    expect(screen.queryByText('Степени и степени десяти')).not.toBeInTheDocument();
    expect(screen.getByText(/не записано изменений процентов/)).toBeInTheDocument();
  });

  it('switches from graph to the original tree for the same student', async () => {
    vi.mocked(parentApi.skills).mockResolvedValue(dashboard([{
      skillId:'g5-1-7', skillTitle:'Степени и степени десяти',
      previous:40, current:45, changedAt:'2026-11-20T19:01:00Z',
      sourceType:'LESSON', explanation:'Самостоятельные решения.',
      excerpt:null,
    }]));
    vi.mocked(parentApi.skillsTree).mockResolvedValue({
      boardId:'grade-5', boardRevision:3, boardUpdatedAt:'2026-11-20T20:00:00Z',
      board: {
        schemaVersion:1, title:'Математика 5 класс',grade:5,source:'Lehrplan',
        nodes:[
          {id:'g5-1-7',kind:'skill',title:'Степени и степени десяти',
            de:'Potenzen',description:'',example:'',source:'',color:'orange',
            x:0,y:0,archived:false,core:true,schoolTypes:[]},
        ],
        edges:[],
      },
    });
    render(<ParentSkillsPage />);
    expect(await screen.findByText('Изменившиеся навыки')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Найти навык в дереве/}));
    expect(screen.getByRole('tab',{name:'Дерево навыков'})).toHaveAttribute('aria-selected','true');
    const iframe = await screen.findByTitle('Дерево навыков ребёнка') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(parentApi.skillsTree).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage');
    fireEvent.load(iframe);
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mindcrafti-skills-parent-config',
        progress: expect.objectContaining({
          boardId: 'grade-5',
          mastery: { 'g5-1-7': 45, 'g5-1-1': 60 },
        }),
      }),
      window.location.origin,
    ));
    fireEvent.click(screen.getByRole('tab',{name:'График роста'}));
    expect(screen.getByText('Изменившиеся навыки')).toBeInTheDocument();
  });

  it('opens the chronologically newest lesson even if the API list is unordered', async () => {
    const data=dashboard([]);
    const older='33333333-3333-4333-8333-333333333333';
    data.lessonProgress=[
      {lessonId:classroom,lessonTitle:'Новый урок',endedAt:'2026-11-20T18:00:00Z',
        confirmedPercent:15.1,assessedSkills:6,changes:[]},
      {lessonId:older,lessonTitle:'Старый урок',endedAt:'2026-11-13T18:00:00Z',
        confirmedPercent:13.2,assessedSkills:6,changes:[]},
    ];
    data.lessons=[...data.lessons,{...data.lessons[0],id:older,title:'Старый урок',
      endedAt:'2026-11-13T18:00:00Z'}];
    vi.mocked(parentApi.skills).mockResolvedValue(data);
    render(<ParentSkillsPage />);
    expect((await screen.findByRole('button',{name:/Новый урок/})))
      .toHaveAttribute('aria-pressed','true');
    expect(screen.getByRole('button',{name:/Старый урок/}))
      .toHaveAttribute('aria-pressed','false');
  });
});
