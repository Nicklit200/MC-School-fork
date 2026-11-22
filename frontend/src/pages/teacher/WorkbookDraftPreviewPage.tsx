import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { requestBlob } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

type PdfKind = 'workbook' | 'answers';

/**
 * Stable school-site URL for an unpublished Mindcrafti workbook draft.
 * PDFs are fetched with the current staff session each time this page opens.
 * The link itself never expires and carries no public download capability.
 */
export function WorkbookDraftPreviewPage() {
  const { teacherId = '', draftId = '' } = useParams();
  const { user } = useAuth();
  const [kind, setKind] = useState<PdfKind>('workbook');
  const [files, setFiles] = useState<Partial<Record<PdfKind, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = user?.role === 'ADMIN';
  const allowed = Boolean(isAdmin || (user?.role === 'TEACHER' && user.id === teacherId));

  useEffect(() => {
    if (!allowed || !teacherId || !draftId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    setLoading(true);
    setFiles({});
    setError(null);

    async function load() {
      try {
        const prefix = `/workbook-drafts/${encodeURIComponent(teacherId)}/${encodeURIComponent(draftId)}`;
        const workbook = URL.createObjectURL(await requestBlob(`${prefix}/workbook`));
        urls.push(workbook);
        if (cancelled) return;
        setFiles({ workbook });
        setLoading(false);
        try {
          const answers = URL.createObjectURL(await requestBlob(`${prefix}/answers`));
          urls.push(answers);
          if (!cancelled) setFiles(old => ({ ...old, answers }));
        } catch {
          // A missing answers file does not prevent viewing the student PDF.
        }
      } catch {
        if (!cancelled) {
          setError('Тетрадь недоступна. Проверьте доступ к уроку или откройте ссылку после входа в Mindcrafti.');
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [allowed, teacherId, draftId]);

  const current = files[kind];
  const filename = kind === 'workbook' ? 'Mindcrafti_Arbeitsheft.pdf' : 'Mindcrafti_Lehrerloesungen.pdf';
  const back = isAdmin ? '/admin/lessons' : '/teacher/lessons';

  if (!allowed) {
    return <div role="alert" className="panel" style={{ padding: 24 }}>
      Этот черновик доступен только администратору школы или преподавателю его урока.
    </div>;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', flexDirection: 'column',
      background: '#fff', color: '#070a20', paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', borderBottom: '1px solid #e5e7eb' }}>
        <div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>MINDCRAFTI SCHOOL · сохранённый черновик</div>
          <strong>{kind === 'workbook' ? 'Рабочая тетрадь Виталины' : 'Ответы для преподавателя'}</strong>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Черновик не опубликован ученику</div>
        </div>
        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }} aria-label="Материалы">
          <button className="btn btn--secondary" type="button" onClick={() => setKind('workbook')}
            aria-pressed={kind === 'workbook'}>Тетрадь</button>
          <button className="btn btn--secondary" type="button" onClick={() => setKind('answers')}
            aria-pressed={kind === 'answers'} disabled={!files.answers}>Ответы</button>
          {current && <>
            <a className="btn btn--secondary" href={current} target="_blank" rel="noreferrer">Открыть PDF</a>
            <a className="btn btn--secondary" href={current} download={filename}>Скачать PDF</a>
          </>}
          <Link className="btn" to={back}>К урокам</Link>
        </nav>
      </header>
      {loading ? <div role="status" style={{ padding: 24 }}>Загружаем сохранённый PDF…</div>
        : error ? <div role="alert" style={{ padding: 24 }}>{error}</div>
          : current ? <iframe title={kind === 'workbook' ? 'PDF рабочей тетради' : 'PDF ответов преподавателя'}
              src={current} style={{ flex: 1, width: '100%', border: 'none', minHeight: 0 }}/>
            : <div role="status" style={{ padding: 24 }}>Материал пока недоступен.</div>}
    </div>
  );
}
