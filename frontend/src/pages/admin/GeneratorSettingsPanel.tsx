import { useEffect, useMemo, useState } from 'react';
import { generatorLayoutApi, type GeneratorLayout, type GeneratorLayoutState } from '../../api/generatorLayout';
import type { WorkbookDocument } from '../../api/workbookStudio';

function toPdf(base64: string): Blob {
  const source = atob(base64);
  const bytes = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i++) bytes[i] = source.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}
function usePdfUrl(pdf: Blob | null) {
  const url = useMemo(() => pdf ? URL.createObjectURL(pdf) : null, [pdf]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}
function savePdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

type Props = { currentDocument: WorkbookDocument | null };

export function GeneratorSettingsPanel({ currentDocument }: Props) {
  const [state, setState] = useState<GeneratorLayoutState | null>(null);
  const [layout, setLayout] = useState<GeneratorLayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [studentPdf, setStudentPdf] = useState<Blob | null>(null);
  const [teacherPdf, setTeacherPdf] = useState<Blob | null>(null);
  const [pdfMode, setPdfMode] = useState<'student' | 'teacher'>('student');
  const url = usePdfUrl(pdfMode === 'student' ? studentPdf : teacherPdf);

  useEffect(() => {
    let mounted = true;
    generatorLayoutApi.get().then(saved => {
      if (!mounted) return;
      setState(saved);
      setLayout(JSON.parse(saved.draftJson) as GeneratorLayout);
      setMessage('Параметры загружены. Изменения не затрагивают школу до утверждения.');
    }).catch(cause => { if (mounted) setError(String(cause instanceof Error ? cause.message : cause)); });
    return () => { mounted = false; };
  }, []);

  const dirty = Boolean(state && layout && JSON.stringify(layout) !== JSON.stringify(JSON.parse(state.draftJson)));
  const ready = Boolean(state?.canActivate && !dirty && studentPdf && teacherPdf);
  function change<K extends keyof GeneratorLayout>(key: K, value: GeneratorLayout[K]) {
    if (!layout) return;
    setLayout({ ...layout, [key]: value });
    setStudentPdf(null); setTeacherPdf(null);
    setMessage('Новые параметры ещё не проверены. Сохраните черновик, затем создайте тестовые PDF.');
    setError('');
  }

  async function run(action: () => Promise<GeneratorLayoutState>, success: string) {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      setState(next);
      setLayout(JSON.parse(next.draftJson) as GeneratorLayout);
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка сохранения настроек');
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!state || !layout) return;
    setStudentPdf(null); setTeacherPdf(null);
    void run(() => generatorLayoutApi.saveDraft(state.draftRevision, layout),
      'Черновик сохранён. Производственные тетради пока используют предыдущие правила.');
  }

  async function test() {
    if (!state || !currentDocument) {
      setError('Для теста сначала откройте тетрадь в редакторе.');
      return;
    }
    if (dirty) { setError('Сначала сохраните изменённые настройки генератора.'); return; }
    setBusy(true);
    setError('');
    setMessage('Проверяем математику и компоновку A4 на реальной тетради...');
    try {
      const result = await generatorLayoutApi.test(state.draftRevision, JSON.stringify(currentDocument));
      setStudentPdf(toPdf(result.studentPdfBase64));
      setTeacherPdf(toPdf(result.teacherPdfBase64));
      setState(result.settings);
      setMessage('Успешный тест: '+result.studentPages+' стр. ученика, '+
        result.teacherPages+' стр. ответов. Посмотрите обе PDF перед утверждением.');
    } catch (cause) {
      setStudentPdf(null); setTeacherPdf(null);
      setError(cause instanceof Error ? cause.message : 'Тест PDF не прошёл');
      setMessage('Настройки не утверждены, обычные уроки не изменились.');
    } finally {
      setBusy(false);
    }
  }

  function approve() {
    if (!state || !ready) return;
    if (!window.confirm('Вы проверили тетрадь и решения? Применить новый дизайн ко ВСЕМ следующим генерациям?')) return;
    void run(() => generatorLayoutApi.activate(state.draftRevision, state.activeRevision),
      'Новые правила утверждены и будут применяться ко всем следующим PDF-генерациям школы.');
  }

  function rollback() {
    if (!state || !state.canRollback) return;
    if (!window.confirm('Вернуть предыдущую утверждённую версию генератора?')) return;
    setStudentPdf(null); setTeacherPdf(null);
    void run(() => generatorLayoutApi.rollback(state.activeRevision),
      'Восстановлена предыдущая утверждённая версия. Следующие тетради используют её.');
  }

  if (!layout || !state) return (
    <div className="panel stack">
      <h2>Настройки генератора</h2>
      {error ? <div className="banner banner--error">{error}</div> : <p>Загружаем параметры...</p>}
    </div>
  );

  const controls: Array<{ key: Exclude<keyof GeneratorLayout, 'schema' | 'graphAlignment'>; label: string; min: number; max: number; step: number; suffix: string; hint: string }> = [
    { key:'graphHeightMm', label:'Высота графика', min:60,max:85,step:1,suffix:'мм',
      hint:'Физический размер графика на листе A4. При увеличении может потребоваться больше страниц.' },
    { key:'graphWidthPercent', label:'Ширина графика', min:75,max:100,step:1,suffix:'%',
      hint:'Занимаемая ширина блока. 100% = доступная ширина.' },
    { key:'graphPlotScalePercent', label:'Масштаб координатной сетки', min:90,max:110,step:1,suffix:'%',
      hint:'Увеличивает сам рисунок графика внутри SVG, сохраняя математические масштабы осей.' },
    { key:'blockGapMm', label:'Расстояние между блоками', min:2,max:8,step:0.2,suffix:'мм',
      hint:'Меньше = больше заданий помещается на страницу.' },
    { key:'answerSpacePercent', label:'Место для решения', min:60,max:120,step:5,suffix:'%',
      hint:'Размер пустых рабочих областей относительно действующих настроек.' },
    { key:'taskTitleFontPx', label:'Размер названий заданий', min:12,max:18,step:1,suffix:'px',
      hint:'Размер шрифта заголовков упражнений во всех новых тетрадях.' },
  ];

  return <div className="stack" style={{ maxWidth: 'none', width: '100%' }}>
    <div>
      <h2 style={{ marginBottom: 4 }}>Настройки генератора</h2>
      <p className="muted">Меняют правила оформления для всех будущих тетрадей. Никакой PowerShell и ручной правки файлов. Сначала тест, затем утверждение.</p>
    </div>
    {error && <div className="banner banner--error" role="alert">{error}</div>}
    <div role="status" className="muted">{message}</div>
    <div style={{ display:'flex',gap:10,flexWrap:'wrap',fontSize:13 }}>
      <span>Черновик: версия {state.draftRevision}</span>
      <span>Активная версия: {state.activeRevision}</span>
      <span>{dirty ? 'Есть несохранённые изменения' : state.canActivate ? 'Тест пройден: можно утверждать' : 'Активная версия не изменена'}</span>
    </div>
    <div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,330px),1fr))',gap:16 }}>
      <div className="panel stack" style={{ minWidth:0 }}>
        {controls.map(field => <label key={field.key} style={{ display:'block' }}>
          <div style={{ display:'flex',justifyContent:'space-between',gap:12,marginBottom:5 }}>
            <strong>{field.label}</strong>
            <strong>{layout[field.key]} {field.suffix}</strong>
          </div>
          <input type="range" min={field.min} max={field.max} step={field.step}
            value={layout[field.key] as number} disabled={busy}
            onChange={event => change(field.key, Number(event.target.value))} style={{ width:'100%' }}/>
          <div className="muted" style={{ fontSize:12 }}>{field.hint}</div>
        </label>)}
        <label>
          <div style={{ fontWeight:700,marginBottom:8 }}>Выравнивание графиков</div>
          <select className="input" value={layout.graphAlignment} disabled={busy}
            onChange={event => change('graphAlignment', event.target.value as 'left' | 'center')}>
            <option value="left">Прижать к левому краю</option>
            <option value="center">По центру</option>
          </select>
        </label>
        <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
          <button className="btn" type="button" onClick={saveDraft} disabled={busy || !dirty}>Сохранить черновик</button>
          <button className="btn btn--secondary" type="button" onClick={() => void test()}
            disabled={busy || dirty || !currentDocument}>Проверить на тетради</button>
        </div>
        <hr style={{ width:'100%',border:'none',borderTop:'1px solid #ddd' }}/>
        <button className="btn" type="button" disabled={!ready || busy} onClick={approve}>Утвердить для будущих генераций</button>
        <button className="btn btn--secondary" type="button" disabled={!state.canRollback || busy} onClick={rollback}>Вернуть предыдущую версию</button>
        <p className="muted" style={{ fontSize:12 }}>«Сохранить» не меняет уроки. «Проверить» создаёт тестовые PDF, но не публикует их ученикам. Только «Утвердить» обновляет правила новых генераций.</p>
      </div>
      <div className="panel stack" style={{ minWidth:0 }}>
        <h3 style={{ margin:0 }}>Тестовая тетрадь</h3>
        <p className="muted" style={{ margin:0 }}>Используется текущая тетрадь, открытая в соседней вкладке редактора. Проверяйте обычные задания и графики.</p>
        <div style={{ display:'flex',gap:8 }}>
          <button type="button" className="btn btn--secondary" disabled={!studentPdf} onClick={() => setPdfMode('student')}>Ученик</button>
          <button type="button" className="btn btn--secondary" disabled={!teacherPdf} onClick={() => setPdfMode('teacher')}>Решения</button>
        </div>
        {url ? <iframe title="Тестовые PDF генератора" src={url}
          style={{ width:'100%',height:'min(72vh,810px)',border:'1px solid #ddd',borderRadius:8 }} />
          : <div style={{ border:'1px dashed #ddd',minHeight:360,padding:24,borderRadius:8 }}>
              <h3>Тест ещё не выполнен</h3>
              <p>Настрой параметры слева, сохрани черновик и нажми «Проверить на тетради».</p>
            </div>}
        <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
          <button className="btn btn--secondary" disabled={!studentPdf} onClick={() => studentPdf && savePdf(studentPdf,'Mindcrafti_Layout_Test_Student.pdf')}>Скачать тетрадь</button>
          <button className="btn btn--secondary" disabled={!teacherPdf} onClick={() => teacherPdf && savePdf(teacherPdf,'Mindcrafti_Layout_Test_Teacher.pdf')}>Скачать решения</button>
        </div>
      </div>
    </div>
  </div>;
}
