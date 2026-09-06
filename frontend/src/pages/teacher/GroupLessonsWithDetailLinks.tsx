import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GroupLessonsPage } from './GroupLessonsPage';

export function GroupLessonsWithDetailLinks() {
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.querySelector('.teacher-lessons-page');
    if (!root) return;

    const refresh = () => {
      root.querySelectorAll<HTMLButtonElement>('button[data-mindcrafti-lesson-id]').forEach((startButton) => {
        const eventId = startButton.dataset.mindcraftiLessonId;
        if (!eventId) return;
        const card = startButton.closest<HTMLDivElement>('div[style*="border-radius: 12px"]');
        if (!card || card.querySelector('[data-open-lesson-workspace]')) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--secondary';
        button.textContent = 'Открыть урок';
        button.setAttribute('data-open-lesson-workspace', eventId);
        button.style.width = '100%';
        button.style.marginBottom = '6px';
        startButton.parentElement?.insertBefore(button, startButton);
      });
    };

    const onClick = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-open-lesson-workspace]');
      if (!button) return;
      const eventId = button.getAttribute('data-open-lesson-workspace');
      if (!eventId) return;
      event.preventDefault();
      navigate(`/teacher/lessons/${encodeURIComponent(eventId)}`);
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('click', onClick);
    return () => {
      observer.disconnect();
      root.removeEventListener('click', onClick);
    };
  }, [navigate]);

  return <GroupLessonsPage />;
}
