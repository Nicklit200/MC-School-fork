import { request } from './client';
import type { WorkbookPreview } from './workbookStudio';

export type GeneratorLayout = {
  schema: 'mindcrafti.generator-layout/1';
  graphHeightMm: number;
  graphWidthPercent: number;
  graphPlotScalePercent: number;
  graphAlignment: 'left' | 'center';
  blockGapMm: number;
  answerSpacePercent: number;
  taskTitleFontPx: number;
};

export type GeneratorLayoutState = {
  draftRevision: number;
  activeRevision: number;
  testedRevision: number;
  draftJson: string;
  activeJson: string;
  canActivate: boolean;
  canRollback: boolean;
  updatedAt: string;
};

export type GeneratorLayoutTest = WorkbookPreview & {
  settings: GeneratorLayoutState;
};

export const generatorLayoutApi = {
  get: () => request<GeneratorLayoutState>('GET', '/admin/workbook-generator-layout'),
  saveDraft: (expectedRevision: number, draft: GeneratorLayout) =>
    request<GeneratorLayoutState>('PUT', '/admin/workbook-generator-layout/draft',
      { expectedRevision, draftJson: JSON.stringify(draft) }),
  test: (draftRevision: number, lessonJson: string) =>
    request<GeneratorLayoutTest>('POST', '/admin/workbook-generator-layout/test',
      { draftRevision, lessonJson }),
  activate: (draftRevision: number, activeRevision: number) =>
    request<GeneratorLayoutState>('POST', '/admin/workbook-generator-layout/activate',
      { draftRevision, activeRevision }),
  rollback: (activeRevision: number) =>
    request<GeneratorLayoutState>('POST', '/admin/workbook-generator-layout/rollback',
      { activeRevision }),
};
