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

/** Include the exact logo displayed by editor.js; never invent a replacement or load external URLs. */
export function serializeStudioProject(raw: string, logoSrc: string): string {
  if (raw.length > 1_900_000) throw new Error('Project is too large');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Studio project');
  const p = parsed as Record<string, unknown>;
  if (!p.story || typeof p.story !== 'object' || Array.isArray(p.story)
      || typeof p.css !== 'string' || !p.css.trim()
      || typeof p.html !== 'string' || !p.html.trim()) throw new Error('Invalid Studio project');
  const result = JSON.stringify({ schema: 'mindcrafti.story-studio/1', story: p.story,
    css: p.css, html: p.html, assets: { logoSrc } });
  if (result.length > 1_900_000 || new TextEncoder().encode(result).length > 4 * 1024 * 1024) {
    throw new Error('Project is too large');
  }
  return result;
}
