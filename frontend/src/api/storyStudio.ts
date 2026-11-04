import { request } from './client';

export type StudioInfo = {
  configured: boolean;
  version: number;
  sha256: string | null;
  sizeBytes: number;
  chunkCount: number;
  updatedAt: string | null;
};
export type StudioSnapshot = StudioInfo & { projectJson: string | null };

export const storyStudioApi = {
  get: () => request<StudioSnapshot>('GET', '/admin/stories/studio'),
  save: (expectedVersion: number, projectJson: string) =>
    request<StudioInfo>('PUT', '/admin/stories/studio', { expectedVersion, projectJson }),
};

export function readStudioLogo(html: string): string {
  const match = html.match(/<script\b[^>]*id=["']bootstrap-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Missing Studio bootstrap');
  const boot = JSON.parse(match[1]) as { logoSrc?: unknown };
  if (typeof boot.logoSrc !== 'string' || !/^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(boot.logoSrc)) {
    throw new Error('Missing original Studio logo');
  }
  return boot.logoSrc;
}

const embeddedLogo = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const source = (value: Record<string, unknown>) => record(value.story)
  && typeof value.css === 'string' && Boolean(value.css.trim())
  && typeof value.html === 'string' && Boolean(value.html.trim());

/** Preserve original sources and embedded branding while accepting both saved formats. */
export function serializeStudioProject(raw: string, logoSrc: string): string {
  if (raw.length > 1_900_000) throw new Error('Project is too large');
  const parsed: unknown = JSON.parse(raw);
  if (!record(parsed)) throw new Error('Invalid Studio project');
  const originalLogo = record(parsed.assets) ? parsed.assets.logoSrc : logoSrc;
  if (typeof originalLogo !== 'string' || !embeddedLogo.test(originalLogo)) throw new Error('Invalid Studio logo');
  let project: Record<string, unknown>;
  if (parsed.schema === 'mindcrafti.story-studio/2') {
    if (!record(parsed.assets)) throw new Error('Missing Studio assets');
    if (!Array.isArray(parsed.templates) || !parsed.templates.length || parsed.templates.length > 20) throw new Error('Invalid Studio templates');
    const ids = new Set<string>();
    for (const template of parsed.templates) {
      if (!record(template) || !source(template) || typeof template.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(template.id)
          || ids.has(template.id) || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80) throw new Error('Invalid Studio template');
      ids.add(template.id);
    }
    if (typeof parsed.activeTemplateId !== 'string' || !ids.has(parsed.activeTemplateId)) throw new Error('Invalid active Studio template');
    project = { ...parsed, schema: 'mindcrafti.story-studio/2', activeTemplateId: parsed.activeTemplateId,
      assets: { ...parsed.assets, logoSrc: originalLogo }, templates: parsed.templates };
  } else {
    if ((parsed.schema !== undefined && parsed.schema !== 'mindcrafti.story-studio/1') || !source(parsed)) throw new Error('Invalid Studio project');
    project = { schema: 'mindcrafti.story-studio/1', story: parsed.story, css: parsed.css, html: parsed.html,
      assets: { ...(record(parsed.assets) ? parsed.assets : {}), logoSrc: originalLogo } };
  }
  const result = JSON.stringify(project);
  if (result.length > 1_900_000 || new TextEncoder().encode(result).length > 4 * 1024 * 1024) {
    throw new Error('Project is too large');
  }
  return result;
}
