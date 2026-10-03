import { useEffect, useState } from 'react';
import { promptSettingsApi } from '../../api/promptSettings';
import { brandGuideApi } from '../../api/brandGuide';

export function AdminPromptSettingsPage() {
  const [groupPrompt, setGroupPrompt] = useState('');
  const [individualPrompt, setIndividualPrompt] = useState('');
  const [diagnosticPrompt, setDiagnosticPrompt] = useState('');
  const [errorCorrectionPrompt, setErrorCorrectionPrompt] = useState('');
  const [brandGuideText, setBrandGuideText] = useState('');
  const [brandGuideFilename, setBrandGuideFilename] = useState<string | null>(null);
  const [brandGuideHasPdf, setBrandGuideHasPdf] = useState(false);
  const [brandGuideUpdatedAt, setBrandGuideUpdatedAt] = useState<string | null>(null);
  const [brandGuideFile, setBrandGuideFile] = useState<File | null>(null);
  const [brandGuideSaving, setBrandGuideSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([promptSettingsApi.get(), brandGuideApi.get()])
      .then(([settings, brandGuide]) => {
        setGroupPrompt(settings.groupLessonPrompt);
        setIndividualPrompt(settings.individualLessonPrompt);
        setDiagnosticPrompt(settings.diagnosticLessonPrompt);
        setErrorCorrectionPrompt(settings.errorCorrectionPrompt ?? '');
        setBrandGuideText(brandGuide.guideText ?? '');
        setBrandGuideFilename(brandGuide.filename);
        setBrandGuideHasPdf(brandGuide.hasPdf);
        setBrandGuideUpdatedAt(brandGuide.updatedAt);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить промты и Brand Guide'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const settings = await promptSettingsApi.update(groupPrompt, individualPrompt, diagnosticPrompt, errorCorrectionPrompt);
      setGroupPrompt(settings.groupLessonPrompt);
      setIndividualPrompt(settings.individualLessonPrompt);
      setDiagnosticPrompt(settings.diagnosticLessonPrompt);
      setErrorCorrectionPrompt(settings.errorCorrectionPrompt ?? '');
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить промты');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="panel">Загружаем настройки…</div>;

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div>
        <h1 style={{ marginBottom: 8 }}>Промты школы</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Эти инструкции задаёт администратор. Учителя могут использовать актуальные версии в ChatGPT, но не могут их изменять.
        </p>
      </div>

      {error && <div className="banner banner--error">{error}</div>}
      {saved && <div className="banner banner--success">Промты сохранены. Новая версия сразу доступна учителям.</div>}

      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Групповые уроки</h2>
          <p className="muted">Главный промт для подготовки материалов, домашней работы и работы с группой.</p>
        </div>
        <textarea
          className="input"
          value={groupPrompt}
          maxLength={30000}
          onChange={(event) => { setGroupPrompt(event.target.value); setSaved(false); }}
          placeholder="Вставьте промт для групповых уроков…"
          style={{ minHeight: 280, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{groupPrompt.length.toLocaleString()} / 30 000 символов</div>
      </div>

      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Индивидуальные уроки</h2>
          <p className="muted">Главный промт для подготовки индивидуального занятия и домашней работы конкретного ученика.</p>
        </div>
        <textarea
          className="input"
          value={individualPrompt}
          maxLength={30000}
          onChange={(event) => { setIndividualPrompt(event.target.value); setSaved(false); }}
          placeholder="Вставьте промт для индивидуальных уроков…"
          style={{ minHeight: 280, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{individualPrompt.length.toLocaleString()} / 30 000 символов</div>
      </div>

      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Диагностика</h2>
          <p className="muted">Главный промт для пробных диагностических уроков и проверки уровня ученика.</p>
        </div>
        <textarea
          className="input"
          value={diagnosticPrompt}
          maxLength={30000}
          onChange={(event) => { setDiagnosticPrompt(event.target.value); setSaved(false); }}
          placeholder="Вставьте промт для диагностики…"
          style={{ minHeight: 280, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{diagnosticPrompt.length.toLocaleString()} / 30 000 символов</div>
      </div>

      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Работа над ошибками</h2>
          <p className="muted">
            Промт для персонального PDF с реальными фрагментами выполненной работы ученика, объяснением ошибки и тренировкой.
          </p>
        </div>
        <textarea
          className="input"
          value={errorCorrectionPrompt}
          maxLength={30000}
          onChange={(event) => { setErrorCorrectionPrompt(event.target.value); setSaved(false); }}
          placeholder="Вставьте промт для работы над ошибками…"
          style={{ minHeight: 360, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{errorCorrectionPrompt.length.toLocaleString()} / 30 000 символов</div>
      </div>


      <div className="panel stack">
        <div>
          <h2 style={{ margin: 0 }}>Brand Guide</h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            Главный визуальный стандарт Mindcrafti. Коннектор ChatGPT получает отсюда актуальную версию перед созданием PDF,
            домашних заданий, диагностик, отчётов, презентаций и других фирменных материалов.
          </p>
        </div>

        <textarea
          className="input"
          value={brandGuideText}
          maxLength={30000}
          onChange={(event) => { setBrandGuideText(event.target.value); setSaved(false); }}
          placeholder="Правила Brand Guide…"
          style={{ minHeight: 300, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
        />
        <div className="muted">{brandGuideText.length.toLocaleString()} / 30 000 символов</div>

        <div className="stack" style={{ gap: 8 }}>
          <div>
            <strong>PDF:</strong>{' '}
            {brandGuideHasPdf
              ? (brandGuideFilename ?? 'Mindcrafti Brand Guide')
              : 'ещё не загружен'}
          </div>
          {brandGuideUpdatedAt && (
            <div className="muted">
              Обновлено: {new Date(brandGuideUpdatedAt).toLocaleString()}
            </div>
          )}
          <input
            className="input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setBrandGuideFile(event.target.files?.[0] ?? null);
              setSaved(false);
            }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {brandGuideHasPdf && (
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void brandGuideApi.openPdf().catch((e) => setError(e instanceof Error ? e.message : 'Не удалось открыть Brand Guide'))}
              >
                Открыть текущий PDF
              </button>
            )}
            <button
              className="btn"
              type="button"
              disabled={brandGuideSaving}
              onClick={() => {
                setBrandGuideSaving(true);
                setSaved(false);
                setError(null);
                const action = brandGuideFile
                  ? brandGuideApi.uploadPdf(brandGuideFile, brandGuideText)
                  : brandGuideApi.updateText(brandGuideText);
                void action
                  .then((brandGuide) => {
                    setBrandGuideText(brandGuide.guideText ?? '');
                    setBrandGuideFilename(brandGuide.filename);
                    setBrandGuideHasPdf(brandGuide.hasPdf);
                    setBrandGuideUpdatedAt(brandGuide.updatedAt);
                    setBrandGuideFile(null);
                    setSaved(true);
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось сохранить Brand Guide'))
                  .finally(() => setBrandGuideSaving(false));
              }}
            >
              {brandGuideSaving ? 'Сохраняем Brand Guide…' : (brandGuideFile ? 'Сохранить текст и загрузить PDF' : 'Сохранить Brand Guide')}
            </button>
          </div>
        </div>
      </div>

      <button className="btn" type="button" disabled={saving} onClick={() => void save()} style={{ alignSelf: 'flex-start' }}>
        {saving ? 'Сохраняем…' : 'Сохранить промты'}
      </button>
    </div>
  );
}
