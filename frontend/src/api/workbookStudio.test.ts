import { describe, expect, it } from 'vitest';
import { validateWorkbookProject } from './workbookStudio';

const document = {
  meta: { school: 'MINDCRAFTI SCHOOL', durationMinutes: 60 },
  workbookPages: [{ blocks: [{ type: 'exercise', rows: [{ math: ['1/2', '+', '1/2'] }] }] }],
  teacherPages: [{ blocks: [{ type: 'solutions', items: [{ math: ['1/2', '+', '1/2', '=', '1'] }] }] }],
};
const project = { schema: 'mindcrafti.workbook-studio/1', activeTemplateId: 'math',
  templates: [{ id: 'math', name: 'Brüche', document }] };

describe('workbook template editor schema', () => {
  it('accepts the shared generator contract', () => {
    expect(validateWorkbookProject(project).templates[0].name).toBe('Brüche');
  });
  it('rejects missing teacher answer pages', () => {
    expect(() => validateWorkbookProject({ ...project, templates: [
      { ...project.templates[0], document: { ...document, teacherPages: [] } },
    ] })).toThrow();
  });
  it('rejects duplicate template ids', () => {
    expect(() => validateWorkbookProject({ ...project, templates: [
      project.templates[0], { ...project.templates[0], name: 'Duplicate' },
    ] })).toThrow();
  });
  it('rejects missing selected id', () => {
    expect(() => validateWorkbookProject({ ...project, activeTemplateId: 'unknown' })).toThrow();
  });
});
