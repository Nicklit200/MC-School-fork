import type { Card, Language } from '../api/types';

const REVIEW_INTERVAL_DAYS = [1, 2, 4, 7, 14, 30] as const;
const MAX_STAGE = REVIEW_INTERVAL_DAYS.length;

export function formatReviewStage(stage: number, language: Language): string {
  if (stage <= 0) {
    return language === 'DE'
      ? `Stufe 0/${MAX_STAGE} — Start / Reset`
      : `Этап 0/${MAX_STAGE} — старт / сброс`;
  }

  const safeStage = Math.min(stage, MAX_STAGE);
  const intervalDays = REVIEW_INTERVAL_DAYS[safeStage - 1];
  return language === 'DE'
    ? `Stufe ${safeStage}/${MAX_STAGE} — Intervall ${formatDays(intervalDays, language)}`
    : `Этап ${safeStage}/${MAX_STAGE} — интервал ${formatDays(intervalDays, language)}`;
}

export function formatCardReviewProgress(card: Card, language: Language): string {
  const stage = formatReviewStage(card.repetitionNumber, language);
  if (!card.dueDate) return stage;

  const date = formatLocalDate(card.dueDate, language);
  return language === 'DE'
    ? `${stage} · nächste Wiederholung: ${date}`
    : `${stage} · следующее повторение: ${date}`;
}

export function formatBatchReviewStages(cards: Card[], homeworkId: string, language: Language): string {
  const stageCounts = new Map<number, number>();

  cards
    .filter((card) => card.homeworkId === homeworkId)
    .forEach((card) => {
      const stage = Math.max(0, Math.min(card.repetitionNumber, MAX_STAGE));
      stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
    });

  const entries = Array.from(stageCounts.entries()).sort(([a], [b]) => a - b);
  if (entries.length === 0) return '';

  const parts = entries.map(([stage, count]) => {
    if (stage === 0) {
      return language === 'DE'
        ? `Stufe 0/${MAX_STAGE} (Start/Reset): ${count}`
        : `этап 0/${MAX_STAGE} (старт/сброс): ${count}`;
    }

    const intervalDays = REVIEW_INTERVAL_DAYS[stage - 1];
    return language === 'DE'
      ? `Stufe ${stage}/${MAX_STAGE} (${formatDays(intervalDays, language)}): ${count}`
      : `этап ${stage}/${MAX_STAGE} (${formatDays(intervalDays, language)}): ${count}`;
  });

  return language === 'DE'
    ? `Intervallwiederholung: ${parts.join(' · ')}`
    : `Интервальное повторение: ${parts.join(' · ')}`;
}

export function reviewScheduleLegend(language: Language): string {
  if (language === 'DE') {
    return 'Schema: Stufe 1 → 1 Tag · 2 → 2 Tage · 3 → 4 Tage · 4 → 7 Tage · 5 → 14 Tage · 6 → 30 Tage. Ein Fehler beim ersten Versuch setzt die Karte auf Stufe 0 zurück.';
  }
  return 'Схема: этап 1 → 1 день · 2 → 2 дня · 3 → 4 дня · 4 → 7 дней · 5 → 14 дней · 6 → 30 дней. Ошибка с первой попытки сбрасывает карточку на этап 0.';
}

function formatDays(days: number, language: Language): string {
  if (language === 'DE') return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;

  const mod10 = days % 10;
  const mod100 = days % 100;
  const unit = mod10 === 1 && mod100 !== 11
    ? 'день'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? 'дня'
      : 'дней';
  return `${days} ${unit}`;
}

function formatLocalDate(date: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'DE' ? 'de-DE' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00`));
}
