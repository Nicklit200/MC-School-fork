import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GroupDetailPage } from './GroupDetailPage';

/**
 * Keeps the existing group dashboard intact while making a PDF-homework title
 * open the group-level homework editor. The current dashboard already renders
 * one individual homework link per student in the same row, so we reuse the
 * first matching homework id as the stable representative id for that group
 * assignment.
 */
export function GroupDetailWithHomeworkLinks() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.querySelector('.group-detail-dashboard');
    if (!root) return;

    const refreshClickableRows = () => {
      const homeworkSection = root.querySelector('.group-overview-grid .group-overview-card:first-child');
      if (!homeworkSection) return;
      homeworkSection.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
        const titleCell = row.querySelector<HTMLTableCellElement>('td:first-child');
        const individualLink = row.querySelector<HTMLAnchorElement>('a[href*="/teacher/students/"][href*="/homeworks/"]');
        if (!titleCell || !individualLink) return;
        titleCell.style.cursor = 'pointer';
        titleCell.title = 'Открыть и редактировать домашку всей группы';
        titleCell.setAttribute('role', 'link');
        titleCell.setAttribute('tabindex', '0');
      });
    };

    const openGroupHomework = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const homeworkSection = target.closest('.group-overview-grid .group-overview-card:first-child');
      if (!homeworkSection) return;
      const titleCell = target.closest('td:first-child');
      const row = titleCell?.closest('tr');
      if (!titleCell || !row) return;
      const individualLink = row.querySelector<HTMLAnchorElement>('a[href*="/teacher/students/"][href*="/homeworks/"]');
      if (!individualLink) return;
      const match = individualLink.getAttribute('href')?.match(/\/homeworks\/([^/?#]+)/);
      if (!match) return;
      navigate(`/groups/${groupId}/homeworks/${match[1]}`);
    };

    const onClick: EventListener = (event) => {
      openGroupHomework(event.target);
    };

    const onKeyDown: EventListener = (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!(event.target instanceof Element) || !event.target.matches('td:first-child')) return;
      event.preventDefault();
      openGroupHomework(event.target);
    };

    refreshClickableRows();
    const observer = new MutationObserver(refreshClickableRows);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeyDown);

    return () => {
      observer.disconnect();
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [groupId, navigate]);

  return <GroupDetailPage />;
}
