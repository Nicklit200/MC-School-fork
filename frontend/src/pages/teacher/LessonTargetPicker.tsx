import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { StudentGroup, StudentListItem } from '../../api/types';
import { TeacherIcon } from '../../components/TeacherIcon';
import './lesson-target-picker.css';

export type LessonTargetKind = 'student' | 'group' | 'trial';

export function LessonTargetPicker({ kind, value, students, groups, de, invalid, onKindChange, onChange }: {
  kind: LessonTargetKind;
  value: string;
  students: StudentListItem[];
  groups: StudentGroup[];
  de: boolean;
  invalid: boolean;
  onKindChange: (kind: LessonTargetKind) => void;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const tabs = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const activeStudents = students.filter((student) => student.status !== 'INACTIVE');
  const labels = de ? ['Schüler', 'Gruppe', 'Probestunde'] : ['Ученик', 'Группа', 'Пробный'];
  const kinds: LessonTargetKind[] = ['student', 'group', 'trial'];
  const items = kind === 'student'
    ? activeStudents.map((student) => ({ id: 'student:' + student.id, name: student.fullName,
      meta: student.grade ? (de ? `Klasse ${student.grade}` : `${student.grade} класс`) : (de ? 'Einzelunterricht' : 'Индивидуальное занятие'),
      search: [student.fullName, student.username, student.grade].filter(Boolean).join(' ') }))
    : groups.map((group) => ({ id: 'group:' + group.id, name: group.name,
      meta: (de ? 'Schüler: ' : 'Учеников: ') + group.students.length,
      search: [group.name, ...group.students.map((student) => student.fullName)].join(' ') }));
  const filtered = items.filter((item) => item.search.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const chosen = items.find((item) => item.id === value);
  const selectionLabel = kind === 'student' ? (de ? 'Schüler auswählen' : 'Выберите ученика') : (de ? 'Gruppe auswählen' : 'Выберите группу');
  const searchLabel = kind === 'student' ? (de ? 'Schüler suchen' : 'Найти ученика') : (de ? 'Gruppe suchen' : 'Найти группу');
  const optionId = (index: number) => 'lesson-target-option-' + index;

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, query]);

  function openPicker() {
    if (open) return;
    setQuery('');
    setActiveIndex(Math.max(0, items.findIndex((item) => item.id === value)));
    setOpen(true);
  }

  function choose(id: string) {
    onChange(id);
    input.current?.focus();
    setOpen(false);
    setQuery('');
  }

  function selectKind(next: LessonTargetKind) {
    if (next === kind) return;
    setOpen(false);
    setQuery('');
    onKindChange(next);
  }

  function handleSearchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openPicker();
      else if (filtered.length) setActiveIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (filtered[activeIndex]) choose(filtered[activeIndex].id);
    } else if (event.key === 'Tab') setOpen(false);
  }

  function handleTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % kinds.length;
    else if (event.key === 'ArrowLeft') next = (index + kinds.length - 1) % kinds.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = kinds.length - 1;
    else return;
    event.preventDefault();
    selectKind(kinds[next]);
    tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <div className="lesson-target-picker lesson-create__full-row">
    <div className="field__label" id="lesson-target-label">{de ? 'Für wen ist der Unterricht?' : 'Для кого урок'}</div>
    <div className="lesson-target-tabs" ref={tabs} role="tablist" aria-labelledby="lesson-target-label">
      {kinds.map((item, index) => <button key={item} type="button" role="tab" id={'lesson-target-tab-' + item}
        aria-label={labels[index]} aria-selected={kind === item} aria-controls="lesson-target-panel" tabIndex={kind === item ? 0 : -1}
        onClick={() => selectKind(item)} onKeyDown={(event) => handleTabKeys(event, index)}>
        <TeacherIcon name={item === 'student' ? 'students' : item === 'group' ? 'groups' : 'lessons'} />
        <span>{labels[index]}</span>
        {item !== 'trial' && <small aria-hidden="true">{item === 'student' ? activeStudents.length : groups.length}</small>}
      </button>)}
    </div>
    <div className="lesson-target-panel" role="tabpanel" id="lesson-target-panel" aria-labelledby={'lesson-target-tab-' + kind}>
      {kind !== 'trial' && <div className="lesson-target-control" ref={picker} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
        <label className="lesson-target-search">
          <TeacherIcon name="search" />
          <input ref={input} type="text" role="combobox" autoComplete="off" value={open ? query : chosen?.name ?? ''}
            aria-label={searchLabel} aria-expanded={open} aria-controls="lesson-target-options" aria-autocomplete="list"
            aria-activedescendant={open && filtered[activeIndex] ? optionId(activeIndex) : undefined}
            aria-invalid={invalid || undefined} aria-describedby={invalid ? 'lesson-create-error' : undefined}
            onFocus={openPicker} onClick={openPicker} onKeyDown={handleSearchKeys}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
            placeholder={kind === 'student' ? (de ? 'Name oder Klasse' : 'Имя или класс ученика') : (de ? 'Name der Gruppe oder des Schülers' : 'Название группы или имя ученика')} />
          <span className={'lesson-target-chevron' + (open ? ' is-open' : '')} aria-hidden="true">⌄</span>
        </label>
        {open && <div className="lesson-target-popover">
          <div className="lesson-target-options" ref={list} role="listbox" id="lesson-target-options" aria-label={selectionLabel}>
            {filtered.map((item, index) => <button type="button" role="option" tabIndex={-1} aria-selected={value === item.id}
              id={optionId(index)} data-value={item.id} aria-label={item.name}
              className={'lesson-target-option' + (value === item.id ? ' is-selected' : '') + (activeIndex === index ? ' is-active' : '')} key={item.id}
              onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item.id)} onMouseEnter={() => setActiveIndex(index)}>
              <span className="lesson-target-avatar" aria-hidden="true">{kind === 'student' ? item.name.trim().charAt(0).toUpperCase() : <TeacherIcon name="groups" />}</span>
              <span className="lesson-target-option__text"><strong>{item.name}</strong><small>{item.meta}</small></span>
              {value === item.id && <span className="lesson-target-check" aria-hidden="true">✓</span>}
            </button>)}
          </div>
          {filtered.length === 0 && <div className="lesson-target-empty" role="status">
            {items.length > 0 ? (de ? 'Keine Treffer. Versuche einen anderen Namen.' : 'Ничего не найдено. Попробуйте другое имя.')
              : kind === 'student' ? (de ? 'Noch keine aktiven Schüler. Füge sie unter „Meine Schüler“ hinzu.' : 'Учеников пока нет. Добавьте их в разделе «Мои ученики».')
                : (de ? 'Noch keine Gruppen. Erstelle sie unter „Meine Gruppen“.' : 'Групп пока нет. Создайте их в разделе «Мои группы».')}
          </div>}
        </div>}
      </div>}
    </div>
  </div>;
}
