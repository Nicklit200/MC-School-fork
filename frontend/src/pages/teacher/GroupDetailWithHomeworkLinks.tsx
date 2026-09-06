import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GroupDetailPage } from './GroupDetailPage';

/** Makes group homework and card-set titles open their group-level editors. */
export function GroupDetailWithHomeworkLinks() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.querySelector('.group-detail-dashboard');
    if (!root) return;

    const refreshClickableRows = () => {
      const overviewCards = root.querySelectorAll('.group-overview-grid .group-overview-card');
      const homeworkSection = overviewCards.item(0);
      const cardsSection = overviewCards.item(1);

      homeworkSection?.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
        const titleCell = row.querySelector<HTMLTableCellElement>('td:first-child');
        const individualLink = row.querySelector<HTMLAnchorElement>('a[href*="/teacher/students/"][href*="/homeworks/"]');
        if (!titleCell || !individualLink) return;
        titleCell.style.cursor = 'pointer';
        titleCell.title = 'Открыть и редактировать домашку всей группы';
        titleCell.setAttribute('role', 'link');
        titleCell.setAttribute('tabindex', '0');
      });

      cardsSection?.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
        const titleCell = row.querySelector<HTMLTableCellElement>('td:first-child');
        if (!titleCell) return;
        titleCell.style.cursor = 'pointer';
        titleCell.title = 'Открыть карточки всей группы';
        titleCell.setAttribute('role', 'link');
        titleCell.setAttribute('tabindex', '0');
      });
    };

    const openTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const overviewCards = root.querySelectorAll('.group-overview-grid .group-overview-card');
      const homeworkSection = overviewCards.item(0);
      const cardsSection = overviewCards.item(1);

      const titleCell = target.closest('td:first-child');
      const row = titleCell?.closest('tr');
      if (!titleCell || !row) return;

      if (homeworkSection && homeworkSection.contains(target)) {
        const individualLink = row.querySelector<HTMLAnchorElement>('a[href*="/teacher/students/"][href*="/homeworks/"]');
        const match = individualLink?.getAttribute('href')?.match(/\/homeworks\/([^/?#]+)/);
        if (match) navigate(`/groups/${groupId}/homeworks/${match[1]}`);
        return;
      }

      if (cardsSection && cardsSection.contains(target)) {
        const dateText = row.querySelector<HTMLTableCellElement>('td:nth-child(2)')?.textContent?.trim() ?? '';
        const match = dateText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (!match) return;
        const [, day, month, year] = match;
        navigate(`/groups/${groupId}/cards/${year}-${month}-${day}`);
      }
    };

    const onClick: EventListener = (event) => openTarget(event.target);

    const onKeyDown: EventListener = (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!(event.target instanceof Element) || !event.target.matches('td:first-child')) return;
      event.preventDefault();
      openTarget(event.target);
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
