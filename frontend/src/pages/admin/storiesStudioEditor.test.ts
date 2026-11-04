import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from './mindcrafti-studio.html?raw';

const script = readFileSync(resolve(process.cwd(), 'public/stories-studio/editor.js'), 'utf8');
const storageKey = 'mindcrafti-stories-studio-v1';
const original = { story: { headline_1: 'Исходный текст', items: [{ text: 'Первый' }], custom: { keep: ['yes', 42] } },
  css: ':root { --accent: #123456; --custom:  10px; }\r\n.story{color:var(--accent)}',
  html: '<div class="story"><img src="{{logo_src}}"><p>{{headline_1}}</p></div>', assets: { logoSrc: 'data:image/png;base64,YQ==' } };
type Template = { id: string; name: string; story: Record<string, any>; css: string; html: string };
type Collection = { schema: string; activeTemplateId: string; assets: { logoSrc: string }; templates: Template[] };
const saved = (): Collection => JSON.parse(localStorage.getItem(storageKey)!);
const input = (selector: string, value: string) => {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); return field;
};
const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.click();
const progress = () => click('[data-template="template-2"]');
const preview = () => new DOMParser().parseFromString((document.getElementById('storyFrame') as HTMLIFrameElement).srcdoc, 'text/html');
let listeners: [EventTarget, string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined][];
let blobs: Blob[];

function start(value: unknown = original) {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  localStorage.setItem(storageKey, JSON.stringify(value));
  window.eval(script);
}

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); listeners = []; blobs = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      listeners.push([target, type, listener as EventListener, options]); add(type, listener, options);
    });
  }
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:studio-' + blobs.length; });
    static revokeObjectURL = vi.fn();
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
  listeners.forEach(([target, type, listener, options]) => target.removeEventListener(type, listener, options));
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '';
});

describe('Stories Studio named editor templates', () => {
  it.each(['button', 'enter'])('migrates the original exactly and keeps it unchanged through switching and renaming with %s', action => {
    start();
    expect(saved().schema).toBe('mindcrafti.story-studio/2');
    expect(saved().templates[0]).toEqual({ id: 'template-1', name: 'Новости образования', story: original.story, css: original.css, html: original.html });
    expect(saved().assets.logoSrc).toBe(original.assets.logoSrc);
    progress(); input('#templateName', 'Мои результаты');
    expect(document.getElementById('renameTemplateBtn')).toHaveAttribute('type', 'button');
    if(action==='button')click('#renameTemplateBtn');
    else {
      const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
      document.getElementById('templateName')!.dispatchEvent(enter);expect(enter.defaultPrevented).toBe(true);
    }
    input('[data-content="student_label"]', 'Анонимный ученик');
    input('[data-content="problem_text"]', 'Сложно сокращать дроби');
    vi.advanceTimersByTime(100);
    click('[data-template="template-1"]');
    expect(saved().templates[0]).toEqual({ id: 'template-1', name: 'Новости образования', story: original.story, css: original.css, html: original.html });
    expect(saved().templates[1]).toMatchObject({ id: 'template-2', name: 'Мои результаты', story: { student_label: 'Анонимный ученик', problem_text: 'Сложно сокращать дроби' } });
  });

  it('flushes outgoing raw CSS before switching and never applies its delayed buffer to another template', () => {
    start(); const css = original.css + '\n.original-only{color:red}';
    input('#codeEditor', css).focus(); progress(); vi.advanceTimersByTime(500);
    expect(saved().templates[0].css).toBe(css.replace(/\r\n/g, '\n'));
    expect(saved().templates[1].css).not.toContain('original-only');
    expect((document.getElementById('codeEditor') as HTMLTextAreaElement).value).toBe(saved().templates[1].css);
  });

  it('keeps invalid JSON on the originating tab until corrected', () => {
    start(); click('[data-code="json"]'); input('#codeEditor', '{ invalid').focus(); progress();
    expect(saved().activeTemplateId).toBe('template-1');
    expect(document.querySelector('[data-template="template-1"]')).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('codeError')).not.toHaveClass('hidden');
    const corrected = { ...original.story, headline_1: 'Исправлено' };
    input('#codeEditor', JSON.stringify(corrected)); progress(); vi.advanceTimersByTime(500);
    expect(saved().templates[0].story).toEqual(corrected);
    expect(saved().templates[1].story.kind).toBe('progress');
  });

  it('renders relative percentage growth, bounds numeric bars and normalizes new visible punctuation without changing original fields', () => {
    const source = structuredClone(original); source.story.headline_1 = 'Текст \u2014 источник \u2013 точный'; start(source);
    expect(preview().body.textContent).toContain('Текст - источник - точный');
    expect(saved().templates[0].story.headline_1).toBe(source.story.headline_1);
    progress(); expect(preview().querySelector('.pill-label')?.textContent).toBe('Результаты учеников');
    expect([...preview().querySelectorAll('.skill-delta')].map(node => node.textContent)).toEqual(['+27%', '+8%']);
    input('[data-skill="0"][data-skill-field="before"]', '0');
    input('[data-skill="0"][data-skill-field="after"]', '900'); vi.advanceTimersByTime(100);
    expect(preview().querySelector('.skill-delta')?.textContent).toBe('Новая оценка');
    expect(preview().querySelector('.tube-row.after .tube-fill')?.getAttribute('style')).toBe('width:100%');
    expect(preview().body.textContent).not.toMatch(/[\u2013\u2014]/);
  });

  it('binds a delayed photo to its originating template after switching', () => {
    const readers: { onload: (() => void) | null; result: string }[] = [], images: { onload: (() => void) | null }[] = [];
    vi.stubGlobal('FileReader', class { onload = null; result = 'data:image/jpeg;base64,Yg=='; constructor() { readers.push(this); } readAsDataURL() {} });
    vi.stubGlobal('Image', class { onload = null; width = 400; height = 600; src = ''; constructor() { images.push(this); } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,Yw==');
    start(); const file = document.getElementById('photoInput')!;
    Object.defineProperty(file, 'files', { value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] });
    file.dispatchEvent(new Event('change')); readers[0].onload!(); progress(); images[0].onload!();
    expect(saved().templates[0].story).toMatchObject({ photoEnabled: true, photoData: 'data:image/jpeg;base64,Yw==' });
    expect(saved().templates[1].story.photoData).toBe('');
  });

  it('cancels an earlier photo when a single-template import replaces that source', async () => {
    const readers: { onload: (() => void) | null; result: string }[] = [], images: { onload: (() => void) | null }[] = [];
    vi.stubGlobal('FileReader', class { onload = null; result = 'data:image/jpeg;base64,Yg=='; constructor() { readers.push(this); } readAsDataURL() {} });
    vi.stubGlobal('Image', class { onload = null; width = 400; height = 600; src = ''; constructor() { images.push(this); } });
    start(); const photo = document.getElementById('photoInput')!;
    Object.defineProperty(photo, 'files', { value: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] });
    photo.dispatchEvent(new Event('change')); readers[0].onload!();
    const imported = { ...original, story: { ...original.story, photoEnabled: false, photoData: '', headline_1: 'Новый импорт' } };
    const file = document.getElementById('importFile')!;
    Object.defineProperty(file, 'files', { value: [{ text: async () => JSON.stringify(imported) }] });
    file.dispatchEvent(new Event('change'));
    for(let index=0;index<4;index++) await Promise.resolve();
    images[0].onload!();
    expect(saved().templates[0].story).toEqual(imported.story);
  });

  it('keeps missing imported scores unknown instead of presenting them as zero', () => {
    start(); progress(); const content=saved().templates[1].story;
    content.skills[0].before=null; content.skills[1].after='';
    click('[data-code="json"]'); input('#codeEditor', JSON.stringify(content)); vi.advanceTimersByTime(400);
    const rows=preview().querySelectorAll('.tube-row');
    for(const index of [0,3]){
      expect(rows[index].querySelector('.tube-value')?.textContent).toBe('?');
      expect(rows[index].querySelector('[role="meter"]')?.hasAttribute('aria-valuenow')).toBe(false);
      expect(rows[index].querySelector('[role="meter"]')?.getAttribute('aria-valuetext')).toBe('Нет оценки');
      expect(rows[index].querySelector('.tube-fill')?.getAttribute('style')).toBe('width: 0%;');
    }
    expect(saved().templates[1].story.skills[0].before).toBeNull();
  });

  it('imports a delayed single-template file into its original tab', async () => {
    let finish!: (value: string) => void;
    const content = new Promise<string>(resolve => { finish=resolve; });
    start(); const file = document.getElementById('importFile')!;
    Object.defineProperty(file, 'files', { value: [{ text: () => content }] });
    file.dispatchEvent(new Event('change')); progress();
    const imported = { ...original, story: { ...original.story, headline_1: 'Импорт в исходную вкладку' } };
    finish(JSON.stringify(imported));
    for(let index=0;index<4;index++) await Promise.resolve();
    expect(saved().activeTemplateId).toBe('template-2');
    expect(saved().templates[0].story.headline_1).toBe('Импорт в исходную вкладку');
    expect(saved().templates[1].story.kind).toBe('progress');
    expect(saved().templates[1].story.student_label).toBe('Имя ученика');
  });

  it('resets only the selected source and exports the complete collection', () => {
    const downloads: string[] = []; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    start(); input('[data-content="headline_1"]', 'Новая новость'); vi.advanceTimersByTime(100); progress();
    input('[data-content="student_label"]', 'Черновик'); vi.advanceTimersByTime(100); click('#resetBtn'); click('#saveProjectBtn');
    expect(saved().templates[0].story.headline_1).toBe('Новая новость');
    expect(saved().templates[1].story.student_label).toBe('Имя ученика');
    expect(downloads).toContain('mindcrafti-story-project.json'); expect(blobs.at(-1)?.type).toContain('application/json');
  });

  it('exports active compiled HTML and includes the writing rule in the copied prompt', async () => {
    const downloads: string[] = []; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    start(); progress(); input('[data-content="student_label"]', 'Ученик'); vi.advanceTimersByTime(100);
    click('#exportHtmlBtn'); expect(downloads.at(-1)).toContain('Результаты учеников.html');
    expect(blobs.at(-1)?.type).toContain('text/html');
    click('#copyPromptBtn'); await Promise.resolve();
    const prompt = vi.mocked(navigator.clipboard.writeText).mock.lastCall![0];
    expect(prompt).toContain('U+2013'); expect(prompt).toContain('обычный дефис'); expect(prompt).toContain('Результаты учеников');
    expect(prompt).not.toMatch(/[\u2013\u2014]/);
  });

  it('renders valid PNG source from the selected snapshot even if the tab changes while its image loads', async () => {
    const images: { onload: (() => void) | null; src: string }[] = [], downloads: string[] = [];
    vi.stubGlobal('Image', class { onload = null; onerror = null; src = ''; constructor() { images.push(this); } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
    start(); progress(); click('#exportPngBtn'); click('[data-template="template-1"]');
    const svg = decodeURIComponent(images[0].src.split(',')[1]);
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
    expect(svg).toContain('Результаты учеников'); expect(svg).not.toContain('Исходный текст');
    images[0].onload!();
    for (let index=0;index<5;index++) await Promise.resolve();
    expect(downloads.at(-1)).toBe('mindcrafti-Результаты учеников.png');
    expect(blobs.at(-1)?.type).toBe('image/png');
  });
});
