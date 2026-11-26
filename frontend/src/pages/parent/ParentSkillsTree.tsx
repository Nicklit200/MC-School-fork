import { useEffect, useMemo, useRef, useState } from 'react';
import { parentApi, type ParentSkillsDashboard, type ParentSkillTreeSnapshot } from '../../api/parent';

type Props = {
  data: ParentSkillsDashboard;
  focusedSkillId: string | null;
  onSelectSkill: (skillId: string) => void;
  language: 'RU' | 'DE';
};

/** Embeds the original Mindcrafti hierarchy with private, read-only child data. */
export function ParentSkillsTree({ data, focusedSkillId, onSelectSkill, language }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [snapshot, setSnapshot] = useState<ParentSkillTreeSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const de = language === 'DE';

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError('');
    setLoaded(false);
    parentApi.skillsTree(data.studentId)
      .then(board => { if (active) setSnapshot(board); })
      .catch(failure => { if (active) setError(String(failure?.message || failure)); });
    return () => { active = false; };
  }, [data.studentId]);

  // The tree receives exactly the same skill IDs and mastery scores used by
  // the parent's line chart; only the curriculum geometry is fetched separately.
  const progress = useMemo(() => {
    if (!snapshot || snapshot.boardId !== data.boardId) return null;
    const mastery = Object.fromEntries(data.skills
      .filter(skill => skill.mastery != null)
      .map(skill => [skill.id, skill.mastery as number]));
    const history = data.trend
      .filter(change => change.previous != null)
      .map(change => ({
        skillId: change.skillId, previousMastery: change.previous,
        mastery: change.current, updatedAt: change.at,
      }));
    return {
      ...snapshot,
      student: { fullName: data.studentName, grade: data.grade, schoolType: data.schoolType },
      mastery, history, allowedSkillIds: data.skills.map(skill => skill.id),
      overallPercent: data.confirmedPercent,
      assessedSkills: data.assessedSkills, totalSkills: data.totalSkills,
      updatedAt: data.updatedAt,
    };
  }, [snapshot, data]);

  useEffect(() => {
    if (!loaded || !progress) return;
    frame.current?.contentWindow?.postMessage({
      type: 'mindcrafti-skills-parent-config', progress,
    }, window.location.origin);
  }, [loaded, progress]);

  useEffect(() => {
    if (!loaded || !progress || !focusedSkillId) return;
    if (!data.skills.some(skill => skill.id === focusedSkillId)) return;
    frame.current?.contentWindow?.postMessage({
      type: 'mindcrafti-skills-parent-focus-node', skillId: focusedSkillId,
    }, window.location.origin);
  }, [loaded, progress, focusedSkillId, data.skills]);

  useEffect(() => {
    const handle = (event: MessageEvent) => {
      if (event.origin !== window.location.origin ||
          event.source !== frame.current?.contentWindow ||
          event.data?.type !== 'mindcrafti-skills-parent-selected-skill') return;
      const id = event.data.skillId;
      if (typeof id !== 'string' || !data.skills.some(skill => skill.id === id)) return;
      onSelectSkill(id);
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [data.skills, onSelectSkill]);

  if (error) return <div className="panel parent-progress__empty" role="alert">
    {de ? 'Das Kompetenznetz konnte nicht geladen werden: ' : 'Не удалось загрузить дерево навыков: '}{error}
  </div>;
  if (!progress) return <div className="panel parent-progress__empty" role="status">
    {de ? 'Kompetenzbaum wird geladen…' : 'Загружаем дерево навыков…'}
  </div>;

  return <section className="parent-progress__tree">
    <div className="parent-progress__tree-intro">
      <strong>{de ? 'Kompetenzbaum' : 'Дерево навыков'} · {data.grade} {de ? 'Klasse' : 'класс'}</strong>
      <span>{de
        ? 'Die gleichen Kompetenzen und Werte wie im Lernfortschritt. Nur Lesezugriff.'
        : 'Те же навыки и проценты, что на графике. Только просмотр.'}</span>
    </div>
    <iframe
      key={data.studentId}
      ref={frame}
      className="parent-progress__tree-frame"
      src="/skills-board/index.html?embedded=parent-tree&v=20261126-1"
      title={de ? 'Kompetenzbaum des Kindes' : 'Дерево навыков ребёнка'}
      allow="fullscreen"
      onLoad={() => setLoaded(true)}
    />
  </section>;
}
