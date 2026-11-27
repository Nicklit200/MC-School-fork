import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { adminKolinUsageApi } from '../../api/kolin';
import { AdminKolinUsagePage } from './AdminKolinUsagePage';

vi.mock('../../api/kolin',()=>({ adminKolinUsageApi: { lessons:vi.fn(), detail:vi.fn() } }));
const row={classId:'class',teacherId:'teacher',teacherName:'Teacher',title:'Math',
  scheduledStartAt:'2026-11-27T18:00:00Z',checks:2,uniqueRevisions:1,aiRequests:1,aiResponses:1,
  cacheHits:1,inputTokens:100,outputTokens:50,costUsd:null,costComplete:false};
beforeEach(()=>{
  vi.mocked(adminKolinUsageApi.lessons).mockResolvedValue([row]);
  vi.mocked(adminKolinUsageApi.detail).mockResolvedValue({totals:{...row,inProgressReuses:0,failedReuses:0,cachedInputTokens:0,reasoningTokens:0},
    pages:[{...row,studentId:'pupil',studentName:'Pupil',boardId:'personal-pupil',pageNumber:1}]});
});
it('shows only recorded cost and loads student and page detail for the chosen lesson',async()=>{
  render(<AdminKolinUsagePage/>);
  await userEvent.click(await screen.findByRole('button',{name:/Math/}));
  expect(adminKolinUsageApi.detail).toHaveBeenCalledWith('class','teacher');
  expect(await screen.findByRole('heading',{name:'Pupil · Неизвестно'})).toBeInTheDocument();
  expect(screen.getByRole('region',{name:'Детализация урока'})).toHaveTextContent('1 вызовов ИИ');
});
