/** School calendar mapping, not a claim that the school has already taught these topics. */
export type CurriculumMonth = {
  schemaVersion: number;
  schoolYear: string;
  month: string;
  grade: number;
  schoolType: string;
  boardId: string;
  skillIds: string[];
  topics: string[];
  unmappedTopics?: string[];
  source: string;
  calendarStatus?: string;
  masteryMethod?: string;
};

export type MonthReadiness = {
  percent: number | null;
  assessed: number;
  total: number;
  assessedCoverage: number;
  unmappedCount: number;
};

/**
 * Missing mastery records mean NOT EVALUATED, not 0%. An explicit 0% entry
 * is evaluated knowledge (the teacher tested the skill and marked 0%).
 * The student has one authoritative value per skill, so lesson transcript
 * reviews can update mastery through the existing workflow without changing
 * or overwriting monthly plans.
 */
export function calculateMonthReadiness(
  curriculum: CurriculumMonth,
  mastery: Record<string, number> | null,
): MonthReadiness {
  const skillIds = Array.isArray(curriculum.skillIds)
    ? [...new Set(curriculum.skillIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  const total = skillIds.length;
  const unmappedCount = Array.isArray(curriculum.unmappedTopics) ? curriculum.unmappedTopics.length : 0;
  if (!mastery) return { percent: null, assessed: 0, total, assessedCoverage: 0, unmappedCount };
  const measurements = skillIds.flatMap(id => {
    const value = mastery[id];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? [value] : [];
  });
  const assessed = measurements.length;
  return {
    percent: assessed ? Math.round(measurements.reduce((sum, value) => sum + value, 0) / assessed) : null,
    assessed,
    total,
    assessedCoverage: total ? Math.round(assessed * 100 / total) : 0,
    unmappedCount,
  };
}
