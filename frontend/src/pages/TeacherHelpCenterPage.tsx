import { useEffect, useMemo, useState } from 'react';
import { getAccessToken, request } from '../api/client';
import './teacher-help-center.css';

type HelpArticle = {
  id: string; title: string; summary: string; body: string; keywords: string[];
  route: string; related: string[]; verifiedSources: string[]; imageIds: string[];
};
type HelpImage = { id: string; title: string; description: string; capturedOn: string; controls: string[] };
type HelpGuide = { version: string; reviewedOn: string; articles: HelpArticle[]; images: HelpImage[] };
type EditorEntry = { id: string; draft: HelpArticle|null; published: HelpArticle|null;
  revision: number; publishedAt: string|null; updatedAt: string };
type History = { revision: number; articleId: string; publishedJson: string; publishedAt: string };
const EMPTY: HelpArticle = { id: '', title: '', summary: '', body: '', keywords: [],
  route: '/teacher/help', related: [], verifiedSources: [], imageIds: [] };
function split(value: string): string[] {
  return value.split(/[\n,]/).map(v => v.trim()).filter(Boolean);
}

function HelpScreenshot({ id, title }: { id: string; title: string }) {
  const [url, setUrl] = useState<string|null>(null);
  useEffect(() => {
    let active = true;
    let currentUrl: string|null = null;
    const token = getAccessToken();
    fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1'}/teacher-help/images/${encodeURIComponent(id)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => { if (!r.ok) throw Error('Image unavailable'); return r.blob(); })
      .then(blob => {
        if (!active) return;
        currentUrl = URL.createObjectURL(blob);
        setUrl(currentUrl);
      }).catch(() => setUrl(null));
    return () => { active = false; if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [id]);
  if (!url) return null;
  return <a className="help-screenshot" href={url} target="_blank" rel="noreferrer" title="Открыть изображение">
    <img alt={title} src={url} loading="lazy" /><span>{title}</span>
  </a>;
}

export function TeacherHelpCenterPage({ admin = false }: { admin?: boolean }) {
  const [guide, setGuide] = useState<HelpGuide|null>(null);
  const [entries, setEntries] = useState<EditorEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('lesson-flow');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HelpArticle>(EMPTY);
  const [keywordText, setKeywordText] = useState('');
  const [relatedText, setRelatedText] = useState('');
  const [imageText, setImageText] = useState('');
  const [newId, setNewId] = useState('');
  const [imageFile, setImageFile] = useState<File|null>(null);
  const [imageId, setImageId] = useState('');
  const [imageTitle, setImageTitle] = useState('');
  const [imageDescription, setImageDescription] = useState('');
  const [history, setHistory] = useState<History[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function reload() {
    const g=await request<HelpGuide>('GET','/teacher-help');
    setGuide(g);
    if(admin) setEntries(await request<EditorEntry[]>('GET','/teacher-help/admin'));
  }
  useEffect(() => { void reload().catch(e => setMessage(String(e))); }, [admin]);

  const articles=guide?.articles ?? [];
  const filtered=useMemo(() => articles.filter(a => (
    a.title+' '+a.summary+' '+a.keywords.join(' ')+' '+a.body
  ).toLocaleLowerCase().includes(query.toLocaleLowerCase())),[articles,query]);
  const article=articles.find(a=>a.id===selected);
  const entry=entries.find(e=>e.id===selected);
  const imageById=new Map((guide?.images ?? []).map(i=>[i.id,i]));
  const customUnpublished=entries.filter(e=>!articles.some(a=>a.id===e.id));

  function editArticle(id: string) {
    const base=entries.find(e=>e.id===id)?.draft || articles.find(a=>a.id===id) || { ...EMPTY, id };
    setSelected(id); setDraft({...base});
    setKeywordText(base.keywords.join(', ')); setRelatedText(base.related.join(', '));
    setImageText(base.imageIds.join(', ')); setEditing(true);
    setMessage('');
  }
  async function saveDraft() {
    if(!draft.id.match(/^[a-z0-9-]{1,80}$/)) {setMessage('Укажите ID латинскими строчными буквами и дефисами.');return;}
    await run(async() => {
      await request('PUT',`/teacher-help/admin/${draft.id}/draft`,{
        ...draft,keywords:split(keywordText),related:split(relatedText),imageIds:split(imageText)
      });
      await reload();setMessage('Черновик сохранён. Учителя и MCH3 пока видят опубликованную версию.');
    });
  }
  async function publish(id: string) {
    await run(async() => {
      await request('POST',`/teacher-help/admin/${id}/publish`);
      await reload();setEditing(false);
      setMessage('Опубликовано. Сайт и MCH3 читают новую версию.');
    });
  }
  async function loadHistory(id: string) {
    await run(async()=>setHistory(await request<History[]>('GET',`/teacher-help/admin/${id}/history`)));
  }
  async function restore(id: string,revision: number) {
    if(!window.confirm(`Вернуть статью к версии ${revision} и опубликовать её?`))return;
    await run(async()=>{await request('POST',`/teacher-help/admin/${id}/restore/${revision}`);
      await reload();setHistory([]);setEditing(false);setMessage('Версия восстановлена и опубликована.');});
  }
  async function uploadImage() {
    if(!imageFile||!imageId.trim())return;
    await run(async()=>{
      const body=new FormData();
      body.append('file',imageFile);
      body.append('title',imageTitle||imageId);body.append('description',imageDescription||imageTitle||imageId);
      const token=getAccessToken();
      const response=await fetch(`${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api/v1'}/teacher-help/admin/images/${encodeURIComponent(imageId)}`,{
        method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body
      });
      if(!response.ok)throw Error('Не удалось загрузить изображение');
      await reload();setMessage(`Изображение ${imageId} загружено. Добавьте этот ID в статью и опубликуйте.`);
      setImageFile(null);
    });
  }
  async function run(action:()=>Promise<void>) {
    setBusy(true);setMessage('');
    try{await action();}
    catch(e){setMessage(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }

  return <div className="help-center">
    <header className="help-heading">
      <div><span className="help-eyebrow">MINDCRAFTI SCHOOL · HELP CENTER</span>
        <h1>{admin?'Управление базой знаний':'Справка преподавателя'}</h1>
        <p>Актуальные инструкции по работе с уроками, досками, документами и Kolyn.</p></div>
      {admin&&<button className="btn" type="button" onClick={()=>{
        const id=newId.trim().toLowerCase();if(!/^[a-z0-9-]{1,80}$/.test(id)){setMessage('Введите ID новой статьи.');return;}
        editArticle(id);
      }}>Новая статья</button>}
    </header>
    {admin&&<div className="help-new-id"><label htmlFor="new-help-id">ID новой статьи</label>
      <input id="new-help-id" value={newId} onChange={e=>setNewId(e.target.value)}
        placeholder="naprimer-provedenie-uroka" /></div>}
    {message&&<p className="help-notice" role="status">{message}</p>}
    <div className="help-layout">
      <aside className="help-side">
        <label htmlFor="help-search">Поиск по справке</label>
        <input id="help-search" type="search" value={query} onChange={e=>setQuery(e.target.value)}
          placeholder="Например, завершение урока" />
        <div className="help-article-list">
          {filtered.map(a=><button key={a.id} type="button" className={a.id===selected?'selected':''}
            onClick={()=>{setSelected(a.id);setEditing(false);setHistory([]);setMessage('');}}>
            <strong>{a.title}</strong><small>{a.summary}</small></button>)}
          {filtered.length===0&&<p>Ничего не найдено.</p>}
          {admin&&customUnpublished.length>0&&<div className="help-drafts"><strong>Черновики без публикации</strong>
            {customUnpublished.map(x=><button key={x.id} onClick={()=>editArticle(x.id)} type="button">{x.draft?.title||x.id}</button>)}</div>}
        </div>
      </aside>
      <section className="help-content">
        {!editing&&article&&<>
          <div className="help-meta"><span>Проверено: {guide?.reviewedOn}</span>
            {admin&&<span>Версия: {entry?.revision??0}</span>}</div>
          <h2>{article.title}</h2><p className="help-summary">{article.summary}</p>
          <div className="help-body">{article.body}</div>
          {article.imageIds.length>0&&<div className="help-images">
            {article.imageIds.map(id=><HelpScreenshot key={id} id={id}
              title={imageById.get(id)?.title??id} />)}</div>}
          {article.related.length>0&&<div className="help-related"><strong>Смотрите также</strong>
            {article.related.map(id=><button type="button" key={id} onClick={()=>setSelected(id)}>
              {articles.find(a=>a.id===id)?.title??id}</button>)}</div>}
          {admin&&<div className="help-actions"><button className="btn" onClick={()=>editArticle(selected)}>Редактировать</button>
            <button className="btn btn--ghost" onClick={()=>void loadHistory(selected)}>История версий</button></div>}
        </>}
        {!editing&&!article&&<div><h2>Выберите тему</h2><p>Выберите инструкцию слева.</p></div>}
        {admin&&editing&&<div className="help-editor">
          <div className="help-meta">Редактор · {draft.id}</div>
          <h2>{draft.title||'Новая инструкция'}</h2>
          <label>Название<input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))}/></label>
          <label>Краткое описание<textarea rows={2} value={draft.summary} onChange={e=>setDraft(d=>({...d,summary:e.target.value}))}/></label>
          <label>Текст инструкции<textarea rows={15} value={draft.body} onChange={e=>setDraft(d=>({...d,body:e.target.value}))}/></label>
          <label>Ключевые слова через запятую<input value={keywordText} onChange={e=>setKeywordText(e.target.value)}/></label>
          <label>Связанные статьи (ID через запятую)<input value={relatedText} onChange={e=>setRelatedText(e.target.value)}/></label>
          <label>ID иллюстраций через запятую<input value={imageText} onChange={e=>setImageText(e.target.value)}/></label>
          <div className="help-actions">
            <button className="btn" disabled={busy} onClick={()=>void saveDraft()}>Сохранить черновик</button>
            <button className="btn btn--ghost" disabled={busy||!entries.some(x=>x.id===draft.id&&x.draft)}
              onClick={()=>void publish(draft.id)}>Опубликовать сохранённый черновик</button>
            <button className="btn btn--ghost" onClick={()=>setEditing(false)}>Закрыть</button>
          </div>
          <p className="help-tip">Сначала сохраните черновик, затем опубликуйте его. До публикации MCH3 продолжает читать старую версию.</p>
        </div>}
        {admin&&history.length>0&&<div className="help-history"><h3>История публикаций</h3>
          {history.map(h=><div key={h.revision}><span>Версия {h.revision} · {new Date(h.publishedAt).toLocaleString('ru-RU')}</span>
            <button className="btn btn--ghost" disabled={busy} onClick={()=>void restore(h.articleId,h.revision)}>Восстановить</button></div>)}</div>}
        {admin&&<div className="help-upload"><h3>Загрузить скриншот</h3>
          <p>JPEG, PNG или WebP до 500 КБ. Не загружайте снимки с персональными данными учеников.</p>
          <div className="help-upload-fields">
            <input aria-label="ID скриншота" placeholder="ID: my-button" value={imageId} onChange={e=>setImageId(e.target.value)}/>
            <input aria-label="Название скриншота" placeholder="Название" value={imageTitle} onChange={e=>setImageTitle(e.target.value)}/>
            <input aria-label="Описание скриншота" placeholder="Описание" value={imageDescription} onChange={e=>setImageDescription(e.target.value)}/>
            <input aria-label="Выберите изображение" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setImageFile(e.target.files?.[0]??null)}/>
          </div><button className="btn btn--ghost" disabled={busy||!imageFile} onClick={()=>void uploadImage()}>Загрузить изображение</button></div>}
      </section>
    </div>
  </div>;
}
