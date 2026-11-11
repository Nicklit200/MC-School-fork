import { useEffect, useMemo, useRef, useState } from 'react';
import { workbookStudioApi, validateWorkbookProject, type WorkbookDocument, type WorkbookProject } from '../../api/workbookStudio';
import { GeneratorSettingsPanel } from './GeneratorSettingsPanel';

const KEY = 'mindcrafti.workbook-studio.unsaved';
const fileName = (name: string) => name.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) || 'workbook';

function downloadText(text: string, filename: string) {
  const objectUrl = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function pdfBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'application/pdf' });
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function createCopyPrompt(json: string): string {
  return [
    'Ты редактируешь только содержимое Mindcrafti Workbook Studio.',
    'Верни ТОЛЬКО полный валидный JSON без Markdown, объяснений и блоков кода.',
    'Сохрани структуру meta, workbookPages, teacherPages и все ответы преподавателя.',
    'Текст и оформление должны быть понятными детям, графики крупными, без наложений.',
    'Не добавляй произвольный JavaScript, HTML, CSS, ссылки или API-запросы.',
    'Учитывай, что PDF печатается на A4. Задачи должны помещаться на страницы.',
    'Моя следующая команда уточнит изменения. Вот текущая тетрадь:',
    json,
  ].join('\n\n');
}

/** Instant, read-only content outline while the exact A4 PDF is being verified. */
function describeBlock(raw: unknown, index: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const block = raw as Record<string, unknown>;
  const type = typeof block.type === 'string' ? block.type : 'block';
  const heading = [block.number, block.title, block.label].filter(v => typeof v === 'string' || typeof v === 'number').join('  ');
  const text = [block.subtitle, block.text, block.caption].filter(v => typeof v === 'string' && v.trim()).join('  ');
  const rows = Array.isArray(block.rows) ? block.rows.slice(0, 12) : [];
  return (
    <div key={index} style={{ padding: '10px 12px', borderRadius: 8, background: type === 'exercise' ? '#fffaf5' : '#f7f8fa', border: '1px solid #e9e1d9', marginTop: 8 }}>
      <strong style={{ fontSize: 13 }}>{heading || (type === 'graph' ? 'График' : type === 'geometry' ? 'Геометрия' : type)}</strong>
      {text && <div style={{ marginTop: 4, fontSize: 12, whiteSpace: 'pre-wrap' }}>{text}</div>}
      {(type === 'graph' || type === 'coordinateGrid' || type === 'geometry') &&
        <div style={{ border: '1px dashed #d6a275', background: '#fff4e7', marginTop: 8, padding: 12, borderRadius: 6, fontSize: 12 }}>
          {type === 'geometry' ? 'Геометрическая фигура' : 'Координатная сетка и график'}: точный рисунок будет в PDF
        </div>}
      {rows.map((rawRow, rowIndex) => {
        if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return null;
        const row = rawRow as Record<string, unknown>;
        const expression = Array.isArray(row.math)
          ? row.math.map(token => typeof token === 'string' || typeof token === 'number' ? String(token) : 'формула').join(' ')
          : '';
        return <div key={rowIndex} style={{ fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>
          {typeof row.label === 'string' ? row.label + ' ' : ''}{expression}
        </div>;
      })}
      {Array.isArray(block.given) && <div style={{ fontSize: 12, marginTop: 4 }}>Дано: {block.given.map(String).join('; ')}</div>}
      {Array.isArray(block.find) && <div style={{ fontSize: 12, marginTop: 4 }}>Найти: {block.find.map(String).join('; ')}</div>}
      {typeof block.writeLines === 'number' && block.writeLines > 0 && <div style={{ fontSize: 12, marginTop: 4 }}>Место для решения: {block.writeLines} строк</div>}
    </div>
  );
}

function WorkbookOutline({ document, mode }: { document: WorkbookDocument | null; mode: 'student' | 'teacher' }) {
  const pages = mode === 'student' ? document?.workbookPages : document?.teacherPages;
  if (!pages) return <p>Загружаем тетрадь...</p>;
  return (
    <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: 12, background: '#eceef1', borderRadius: 10 }}>
      <p style={{ fontSize: 12, margin: '0 0 10px' }}>Быстрый просмотр содержания. Точное оформление, формулы и графики проверяются в PDF.</p>
      {pages.map((page, index) => (
        <div key={index} style={{ background: 'white', border: '1px solid #ddd', boxShadow: '0 2px 4px #0001', padding: '16px 20px', margin: '0 auto 14px', maxWidth: 480, minHeight: 320 }}>
          <div style={{ color: '#d96f29', fontSize: 12, fontWeight: 750 }}>MINDCRAFTI SCHOOL · {mode === 'student' ? 'АРБАЙТСХЕФТ' : 'РЕШЕНИЯ'} · {index + 1}</div>
          <h3 style={{ margin: '10px 0 5px', fontSize: 18 }}>{page.title || 'Страница ' + (index + 1)}</h3>
          {typeof page.subtitle === 'string' && <p style={{ fontSize: 12 }}>{page.subtitle}</p>}
          {page.blocks.map(describeBlock)}
        </div>
      ))}
    </div>
  );
}

export function AdminWorkbookStudioPage() {
  const [project, setProject] = useState<WorkbookProject | null>(null);
  const [draft, setDraft] = useState('');
  const [version, setVersion] = useState(0);
  const [activeId, setActiveId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Загружаем редактор...');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [answers, setAnswers] = useState<Blob | null>(null);
  const [appliedDocument, setAppliedDocument] = useState<WorkbookDocument | null>(null);
  const [mode, setMode] = useState<'student' | 'teacher'>('student');
  const [section, setSection] = useState<'workbook' | 'generator'>('workbook');
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => project?.templates.find(template => template.id === activeId), [project, activeId]);
  const previewUrl = useMemo(() => {
    const blob = mode === 'student' ? preview : answers;
    return blob ? URL.createObjectURL(blob) : null;
  }, [preview, answers, mode]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const cloud = await workbookStudioApi.get();
        if (!active) return;
        const initial = cloud.configured && cloud.projectJson
          ? validateWorkbookProject(JSON.parse(cloud.projectJson))
          : {
              schema: 'mindcrafti.workbook-studio/1' as const,
              activeTemplateId: 'sample',
              templates: [{
                id: 'sample',
                name: 'Пример: математика',
                document: JSON.parse((await workbookStudioApi.example()).lessonJson) as WorkbookDocument,
              }],
            };
        if (!active) return;
        setVersion(cloud.version);
        setProject(initial);
        setActiveId(initial.activeTemplateId);
        const initialDocument = initial.templates.find(t => t.id === initial.activeTemplateId)?.document ?? null;
        setDraft(JSON.stringify(initialDocument, null, 2));
        setAppliedDocument(initialDocument);
        setStatus(cloud.configured ? 'Шаблоны загружены с сервера' : 'Открыт пример. Сохраните его, чтобы создать первый шаблон.');
        try {
          const local = sessionStorage.getItem(KEY);
          if (local) setStatus('Найден локальный резервный черновик. Скачайте его до обновления страницы.');
        } catch { /* browser storage may be disabled */ }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Не удалось открыть редактор');
      }
    })();
    return () => { active = false; };
  }, []);

  function updateDraft(next: string) {
    setHistory(previous => [...previous.slice(-19), draft]);
    setDraft(next);
    setPreview(null);
    setAnswers(null);
    setStatus('Код изменён. Нажмите «Применить код» для обновления тетради слева.');
    setError('');
    try { sessionStorage.setItem(KEY, next); } catch { /* export remains available */ }
  }

  function apply() {
    if (!project) return;
    try {
      const document = JSON.parse(draft) as WorkbookDocument;
      const updated = validateWorkbookProject({
        ...project,
        activeTemplateId: activeId,
        templates: project.templates.map(template => template.id === activeId ? { ...template, document } : template),
      });
      setProject(updated);
      setAppliedDocument(document);
      setStatus('JSON принят. Обновляем страницы и проверяем PDF...');
      setError('');
      return document;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Неверный JSON');
      setStatus('Не удалось применить код. Исправьте JSON и попробуйте снова.');
      return null;
    }
  }

  async function render() {
    const document = apply();
    if (!document) return;
    setBusy(true);
    setStatus('Проверяем и печатаем PDF. Платный AI API не используется.');
    try {
      const result = await workbookStudioApi.render(JSON.stringify(document));
      setPreview(pdfBlob(result.studentPdfBase64));
      setAnswers(pdfBlob(result.teacherPdfBase64));
      setStatus('Проверка пройдена: тетрадь ' + result.studentPages + ' стр., ответы ' + result.teacherPages + ' стр.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка PDF-рендеринга');
      setStatus('Содержание применено, но точный PDF не сформирован. Посмотрите ошибку выше.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const document = apply();
    if (!document || !project) return;
    const next = {
      ...project, activeTemplateId: activeId,
      templates: project.templates.map(template => template.id === activeId ? { ...template, document } : template),
    };
    setBusy(true);
    try {
      const saved = await workbookStudioApi.save(version, JSON.stringify(next));
      setVersion(saved.version);
      setProject(next);
      setStatus('Шаблон сохранён на сервере, версия ' + saved.version);
      sessionStorage.removeItem(KEY);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Шаблон не сохранён. Скачайте JSON, чтобы сохранить изменения.');
    } finally {
      setBusy(false);
    }
  }

  async function importJson(file: File) {
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'schema' in parsed) {
        const imported = validateWorkbookProject(parsed);
        setProject(imported);
        setActiveId(imported.activeTemplateId);
        const importedDocument = imported.templates.find(t => t.id === imported.activeTemplateId)?.document ?? null;
        setDraft(JSON.stringify(importedDocument, null, 2));
        setAppliedDocument(importedDocument);
        setPreview(null); setAnswers(null);
        setStatus('Проект загружен из файла. Сохранение на сервере отдельно.');
      } else {
        updateDraft(JSON.stringify(parsed, null, 2));
        setStatus('JSON загружен. Проверьте и примените изменения.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не получилось прочитать JSON');
    }
  }

  function switchTemplate(id: string) {
    if (!project) return;
    const document = apply();
    if (!document) return;
    const templates = project.templates.map(t => t.id === activeId ? { ...t, document } : t);
    const template = templates.find(t => t.id === id);
    if (!template) return;
    setProject({ ...project, templates, activeTemplateId: id });
    setActiveId(id);
    setDraft(JSON.stringify(template.document, null, 2));
    setAppliedDocument(template.document);
    setHistory([]);
    setPreview(null); setAnswers(null);
  }

  function addTemplate() {
    if (!project || project.templates.length >= 12) return;
    const document = apply();
    if (!document) return;
    const name = window.prompt('Название нового шаблона', 'Математика: новый шаблон')?.trim();
    if (!name) return;
    const id = 'template_' + Date.now();
    const templates = project.templates.map(t => t.id === activeId ? { ...t, document } : t);
    setProject({ ...project, templates: [...templates, { id, name: name.slice(0, 80), document: structuredClone(document) }], activeTemplateId: id });
    setActiveId(id);
    setAppliedDocument(document);
    setHistory([]);
    setPreview(null); setAnswers(null);
  }

  function removeTemplate() {
    if (!project || project.templates.length < 2 || !window.confirm('Удалить этот шаблон из текущего проекта?')) return;
    const templates = project.templates.filter(t => t.id !== activeId);
    setProject({ ...project, templates, activeTemplateId: templates[0].id });
    setActiveId(templates[0].id);
    setDraft(JSON.stringify(templates[0].document, null, 2));
    setAppliedDocument(templates[0].document);
    setPreview(null); setAnswers(null);
  }

  function exportProject() {
    const document = apply();
    if (!document || !project) return;
    const next = { ...project, activeTemplateId: activeId,
      templates: project.templates.map(t => t.id === activeId ? { ...t, document } : t) };
    downloadText(JSON.stringify(next, null, 2), 'Mindcrafti_Workbook_Studio.json');
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(createCopyPrompt(draft));
      setStatus('Запрос скопирован. Вставьте в ChatGPT и добавьте нужную правку.');
    } catch { setError('Копирование недоступно. Выделите JSON и скопируйте вручную.'); }
  }

  return (
    <div className="stack" style={{ width: '100%', maxWidth: 'none', paddingBottom: 30 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 23 }}>Редактор тетрадей</h1>
        <p className="muted">Слева тетрадь, справа JSON для ChatGPT. Ручные правки не используют платный AI API.</p>
      </div>
      <nav aria-label="Работа с генератором" style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <button className={section === 'workbook' ? 'btn' : 'btn btn--secondary'}
          onClick={() => setSection('workbook')} type="button">Редактор тетради</button>
        <button className={section === 'generator' ? 'btn' : 'btn btn--secondary'}
          onClick={() => setSection('generator')} type="button">Настройки генератора</button>
      </nav>
      {section === 'generator' ? <GeneratorSettingsPanel currentDocument={appliedDocument} /> : <>
      {error && <div role="alert" className="banner banner--error">{error}</div>}
      <div role="status" className="muted">{status}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select className="input" aria-label="Выбрать шаблон" style={{ maxWidth: 280 }} value={activeId}
          onChange={event => switchTemplate(event.target.value)}>
          {project?.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn btn--secondary" type="button" disabled={!project || project.templates.length >= 12} onClick={addTemplate}>Дублировать шаблон</button>
        <button className="btn btn--ghost" type="button" disabled={!project || project.templates.length < 2} onClick={removeTemplate}>Удалить</button>
        <button className="btn btn--secondary" type="button" onClick={() => fileInput.current?.click()}>Импорт JSON</button>
        <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={event => { const file = event.target.files?.[0]; if (file) void importJson(file); event.target.value = ''; }} />
        <button className="btn btn--secondary" type="button" disabled={!project} onClick={exportProject}>Экспорт проекта</button>
        <button className="btn" type="button" disabled={busy || !project} onClick={() => void save()}>
          {busy ? 'Обработка...' : 'Сохранить шаблон'}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: 14 }}>
        <section className="panel stack" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Предпросмотр</h2>
            <button className="btn btn--secondary" type="button" onClick={() => setMode('student')}>Ученик</button>
            <button className="btn btn--secondary" type="button" onClick={() => setMode('teacher')}>Ответы</button>
          </div>
          <button className="btn" type="button" onClick={() => void render()} disabled={!project || busy}>
            {busy ? 'Проверяем PDF...' : 'Повторить проверку PDF'}
          </button>
          {previewUrl
            ? <iframe title={mode === 'student' ? 'Предпросмотр ученика' : 'Предпросмотр решений'}
                src={previewUrl} style={{ display: 'block', width: '100%', height: 'min(70vh, 820px)', border: '1px solid #ddd' }} />
            : <WorkbookOutline document={appliedDocument} mode={mode} />}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn--secondary" type="button" disabled={!preview} onClick={() => preview && downloadBlob(preview, fileName(selected?.name || 'workbook') + '_Arbeitsheft.pdf')}>PDF ученика</button>
            <button className="btn btn--secondary" type="button" disabled={!answers} onClick={() => answers && downloadBlob(answers, fileName(selected?.name || 'answers') + '_Lehrerloesungen.pdf')}>PDF ответов</button>
          </div>
        </section>
        <section className="panel stack" style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>Код тетради</h2>
          <p className="muted" style={{ margin: 0 }}>Вставьте сюда JSON из ChatGPT. Можно менять текст, задания, графики и пространство для решения.</p>
          <textarea aria-label="JSON тетради" spellCheck={false} value={draft}
            onChange={event => updateDraft(event.target.value)}
            style={{ width: '100%', minHeight: 550, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5, padding: 12 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="btn" type="button" disabled={!project || busy} onClick={() => void render()}>{busy ? 'Применяем и проверяем...' : 'Применить код и показать тетрадь'}</button>
            <button className="btn btn--secondary" type="button" disabled={!history.length}
              onClick={() => { const previous = history[history.length - 1]; setHistory(history.slice(0, -1)); setDraft(previous); setPreview(null); setAnswers(null); }}>Отменить</button>
            <button className="btn" type="button" disabled={!draft} onClick={() => void copyPrompt()}>Скопировать запрос для ChatGPT</button>
          </div>
          <p className="muted">Скопируйте запрос, опишите в ChatGPT нужную правку, затем вставьте полученный JSON обратно. Ни копирование, ни ручное редактирование не расходуют баланс Kolyn.</p>
        </section>
      </div>
      </>}
    </div>
  );
}
