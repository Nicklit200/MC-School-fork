/**
 * A month belongs to exactly one academic year (September–July).
 * Keep exact YYYY-MM keys when joining a pupil's saved plans with the
 * calendar, never reuse a previous month's assessed skill set.
 */
export const schoolYearStartForDate = (date = new Date()) =>
  date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;

export function schoolYearMonthKey(startYear, month) {
  if (!Number.isInteger(startYear) || !Number.isInteger(month)
      || month < 1 || month > 12) return null;
  return `${month >= 9 ? startYear : startYear + 1}-${String(month).padStart(2, "0")}`;
}

/**
 * Fail closed if the server returns a different student/board/year.
 * The returned map uses full year-month keys: 2026-11, 2027-01 etc.
 */
export function indexStudentMonthlyCurricula(payload, {studentId, boardId, schoolYearStart}) {
  if (!payload || payload.studentId !== studentId || payload.boardId !== boardId
      || payload.schoolYear !== `${schoolYearStart}/${String((schoolYearStart + 1) % 100).padStart(2, "0")}`
      || !Array.isArray(payload.months)) return {};
  const indexed = {};
  for (const record of payload.months) {
    if (!record || typeof record.month !== "string"
        || !/^\d{4}-(0[1-9]|1[0-2])$/.test(record.month)) continue;
    const number = Number(record.month.slice(5));
    if (schoolYearMonthKey(schoolYearStart, number) !== record.month
        || !Array.isArray(record.skillIds) || !record.skillIds.length) continue;
    indexed[record.month] = record;
  }
  return indexed;
}
