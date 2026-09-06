import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { GroupDetailPage } from './GroupDetailPage';
import { GroupTranscriptFolderPicker } from './GroupTranscriptFolderPicker';

/** Makes group homework and card-set titles open their group-level editors. */
export function GroupDetailWithHomeworkLinks() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const root = document.querySelector('.group-detail-dashboard');
    if (!root) return;

    const cardDateFromRow = (row: HTMLTableRowElement) => {
      const dateText = row.querySelector<HTMLTableCellElement>('td:nth-child(2)')?.textContent?.trim() ?? '';
      const match = dateText.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (!match) return null;
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    };

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

      if (cardsSection) {
        const headerRow = cardsSection.querySelector<HTMLTableRowElement>('thead tr');
        if (headerRow && !headerRow.querySelector('.group-card-actions-header')) {
          const headerCell = document.createElement('th');
          headerCell.className = 'group-card-actions-header';
          headerCell.setAttribute('aria-label', 'Действия');
          headerCell.style.width = '74px';
          headerRow.appendChild(headerCell);
        }

        cardsSection.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
          const titleCell = row.querySelector<HTMLTableCellElement>('td:first-child');
          if (titleCell) {
            titleCell.style.cursor = 'pointer';
            titleCell.title = 'Открыть карточки всей группы';
            titleCell.setAttribute('role', 'link');
            titleCell.setAttribute('tabindex', '0');
          }

          if (!row.querySelector('.group-card-actions-cell')) {
            const actionCell = document.createElement('td');
            actionCell.className = 'group-card-actions-cell';
            actionCell.style.textAlign = 'center';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'teacher-more-btn';
            button.textContent = '⋮';
            button.title = 'Действия с набором карточек';
            button.setAttribute('aria-label', 'Действия с набором карточек');
            button.setAttribute('data-group-card-delete', 'true');

            actionCell.appendChild(button);
            row.appendChild(actionCell);
          }
        });
      }
    };

    const deleteCardSet = async (row: HTMLTableRowElement, button: HTMLButtonElement) => {
      const startDate = cardDateFromRow(row);
      if (!startDate) return;

      const title = row.querySelector<HTMLTableCellElement>('td:first-child')?.textContent?.trim() || 'Карточки';
      if (!window.confirm(`Удалить полностью набор «${title}» у всех учеников группы? Карточки исчезнут у всей группы.`)) return;

      button.disabled = true;
      try {
        const group = await api.groups.get(groupId);
        const homeworkLists = await Promise.all(
          group.students.map((student) => api.homeworks.listForStudent(student.id)),
        );
        const cardHomeworks = homeworkLists
          .flat()
          .filter((homework) => homework.startDate === startDate && homework.totalCards > 0);
        const cardLists = await Promise.all(cardHomeworks.map((homework) => api.cards.listForHomework(homework.id)));
        const cardIds = Array.from(new Set(cardLists.flat().map((card) => card.id)));

        if (cardIds.length === 0) {
          window.alert('В этом наборе уже нет карточек.');
          return;
        }

        await Promise.all(cardIds.map((cardId) => api.cards.remove(cardId)));
        window.alert(`Набор удалён у всей группы. Удалено карточек: ${cardIds.length}.`);
        window.location.reload();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось удалить набор карточек.');
      } finally {
        button.disabled = false;
      }
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
        const startDate = cardDateFromRow(row);
        if (startDate) navigate(`/groups/${groupId}/cards/${startDate}`);
      }
    };

    const onClick: EventListener = (event) => {
      if (!(event.target instanceof Element)) return;
      const deleteButton = event.target.closest<HTMLButtonElement>('button[data-group-card-delete="true"]');
      if (deleteButton) {
        event.preventDefault();
        event.stopPropagation();
        const row = deleteButton.closest<HTMLTableRowElement>('tr');
        if (row) void deleteCardSet(row, deleteButton);
        return;
      }
      openTarget(event.target);
    };

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

  return (
    <>
      <GroupDetailPage />
      {groupId && <GroupTranscriptFolderPicker groupId={groupId} />}
    </>
  );
}
