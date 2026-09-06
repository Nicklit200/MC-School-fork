import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupLessonsPage } from './GroupLessonsPage';

export function GroupLessonsWithDetailLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    const refresh = () => {
      const root = document.querySelector('.teacher-lessons-page');
      if (!root) return;

      root.querySelectorAll<HTMLButtonElement>('button[data-mindcrafti-lesson-id]').forEach((startButton) => {
        const eventId = startButton.dataset.mindcraftiLessonId;
        if (!eventId) return;

        const actions = startButton.parentElement;
        if (!actions || actions.querySelector(`[data-open-lesson-workspace="${CSS.escape(eventId)}"]`)) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--secondary';
        button.textContent = 'Открыть урок';
        button.setAttribute('data-open-lesson-workspace', eventId);
        button.style.width = '100%';

        actions.insertBefore(button, startButton);
      });
    };

    const onClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-open-lesson-workspace]');
      if (!button) return;
      const eventId = button.getAttribute('data-open-lesson-workspace');
      if (!eventId) return;
      event.preventDefault();
      event.stopPropagation();
      navigate(`/teacher/lessons/${encodeURIComponent(eventId)}`);
    };

    refresh();

    // The schedule is loaded asynchronously. Watch the document until the lesson cards appear,
    // instead of giving up when GroupLessonsPage is still showing its loading state.
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', onClick);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', onClick);
    };
  }, [navigate]);

  return <GroupLessonsPage />;
}
