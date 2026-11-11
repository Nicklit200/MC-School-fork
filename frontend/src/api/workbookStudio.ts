import { request } from './client';

export type WorkbookDocument = {
  meta: { school: string; durationMinutes: number; [key: string]: unknown };
  workbookPages: Array<{ title?: string; blocks: unknown[]; [key: string]: unknown }>;
  teacherPages: Array<{ title?: string; blocks: unknown[]; [key: string]: unknown }>;
  [key: string]: unknown;
};
export type WorkbookTemplate = { id: string; name: string; document: WorkbookDocument };
export type WorkbookProject = {
  schema: 'mindcrafti.workbook-studio/1';
  activeTemplateId: string;
  templates: WorkbookTemplate[];
};
export type WorkbookSnapshot = {
  configured: boolean; version: number; projectJson: string | null;
  updatedAt: string | null;
};
export type WorkbookPreview = {
  studentPdfBase64: string;
  teacherPdfBase64: string;
  studentPages: number;
  teacherPages: number;
  qa: { mathPassed: boolean; layoutPassed: boolean; graphWarnings?: string[] };
};

export const workbookStudioApi = {
  get: () => request<WorkbookSnapshot>('GET', '/admin/workbook-studio'),
  example: () => request<{ lessonJson: string }>('GET', '/admin/workbook-studio/example'),
  save: (expectedVersion: number, projectJson: string) =>
    request<WorkbookSnapshot>('PUT', '/admin/workbook-studio', { expectedVersion, projectJson }),
  render: (lessonJson: string) =>
    request<WorkbookPreview>('POST', '/admin/workbook-studio/render', { lessonJson }),
};

export function validateWorkbookProject(raw: unknown): WorkbookProject {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Неверный формат проекта');
  const project = raw as Partial<WorkbookProject>;
  if (project.schema !== 'mindcrafti.workbook-studio/1'
      || !Array.isArray(project.templates) || project.templates.length < 1 || project.templates.length > 12) {
    throw new Error('Проект должен содержать от 1 до 12 шаблонов');
  }
  const ids = new Set<string>();
  for (const entry of project.templates) {
    if (!entry || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) || ids.has(entry.id)
        || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80
        || !entry.document || typeof entry.document !== 'object'
        || entry.document.meta?.school?.toUpperCase() !== 'MINDCRAFTI SCHOOL'
        || !Number.isInteger(entry.document.meta.durationMinutes)
        || entry.document.meta.durationMinutes < 30 || entry.document.meta.durationMinutes > 240
        || !Array.isArray(entry.document.workbookPages) || !entry.document.workbookPages.length
        || !Array.isArray(entry.document.teacherPages) || !entry.document.teacherPages.length) {
      throw new Error('У одного из шаблонов неверное имя, метаданные или страницы');
    }
    ids.add(entry.id);
  }
  if (!project.activeTemplateId || !ids.has(project.activeTemplateId)) {
    throw new Error('Выбранный шаблон отсутствует');
  }
  return project as WorkbookProject;
}
