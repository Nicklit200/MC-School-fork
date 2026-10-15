const API_BASE = "https://personal-life-api-production.up.railway.app";

const state = {
  data: null,
  section: "study",
  germanWords: [],
  nutritionEntries: [],
  nutritionAssistantEntries: [],
  workoutEntries: [],
  workoutAssistantEntries: [],
  nutritionCalendarEntries: [],
  workoutCalendarEntries: [],
  calendarMonth: {
    study: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    nutrition: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    workouts: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  },
  semesterId: "",
  examId: "",
  topicId: "all",
  slideFilter: null,
  viewMode: "map",
  selectedSkillId: "",
  viewport: { x: 80, y: 70, z: 1 },
  drag: null,
  lectureTasks: [],
  quizTodayBySkill: new Map(),
};

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function readinessClass(value) {
  if (value >= 90) return "mastered";
  if (value >= 70) return "high";
  if (value >= 40) return "mid";
  return "low";
}

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value + (String(value).length === 10 ? "T12:00:00" : "")));
  } catch {
    return value;
  }
}

function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const LECTURE_TASKS_KEY = "personal-study-map:lecture-tasks:v1";

function localIsoDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function lectureWeekdays() {
  const days = state.data?.planner?.lectureWeekdays;
  return Array.isArray(days) && days.length ? days.map(Number) : [3];
}

function weekdayRu(day) {
  return ({ 0:"воскресенье", 1:"понедельник", 2:"вторник", 3:"среда", 4:"четверг", 5:"пятница", 6:"суббота" })[Number(day)] || "";
}

function nextLectureDate(preferredDay = null) {
  const allowed = preferredDay === null ? lectureWeekdays() : [Number(preferredDay)];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let offset = 1; offset <= 14; offset++) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + offset);
    if (allowed.includes(candidate.getDay())) return localIsoDate(candidate);
  }
  return "";
}

function localLectureTasks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LECTURE_TASKS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function api(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function loadLectureTasks() {
  try {
    const remote = await api("/api/tasks");
    const local = localLectureTasks();
    if (!remote.length && local.length) {
      for (const task of local) {
        try {
          await api("/api/tasks", { method:"POST", body:JSON.stringify(task) });
        } catch {}
      }
      const migrated = await api("/api/tasks");
      localStorage.removeItem(LECTURE_TASKS_KEY);
      return migrated;
    }
    return remote;
  } catch (error) {
    console.warn("Задачи работают локально: API недоступен", error);
    return localLectureTasks();
  }
}

function saveLectureTasks() {
  localStorage.setItem(LECTURE_TASKS_KEY, JSON.stringify(state.lectureTasks));
}

function openLectureTasks() {
  return state.lectureTasks.filter((task) => !task.done);
}



const STUDY_CARD_PROGRESS_KEY = "personal-study-map:card-progress:v1";

function localStudyProgress() {
  try { return JSON.parse(localStorage.getItem(STUDY_CARD_PROGRESS_KEY) || "{}"); }
  catch { return {}; }
}


const QUIZ_HISTORY_KEY_FOR_MAP = "personal-study-map:quiz-session-history:v1";
const QUIZ_INVALID_KEY_FOR_MAP = "personal-study-map:quiz-invalid-cards:v1";
const QUIZ_DELETED_KEY_FOR_MAP = "personal-study-map:quiz-deleted-cards:v1";
const QUIZ_OVERRIDES_KEY_FOR_MAP = "personal-study-map:card-overrides:v1";

function todayQuizResults() {
  // Quiz answers stay on this device. Only completed sessions count.
  const read = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  };
  const history = read(QUIZ_HISTORY_KEY_FOR_MAP, []);
  const invalid = read(QUIZ_INVALID_KEY_FOR_MAP, {});
  const deleted = read(QUIZ_DELETED_KEY_FOR_MAP, {});
  const overrides = read(QUIZ_OVERRIDES_KEY_FOR_MAP, {});
  const outcomes = new Map();
  const today = todayIso();
  const excluded = (flags, id) => flags && typeof flags === "object" &&
    Object.prototype.hasOwnProperty.call(flags, id);
  for (const session of Array.isArray(history) ? history : []) {
    if (session?.date !== today || !Array.isArray(session.review)) continue;
    for (const item of session.review) {
      const id = String(item?.cardId || "");
      const skillId = String(item?.skillId || "");
      if (!id || !skillId || excluded(invalid, id) || excluded(deleted, id) ||
          overrides?.[id]?.deleted) continue;
      const timestamp = String(session.completedAt || session.startedAt || "");
      const old = outcomes.get(id);
      if (old && old.timestamp > timestamp) continue;
      outcomes.set(id, {
        skillId, question:String(item.question || "Карточка"),
        correct:item.correct === true, timestamp
      });
    }
  }
  const perSkill = new Map();
  for (const item of outcomes.values()) {
    const row = perSkill.get(item.skillId) || {total:0, firstTry:0, cards:[]};
    row.total += 1;
    if (item.correct) row.firstTry += 1;
    row.cards.push(item);
    perSkill.set(item.skillId, row);
  }
  return perSkill;
}

// Derive map mastery from actual scheduled flashcard results on this device.
// Practice sessions are visible in history, but do not change mastery.
function applyFlashcardQuizMastery() {
  let progress = {};
  let history = [];
  try { progress = JSON.parse(localStorage.getItem("personal-study-map:quiz-card-progress:v1") || "{}") || {}; } catch {}
  try { history = JSON.parse(localStorage.getItem(QUIZ_HISTORY_KEY_FOR_MAP) || "[]") || []; } catch {}
  const practiced = new Set();
  for (const session of Array.isArray(history) ? history : []) {
    if (session.type !== "SCHEDULED") continue;
    for (const item of session.review || []) if (item.skillId) practiced.add(item.skillId);
  }
  for (const semester of state.data?.semesters || []) for (const exam of semester.exams || []) {
    for (const skill of exam.skills || []) {
      const cards = Array.isArray(skill.flashcards) ? skill.flashcards : [];
      if (!cards.length) continue;
      const hasRecord = cards.some(card => progress[card.id]) || practiced.has(skill.id);
      if (!hasRecord) continue;
      const known = cards.filter(card => Number(progress[card.id]?.repetitionNumber || 0) >= 1).length;
      const mastery = Math.round(known / cards.length * 100);
      // A scheduled review is evidence, but do not silently lower manually certified mastery.
      if (mastery > Number(skill.mastery || 0)) skill.mastery = mastery;
      const dates = cards.map(card => progress[card.id]?.updatedAt).filter(Boolean).sort();
      if (dates.length) skill.lastUpdated = dates[dates.length-1].slice(0,10);
    }
  }
}

function quizHistoryForMap() {
  try {
    const rows = JSON.parse(localStorage.getItem(QUIZ_HISTORY_KEY_FOR_MAP) || "[]");
    return Array.isArray(rows) ? rows.filter(row => row && Array.isArray(row.review)) : [];
  } catch { return []; }
}

function quizTodayBadgeMarkup(skill) {
  const result = state.quizTodayBySkill.get(skill.id);
  if (!result) return "";
  return '<div class="quiz-today-note">Сегодня пройдено: ' + result.total +
    ' · сразу: ' + result.firstTry + '</div>';
}

function quizTodayInspectorMarkup(skill) {
  const result = state.quizTodayBySkill.get(skill.id);
  if (!result) return "";
  return '<div class="inspector-section">' +
    '<div class="inspector-label">КАРТОЧКИ ЗА СЕГОДНЯ</div>' +
    '<div>Пройдено: <strong>' + result.total + '</strong>. ' +
    'С первой попытки: <strong>' + result.firstTry + '</strong>.</div>' +
    '<div class="quiz-today-items">' + result.cards.map(item =>
      '<div class="quiz-today-item"><div>' + escapeHtml(item.question) + '</div>' +
      '<small>' + (item.correct ? 'Верно с первой попытки' : 'Исправлено после ошибки') +
      '</small></div>'
    ).join("") + '</div></div>';
}

function applyProgressRecord(skill, record) {
  if (!record) return;
  const baseline = String(skill.lastUpdated || "1900-01-01").slice(0, 10);
  const savedDate = String(record.updatedAt || "").slice(0, 10);
  if (savedDate && savedDate < baseline) return;
  const mastery = Number(record.mastery);
  if (!Number.isFinite(mastery)) return;
  skill.mastery = clamp(mastery, 0, 100);
  skill.review = {
    repetition: Math.max(0, Number(record.repetition || 0)),
    dueDate: record.dueDate || null,
    lastResult: record.lastResult || null
  };
  if (savedDate) skill.lastUpdated = savedDate;
}

async function loadSavedStudyProgress() {
  let rows = [];
  try { rows = await api("/api/study-progress"); }
  catch (error) { console.warn("Не удалось получить прогресс карточек", error); }
  const local = localStudyProgress();
  const records = new Map();
  for (const item of Array.isArray(rows) ? rows : []) {
    records.set(item.skillId, item);
  }
  for (const [key, item] of Object.entries(local)) {
    const remote = records.get(key);
    if (!remote || String(item.updatedAt || "") > String(remote.updatedAt || "")) {
      records.set(key, item);
    }
  }
  for (const semester of state.data?.semesters || []) {
    for (const exam of semester.exams || []) {
      for (const skill of exam.skills || []) applyProgressRecord(skill, records.get(skill.id));
    }
  }
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

async function saveStudyCardRating(skill, rating) {
  const current = Number(skill.mastery || 0);
  const oldReview = skillReview(skill);
  const intervals = state.data?.reviewSchedule?.intervalDays || [1, 2, 4, 7, 14, 30];
  const repetition = rating === "easy"
    ? Math.min(intervals.length, Number(oldReview.repetition || 0) + 1)
    : rating === "hard" ? Math.max(0, Number(oldReview.repetition || 0)) : 0;
  const days = rating === "easy"
    ? Number(intervals[Math.max(0, repetition - 1)] || 1) : 1;
  // Self-assessment never by itself certifies a skill at 90-100%.
  const mastery = rating === "easy"
    ? Math.min(84, current + 10)
    : rating === "hard" ? Math.min(69, Math.max(15, current + 3))
    : Math.max(0, current - 8);
  const payload = {
    mastery, repetition, dueDate: addDaysIso(days),
    lastResult: "card-self-assessment:" + rating
  };
  const updatedAt = new Date().toISOString();
  let storedRemotely = false;
  try {
    const saved = await api("/api/study-progress/" + encodeURIComponent(skill.id), {
      method: "PUT", body: JSON.stringify(payload)
    });
    storedRemotely = Boolean(saved);
  } catch (error) {
    console.warn("Прогресс пока только в браузере", error);
  }
  skill.mastery = mastery;
  skill.review = {
    repetition: payload.repetition,
    dueDate: payload.dueDate,
    lastResult: payload.lastResult
  };
  skill.lastUpdated = todayIso();
  const snapshot = localStudyProgress();
  snapshot[skill.id] = {skillId: skill.id, ...payload, updatedAt};
  localStorage.setItem(STUDY_CARD_PROGRESS_KEY, JSON.stringify(snapshot));
  renderMeta();
  renderExamCards();
  renderWorkspace();
  renderReview();
  return {storedRemotely, mastery, dueDate:payload.dueDate};
}

window.studyBoardCards = {
  context: () => ({
    exam:currentExam(),
    topicId:state.topicId,
    semesterId:state.semesterId
  }),
  allExams: () => (state.data?.semesters||[]).flatMap(sem=>sem.exams||[]),
  learningSessions: () => state.data?.sessions || [],
  rate:saveStudyCardRating
};

function renderSection() {
  const study = state.section === "study";
  document.body.dataset.section = state.section;

  $("map").hidden = !study || state.viewMode !== "map";
  $("list").hidden = !study || state.viewMode !== "list";
  $("nutrition-view").hidden = state.section !== "nutrition";
  $("german-view").hidden = state.section !== "german";
  $("workouts-view").hidden = state.section !== "workouts";

  for (const id of ["left-panel-toggle", "left-panel"]) {
    $(id).hidden = !study;
  }
  for (const selector of [".floating-toolbar", ".top-search", ".top-status"]) {
    const element = document.querySelector(selector);
    if (element) element.hidden = !study;
  }

  if (!study) {
    for (const id of ["inspector", "review-panel", "history-panel", "study-calendar-panel", "homework-panel", "flashcard-panel"]) {
      $(id)?.classList.add("closed");
    }
  }
  if (state.section !== "nutrition") {
    const nutritionPanel = $("nutrition-add-panel");
    if (nutritionPanel) nutritionPanel.hidden = true;
  }

  for (const button of document.querySelectorAll(".section-tab")) {
    button.classList.toggle("active", button.dataset.section === state.section);
  }
}

function switchSection(section) {
  state.section = section;
  renderSection();
  if (section === "study") {
    renderWorkspace();
    renderCalendar("study");
    setTimeout(fitMap, 0);
  } else if (section === "german") {
    loadGermanWords();
  } else if (section === "nutrition") {
    loadNutrition();
  } else if (section === "workouts") {
    loadWorkouts();
  }
}


function isoDateFromParts(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthTitle(date) {
  return new Intl.DateTimeFormat("ru-RU", { month:"long", year:"numeric" }).format(date);
}

function shiftCalendarMonth(section, delta) {
  const current = state.calendarMonth[section] || new Date();
  state.calendarMonth[section] = new Date(current.getFullYear(), current.getMonth() + delta, 1);
  renderCalendar(section);
}

function studyActivityDates() {
  const dates = new Set();
  for (const session of state.data?.sessions || []) {
    if (session?.date) dates.add(String(session.date).slice(0, 10));
  }
  for (const task of state.lectureTasks || []) {
    if (task.done && task.completedAt) dates.add(String(task.completedAt).slice(0, 10));
  }
  return dates;
}

function workoutActivityDates() {
  return new Set((state.workoutCalendarEntries || []).map((item) => String(item.date || "").slice(0, 10)).filter(Boolean));
}

function workoutActivityTypes(item) {
  const declared = Array.isArray(item?.activityTypes) ? item.activityTypes : [];
  const types = [item?.type, ...declared].map((value) => String(value || "").toLowerCase());
  const details = [item?.title, ...(Array.isArray(item?.exercises) ? item.exercises : [])]
    .join(" ").toLowerCase();
  const activity = new Set();
  if (types.some((type) => /run|jog|cardio|бег/.test(type))
      || /бег|пробеж|running|jogging|run/.test(details)) activity.add("run");
  if (types.some((type) => /strength|weight|силов|kettlebell/.test(type))
      || /отжим|гир|гантел|силов|присед|жим|штанг|планк|подтяг|разводк|трицеп|бицеп|strength|weightlift|squat|push.?up|kettlebell/.test(details))
    activity.add("strength");
  if (!activity.size) activity.add("other");
  return [...activity];
}

function workoutIcon(type) {
  if (type === "run") return '<svg class="workout-activity-icon run" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="15.5" cy="4.7" r="2"/><path d="m13.5 9-3.5 3.5 4.5 3.5-2.5 5M13.5 9l3 3 4.5.5M10 12.5l-5.5 3M14.5 16l5 4"/></svg>';
  if (type === "strength") return '<svg class="workout-activity-icon strength" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9V7a3 3 0 0 1 6 0v2"/><path d="M9 9h6c3 0 4.5 2.5 4.5 5.5S17.5 21 14 21h-4c-3.5 0-5.5-3-5.5-6.5S6 9 9 9Z"/></svg>';
  return '<svg class="workout-activity-icon other" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>';
}

function workoutTypesByDate() {
  const byDate = new Map();
  for (const item of state.workoutCalendarEntries || []) {
    const date = String(item?.date || "").slice(0, 10);
    if (!date) continue;
    const types = byDate.get(date) || new Set();
    for (const type of workoutActivityTypes(item)) types.add(type);
    byDate.set(date, types);
  }
  return byDate;
}

function nutritionDayStatus() {
  const byDate = new Map();
  for (const item of state.nutritionCalendarEntries || []) {
    const date = String(item.date || "").slice(0, 10);
    if (!date) continue;
    const current = byDate.get(date) || { kcal:0, count:0 };
    current.kcal += Number(item.kcal || 0);
    current.count += 1;
    byDate.set(date, current);
  }

  const configuredMax = state.data?.personalGoals?.nutrition?.kcalMax;
  const maxKcal = configuredMax == null || configuredMax === "" ? null : Number(configuredMax);
  const statuses = new Map();

  for (const [date, info] of byDate) {
    if (Number.isFinite(maxKcal) && maxKcal > 0) {
      statuses.set(date, info.kcal > maxKcal ? "over" : "good");
    } else {
      statuses.set(date, "logged");
    }
  }

  return { statuses, byDate, maxKcal: Number.isFinite(maxKcal) && maxKcal > 0 ? maxKcal : null };
}


function renderLifeBalances() {
  const locations = [
    ["nutrition-date", "nutrition-day-balance"],
    ["workout-date", "workout-day-balance"],
  ];
  for (const [dateInput, containerId] of locations) {
    const host = $(containerId);
    if (!host) continue;
    const selectedDate = $(dateInput)?.value || todayIso();
    const eaten = (state.nutritionCalendarEntries || [])
      .filter((item) => String(item.date || "").slice(0, 10) === selectedDate)
      .reduce((sum, item) => sum + (Number(item.kcal) || 0), 0);
    const burned = (state.workoutCalendarEntries || [])
      .filter((item) => String(item.date || "").slice(0, 10) === selectedDate)
      .reduce((sum, item) => sum + (Number(item.activeKcal ?? item.activeCalories) || 0), 0);
    host.innerHTML =
      '<div class="life-balance-card burned">' +
        '<span class="life-balance-symbol" aria-hidden="true">🔥</span>' +
        '<div><div class="life-balance-label">Сожжено</div>' +
        '<strong class="life-balance-value">' + Math.round(burned) + ' ккал</strong>' +
        '<div class="life-balance-note">Активные калории тренировок</div></div>' +
      '</div>' +
      '<div class="life-balance-card eaten">' +
        '<span class="life-balance-symbol" aria-hidden="true">🍴</span>' +
        '<div><div class="life-balance-label">Съедено</div>' +
        '<strong class="life-balance-value">' + Math.round(eaten) + ' ккал</strong>' +
        '<div class="life-balance-note">Из дневника питания</div></div>' +
      '</div>';
  }
}

function studyCalendarEvents() {
  const events = new Map();
  const add = (date, type, title, detail) => {
    const key = String(date || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    if (!events.has(key)) events.set(key, []);
    events.get(key).push({type, title, detail});
  };
  for (const session of state.data?.sessions || [])
    add(session.date, "study", session.title || "Учебное занятие", session.summary || "");
  for (const task of state.lectureTasks || [])
    if (task.done && task.completedAt)
      add(task.completedAt, "task", task.title || "Домашняя работа", "Задание выполнено");
  for (const [date, record] of Object.entries(state.data?.studyCardDays || {}))
    if (record.status === "reviewed") add(date, "cards", "Повторение карточек", record.note || "Подтверждено пользователем");
  for (const session of quizHistoryForMap())
    add(session.completedAt || session.date, "cards",
      session.type === "PRACTICE" ? "Свободная тренировка карточек" : "Повторение карточек",
      "Карточек: " + Number(session.totalCards || session.review?.length || 0) +
      " · с первой попытки: " + Number(session.correctFirstTry || 0));
  return events;
}
function showStudyCalendarDay(dateIso, events) {
  const host = $("study-calendar");
  if (!host) return;
  host.querySelectorAll(".calendar-day.selected").forEach(el => el.classList.remove("selected"));
  const button = [...host.querySelectorAll(".calendar-day[data-date]")].find(el => el.dataset.date === dateIso);
  button?.classList.add("selected");
  const detail = host.querySelector(".study-day-details");
  if (!detail) return;
  const entries = events.get(dateIso) || [];
  const missedNote = state.data?.studyCardDays?.[dateIso]?.status === "missed" ? (state.data.studyCardDays[dateIso].note || "Карточки не повторялись.") : "";
  const cards = entries.filter(item => item.type === "cards");
  const others = entries.filter(item => item.type !== "cards");
  const dateLabel = new Date(dateIso + "T12:00:00").toLocaleDateString("ru-RU",{day:"numeric",month:"long",year:"numeric"});
  detail.innerHTML = '<strong>' + escapeHtml(dateLabel) + '</strong>' +
    (entries.length ? '<div class="study-day-event-list">' + [...cards,...others].map(item =>
      '<div class="study-day-event"><b>' + escapeHtml(item.title) + '</b>' +
      (item.detail ? '<span>' + escapeHtml(item.detail) + '</span>' : '') + '</div>'
    ).join("") + '</div>' : '<p>' + escapeHtml(missedNote || 'За этот день нет сохранённых занятий или тренировок карточек.') + '</p>');
}
function calendarStatus(section, dateIso) {
  if (section === "study") return studyActivityDates().has(dateIso) ? "good" : "";
  if (section === "workouts") return workoutActivityDates().has(dateIso) ? "good" : "";
  if (section === "nutrition") return nutritionDayStatus().statuses.get(dateIso) || "";
  return "";
}

function calendarHost(section) {
  if (section === "study") return $("study-calendar");
  if (section === "nutrition") return $("nutrition-calendar");
  if (section === "workouts") return $("workout-calendar");
  return null;
}

function renderCalendar(section) {
  const host = calendarHost(section);
  if (!host) return;

  const month = state.calendarMonth[section] || new Date();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const mondayOffset = (firstDay + 6) % 7;
  const today = todayIso();
  const nutritionInfo = section === "nutrition" ? nutritionDayStatus() : null;
  const workoutIconsForDay = section === "workouts" ? workoutTypesByDate() : null;
  const studyEvents = section === "study" ? studyCalendarEvents() : null;
  const firstCardDate = section === "study" ? [...studyEvents.entries()].filter(([,rows])=>rows.some(x=>x.type==="cards")).map(([d])=>d).sort()[0] : null;
  const confirmedDays = section === "study" ? (state.data?.studyCardDays || {}) : {};

  host.innerHTML = `
    <div class="calendar-head">
      <button type="button" class="calendar-nav prev" aria-label="Предыдущий месяц">‹</button>
      <div>
        <div class="calendar-title">${escapeHtml(monthTitle(month))}</div>
        <div class="calendar-subtitle">${
          section === "workouts" ? "Бег — бегущий значок · силовая тренировка — гиря" :
          section === "study" ? "Зелёный - карточки пройдены · красный - пропущен день после начала тренировок" :
          nutritionInfo?.maxKcal
            ? `До ${Math.round(nutritionInfo.maxKcal)} ккал - зелёный · выше лимита - красный`
            : "Калории показываются по дням · лимит пока не задан"
        }</div>
      </div>
      <button type="button" class="calendar-nav next" aria-label="Следующий месяц">›</button>
    </div>
    <div class="calendar-weekdays">
      <span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span>
    </div>
    <div class="calendar-grid"></div>
    ${section === "study" ? '<div class="study-day-details" aria-live="polite">Нажми на дату, чтобы посмотреть активность.</div>' : ""}
  `;

  const grid = host.querySelector(".calendar-grid");
  for (let i = 0; i < mondayOffset; i++) {
    const blank = document.createElement("span");
    blank.className = "calendar-day empty";
    grid.append(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateIso = isoDateFromParts(year, monthIndex, day);
    let status = calendarStatus(section, dateIso);
    if (section === "study") {
      const hasCards = (studyEvents.get(dateIso) || []).some(x => x.type === "cards");
      status = hasCards ? "good" : (confirmedDays[dateIso]?.status === "missed" || (firstCardDate && dateIso >= firstCardDate && dateIso < today) ? "missed-cards" : status);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day" + (status ? " " + status : "") + (dateIso === today ? " today" : "");

    if (section === "nutrition") {
      const kcal = nutritionInfo?.byDate?.get(dateIso)?.kcal || 0;
      button.innerHTML = `
        <span class="calendar-day-number">${day}</span>
        ${kcal > 0 ? `<span class="calendar-day-kcal">${Math.round(kcal)} ккал</span>` : ""}
      `;
      button.title = kcal > 0 ? `${dateIso} · ${Math.round(kcal)} ккал` : dateIso;
    } else if (section === "workouts") {
      const types = workoutIconsForDay.get(dateIso) || new Set();
      button.classList.add("workout-day");
      button.innerHTML = '<span class="calendar-day-number">' + day + '</span>' +
        (types.size ? '<span class="workout-day-icons">' +
          [...types].map(workoutIcon).join("") + '</span>' : "");
      button.title = types.size ? dateIso + " · " +
        [...types].map((type) => type === "run" ? "Бег" : type === "strength" ? "Силовая" : "Тренировка").join(", ")
        : dateIso;
    } else if (section === "study") {
      const rows = studyEvents.get(dateIso) || [];
      const cardCount = rows.filter(x => x.type === "cards").length;
      button.dataset.date = dateIso;
      button.innerHTML = '<span class="calendar-day-number">' + day + '</span>' +
        (cardCount ? '<span class="study-card-mark">●</span>' : status === "missed-cards" ? '<span class="study-card-mark">×</span>' : "");
      button.title = dateIso + (cardCount ? " · карточки: " + cardCount : status === "missed-cards" ? " · без карточек" : "");
    } else {
      button.textContent = String(day);
      button.title = dateIso;
    }
    if (section === "study") {
      button.onclick = () => showStudyCalendarDay(dateIso, studyEvents);
    } else if (section === "workouts") {
      button.onclick = () => {
        $("workout-date").value = dateIso;
        loadWorkouts();
      };
    } else if (section === "nutrition") {
      button.onclick = () => {
        $("nutrition-date").value = dateIso;
        loadNutrition();
      };
    }
    grid.append(button);
  }

  host.querySelector(".prev").onclick = () => shiftCalendarMonth(section, -1);
  host.querySelector(".next").onclick = () => shiftCalendarMonth(section, 1);
}

function renderAllCalendars() {
  renderCalendar("study");
  renderCalendar("nutrition");
  renderCalendar("workouts");
}


function numberOrNull(id) {
  const raw = $(id)?.value;
  if (raw === "" || raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function loadAssistantNutrition() {
  try {
    const response = await fetch("./data/nutrition.json", { cache:"no-store" });
    if (!response.ok) throw new Error(`nutrition.json ${response.status}`);
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : payload?.entries;
    state.nutritionAssistantEntries = Array.isArray(entries) ? entries : [];
  } catch (error) {
    console.warn("Питание из чата пока недоступно", error);
    state.nutritionAssistantEntries = [];
  }
  return state.nutritionAssistantEntries;
}

function mergeNutritionEntries(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const key = item?.id || [
        item?.date,
        item?.meal,
        item?.name,
        item?.quantity,
        item?.kcal
      ].join("|");
      byId.set(String(key), item);
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(a.createdAt || a.date || "").localeCompare(String(b.createdAt || b.date || ""))
  );
}

async function loadNutrition() {
  const date = $("nutrition-date").value || todayIso();
  $("nutrition-date").value = date;

  const assistantEntries = await loadAssistantNutrition();
  let dayEntries = [];
  let calendarEntries = [];

  try {
    [dayEntries, calendarEntries] = await Promise.all([
      api("/api/nutrition?date=" + encodeURIComponent(date)),
      api("/api/nutrition")
    ]);
  } catch (error) {
    console.warn("API питания недоступен, показываю записи из чата", error);
  }

  const assistantDayEntries = assistantEntries.filter((item) =>
    String(item?.date || "").slice(0, 10) === date
  );

  state.nutritionEntries = mergeNutritionEntries(assistantDayEntries, dayEntries);
  state.nutritionCalendarEntries = mergeNutritionEntries(assistantEntries, calendarEntries);
  if (!state.workoutCalendarEntries.length) {
    const workoutChat = await loadAssistantWorkouts();
    let workoutApi = [];
    try { workoutApi = await api("/api/workouts"); }
    catch (error) { console.warn("Тренировки для баланса пока недоступны", error); }
    state.workoutCalendarEntries = mergeWorkoutEntries(workoutChat, workoutApi);
  }
  renderLifeBalances();
  renderNutrition();
  renderCalendar("nutrition");
}

function renderNutrition() {
  const entries = state.nutritionEntries || [];
  const totals = entries.reduce((acc, item) => {
    for (const key of ["kcal","protein","carbs","fat"]) acc[key] += Number(item[key] || 0);
    return acc;
  }, {kcal:0,protein:0,carbs:0,fat:0});

  $("nutrition-summary").innerHTML = `
    <div><span>Ккал</span><strong>${Math.round(totals.kcal)}</strong></div>
    <div><span>Белки</span><strong>${totals.protein.toFixed(1)} г</strong></div>
    <div><span>Углеводы</span><strong>${totals.carbs.toFixed(1)} г</strong></div>
    <div><span>Жиры</span><strong>${totals.fat.toFixed(1)} г</strong></div>
  `;

  const host = $("nutrition-list");
  host.replaceChildren();
  if (!entries.length) {
    host.innerHTML = '<div class="review-empty">На этот день пока ничего не добавлено.</div>';
    return;
  }
  for (const item of entries) {
    const card = document.createElement("article");
    card.className = "life-card";
    const amount = [item.quantity, item.unit].filter(Boolean).join(" ");
    const fromChat = item.source === "chatgpt" || item.origin === "assistant";
    card.innerHTML = `
      <div class="life-card-main">
        <div class="life-card-kicker">${escapeHtml(item.meal || "Приём пищи")}</div>
        <div class="life-card-title">${escapeHtml(item.name)}</div>
        <div class="life-card-meta">${escapeHtml(amount)} ${item.kcal ? "· " + Number(item.kcal) + " ккал" : ""}</div>
        <div class="life-card-meta">Б ${Number(item.protein || 0)} · У ${Number(item.carbs || 0)} · Ж ${Number(item.fat || 0)}</div>
        ${fromChat ? '<div class="life-card-meta">Добавлено из чата · оценка по фото</div>' : ""}
      </div>
      ${fromChat ? "" : '<button class="homework-delete" type="button" aria-label="Удалить">×</button>'}
    `;
    const deleteButton = card.querySelector("button");
    if (deleteButton) {
      deleteButton.onclick = async () => {
        await api("/api/nutrition/" + encodeURIComponent(item.id), {method:"DELETE"});
        loadNutrition();
      };
    }
    host.append(card);
  }
}

async function loadAssistantWorkouts() {
  try {
    const response = await fetch("./data/workouts.json", { cache:"no-store" });
    if (!response.ok) throw new Error("workouts.json " + response.status);
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : payload?.entries;
    state.workoutAssistantEntries = Array.isArray(entries) ? entries : [];
  } catch (error) {
    console.warn("Тренировки из чата пока недоступны", error);
    state.workoutAssistantEntries = [];
  }
  return state.workoutAssistantEntries;
}

function mergeWorkoutEntries(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const key = item.id || [item.date, item.startTime, item.title, item.distanceKm, item.durationMinutes].join("|");
      byId.set(String(key), item);
    }
  }
  return [...byId.values()].sort((a, b) =>
    String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""))
  );
}

async function loadWorkouts() {
  const date = $("workout-date").value || todayIso();
  $("workout-date").value = date;
  const assistantEntries = await loadAssistantWorkouts();
  let dayEntries = [];
  let calendarEntries = [];
  try {
    [dayEntries, calendarEntries] = await Promise.all([
      api("/api/workouts?date=" + encodeURIComponent(date)),
      api("/api/workouts")
    ]);
  } catch (error) {
    console.warn("API тренировок недоступен, показываю записи из чата", error);
  }
  const assistantDayEntries = assistantEntries.filter((item) =>
    String(item?.date || "").slice(0, 10) === date
  );
  state.workoutEntries = mergeWorkoutEntries(assistantDayEntries, dayEntries);
  state.workoutCalendarEntries = mergeWorkoutEntries(assistantEntries, calendarEntries);
  if (!state.nutritionCalendarEntries.length) {
    const foodChat = await loadAssistantNutrition();
    let foodApi = [];
    try { foodApi = await api("/api/nutrition"); }
    catch (error) { console.warn("Питание для баланса пока недоступно", error); }
    state.nutritionCalendarEntries = mergeNutritionEntries(foodChat, foodApi);
  }
  renderLifeBalances();
  renderWorkouts();
  renderCalendar("workouts");
}

function renderWorkouts() {
  const host = $("workout-list");
  host.replaceChildren();
  const entries = state.workoutEntries || [];
  if (!entries.length) {
    host.innerHTML = '<div class="review-empty">На этот день тренировок пока нет.</div>';
    return;
  }
  for (const item of entries) {
    const card = document.createElement("article");
    card.className = "life-card";
    const exercises = Array.isArray(item.exercises) ? item.exercises : [];
    card.innerHTML = `
      <div class="life-card-main">
        <div class="life-card-kicker">${item.durationSeconds != null ? (Number(item.durationMinutes) + " мин " + Number(item.durationSeconds) + " сек") : (item.durationMinutes ? Number(item.durationMinutes) + " мин" : "Тренировка")}</div>
        <div class="life-card-title workout-card-title"><span class="workout-card-icons" aria-hidden="true">${workoutActivityTypes(item).map(workoutIcon).join("")}</span>${escapeHtml(item.title)}</div>
        <div class="exercise-lines">${exercises.map((x) => `<div>${escapeHtml(x)}</div>`).join("")}</div>
        ${item.notes ? `<div class="life-card-meta">${escapeHtml(item.notes)}</div>` : ""}
      </div>
      ${item.source === "chatgpt" ? "" : '<button class="homework-delete" type="button" aria-label="Удалить">×</button>'}
    `;
    const deleteButton = card.querySelector("button");
    if (deleteButton) {
      deleteButton.onclick = async () => {
        await api("/api/workouts/" + encodeURIComponent(item.id), {method:"DELETE"});
        loadWorkouts();
      };
    }
    host.append(card);
  }
}


function skillReview(skill) {
  return skill?.review || { repetition: 0, dueDate: null, lastResult: null };
}

function isSkillDue(skill) {
  if (Number(skill?.mastery || 0) <= 0) return false;
  const dueDate = skillReview(skill).dueDate;
  return !dueDate || dueDate <= todayIso();
}

function reviewQueues(exam) {
  const today = todayIso();
  const candidates = examSkills(exam).filter((skill) =>
    Number(skill.mastery || 0) > 0 || skillReview(skill).dueDate
  );

  const due = candidates
    .filter((skill) => {
      const date = skillReview(skill).dueDate;
      return !date || date <= today;
    })
    .sort((a, b) => String(skillReview(a).dueDate || "").localeCompare(String(skillReview(b).dueDate || "")));

  const upcoming = candidates
    .filter((skill) => skillReview(skill).dueDate && skillReview(skill).dueDate > today)
    .sort((a, b) => skillReview(a).dueDate.localeCompare(skillReview(b).dueDate));

  return { due, upcoming };
}

function currentSemester() {
  return state.data?.semesters?.find((s) => s.id === state.semesterId) || null;
}

function currentExam() {
  return currentSemester()?.exams?.find((e) => e.id === state.examId) || null;
}

function examSkills(exam) {
  return exam?.skills || [];
}

function examReadiness(exam) {
  const skills = examSkills(exam);
  if (!skills.length) return 0;
  const weighted = skills.reduce((sum, skill) => {
    const weight = Number(skill.weight || 1);
    return sum + Number(skill.mastery || 0) * weight;
  }, 0);
  const totalWeight = skills.reduce((sum, skill) => sum + Number(skill.weight || 1), 0);
  return Math.round(weighted / Math.max(1, totalWeight));
}

function overallReadiness(semester) {
  const exams = semester?.exams || [];
  if (!exams.length) return 0;
  const weighted = exams.reduce((sum, exam) => sum + examReadiness(exam) * Number(exam.weight || 1), 0);
  const total = exams.reduce((sum, exam) => sum + Number(exam.weight || 1), 0);
  return Math.round(weighted / Math.max(1, total));
}

async function loadData() {
  const response = await fetch("./data/study.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить данные");
  state.data = await response.json();
  state.lectureTasks = await loadLectureTasks();
  await loadSavedStudyProgress();
  state.quizTodayBySkill = todayQuizResults();
  applyFlashcardQuizMastery();
  const firstSemester = state.data.semesters?.[0];
  state.semesterId = firstSemester?.id || "";
  state.examId = firstSemester?.exams?.[0]?.id || "";
  renderAll();
  openHomeworkFromHash();
}

function renderAll() {
  renderSection();
  renderMeta();
  renderSemesterSelect();
  renderExamCards();
  renderExamSelect();
  renderTopics();
  renderSlidesCatalog();
  renderWorkspace();
  renderHistory();
  renderReview();
  renderHomework();
  renderAllCalendars();
}

function renderMeta() {
  const todayCards = [...state.quizTodayBySkill.values()].reduce((sum, row) => sum + row.total, 0);
  $("updated-at").textContent = todayCards
    ? "Сегодня пройдено " + todayCards + " карточек"
    : state.data?.updatedAt ? "Обновлено " + fmtDate(state.data.updatedAt)
    : "Данные пока не обновлялись";
  $("overall-readiness").textContent = overallReadiness(currentSemester()) + "%";
}

function renderSemesterSelect() {
  const select = $("semester-select");
  select.replaceChildren();
  const semesters = state.data?.semesters || [];
  if (!semesters.length) {
    const option = new Option("Нет семестров", "");
    select.append(option);
    select.disabled = true;
    return;
  }
  for (const semester of semesters) {
    select.append(new Option(semester.title, semester.id));
  }
  select.value = state.semesterId;
  select.onchange = () => {
    state.semesterId = select.value;
    state.examId = currentSemester()?.exams?.[0]?.id || "";
    state.topicId = "all";
    state.slideFilter = null;
    state.selectedSkillId = "";
    renderAll();
    fitMap();
  };
}

function renderExamCards() {
  const host = $("exam-cards");
  host.replaceChildren();
  const exams = currentSemester()?.exams || [];
  if (!exams.length) {
    const p = document.createElement("div");
    p.className = "no-data";
    p.textContent = "Экзамены ещё не добавлены.";
    host.append(p);
    return;
  }
  for (const exam of exams) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "exam-card" + (exam.id === state.examId ? " active" : "");
    const readiness = examReadiness(exam);
    card.innerHTML = `
      <div class="exam-card-top">
        <div>
          <h3>${escapeHtml(exam.title)}</h3>
          <div class="exam-meta">${exam.date ? "Экзамен: " + fmtDate(exam.date) : "Дата не указана"}</div>
        </div>
        <div class="exam-percent">${readiness}%</div>
      </div>
      <div class="progress"><span style="width:${readiness}%"></span></div>
    `;
    card.onclick = () => {
      state.examId = exam.id;
      state.topicId = "all";
      state.selectedSkillId = "";
      renderAll();
      fitMap();
    };
    host.append(card);
  }
}

function renderExamSelect() {
  const select = $("exam-select");
  select.replaceChildren();
  const exams = currentSemester()?.exams || [];
  if (!exams.length) {
    select.append(new Option("Нет экзаменов", ""));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const exam of exams) select.append(new Option(exam.title, exam.id));
  select.value = state.examId;
  select.onchange = () => {
    state.examId = select.value;
    state.topicId = "all";
    state.selectedSkillId = "";
    renderTopics();
    renderSlidesCatalog();
    renderWorkspace();
    renderExamCards();
    renderReview();
    renderHistory();
    fitMap();
  };
}

function renderSlidesCatalog() {
  const host = $("slides-catalog");
  if (!host) return;
  host.replaceChildren();
  const lectures = currentExam()?.lectures || [];
  if (!lectures.length) {
    host.textContent = "Для этого предмета оглавление пока не загружено.";
    return;
  }
  for (const lecture of lectures) {
    const title = document.createElement("div");
    title.className = "slides-lecture-title";
    title.textContent = lecture.title + " · " + lecture.slides.filter(x=>x.uploaded).length + "/" + lecture.slides.length;
    host.append(title);
    for (const slide of lecture.slides) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "slides-catalog-row" + (state.slideFilter?.lectureId === lecture.id && state.slideFilter?.number === slide.number ? " active" : "");
      row.innerHTML = '<span class="slides-status ' + (slide.uploaded ? "uploaded" : "missing") + '">' + (slide.uploaded ? "✓" : "—") + '</span><span>№ ' + slide.number + ' · ' + escapeHtml(slide.title) + '</span>';
      row.onclick = () => {
        state.slideFilter = state.slideFilter?.lectureId === lecture.id && state.slideFilter?.number === slide.number ? null : {lectureId:lecture.id,number:slide.number};
        state.topicId = "all";
        renderTopics();
        renderSlidesCatalog();
        renderWorkspace();
        fitMap();
      };
      host.append(row);
    }
  }
  if (state.slideFilter) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "slides-reset";
    reset.textContent = "Показать все слайды";
    reset.onclick = () => {state.slideFilter=null;renderSlidesCatalog();renderWorkspace();fitMap();};
    host.prepend(reset);
  }
}

function renderTopics() {
  const host = $("topic-list");
  host.replaceChildren();
  const exam = currentExam();
  const topics = exam?.topics || [];
  const all = topicButton("Все навыки", "all");
  host.append(all);
  for (const topic of topics) host.append(topicButton(topic.title, topic.id));
}

function topicButton(label, id) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "topic-button" + (state.topicId === id ? " active" : "");
  button.textContent = label;
  button.onclick = () => {
    state.topicId = id;
    state.selectedSkillId = "";
    renderTopics();
    renderWorkspace();
    fitMap();
  };
  return button;
}

function filteredSkills() {
  const exam = currentExam();
  if (!exam) return [];
  const query = $("search").value.trim().toLowerCase();
  return examSkills(exam).filter((skill) => {
    if (state.topicId !== "all" && skill.topicId !== state.topicId) return false;
    if (state.slideFilter && (skill.lectureId !== state.slideFilter.lectureId || !(skill.slideNumbers || []).includes(state.slideFilter.number))) return false;
    if (!query) return true;
    const lecture = (exam.lectures || []).find(l => l.id === skill.lectureId);
    const slideTitles = (lecture?.slides || []).filter(sl => (skill.slideNumbers || []).includes(sl.number)).map(sl => "Слайд " + sl.number + " " + sl.title);
    const haystack = [skill.title, skill.subtitle, skill.description, lecture?.title, ...slideTitles].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function renderWorkspace() {
  const skills = filteredSkills();
  const exam = currentExam();
  const empty = $("empty-state");

  $("map").hidden = false;

  if (!exam || !examSkills(exam).length) {
    empty.hidden = false;
    $("world").hidden = true;
    $("list").hidden = true;
    $("inspector").classList.add("closed");
    return;
  }

  empty.hidden = true;
  $("world").hidden = state.viewMode !== "map";
  $("list").hidden = state.viewMode !== "list";

  if (state.viewMode === "map") renderMap(skills);
  else renderList(skills);
  window.dispatchEvent(new Event("study-context-updated"));
}

function renderMap(skills) {
  const nodes = $("nodes");
  const edges = $("edges");
  nodes.replaceChildren();
  edges.replaceChildren();

  const exam = currentExam();
  const visible = new Set(skills.map((s) => s.id));

  for (const relation of exam?.relations || []) {
    if (!visible.has(relation.from) || !visible.has(relation.to)) continue;
    const from = exam.skills.find((s) => s.id === relation.from);
    const to = exam.skills.find((s) => s.id === relation.to);
    if (!from || !to) continue;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const x1 = Number(from.x || 0), y1 = Number(from.y || 0);
    const x2 = Number(to.x || 0), y2 = Number(to.y || 0);
    const dx = x2 - x1, dy = y2 - y1;
    let startX, startY, endX, endY, c1x, c1y, c2x, c2y;
    // Cards are 220px wide and at least 116px tall. For predominantly
    // vertical links use bottom/top instead of looping from right to left.
    if (Math.abs(dx) >= Math.abs(dy) * 0.85 && Math.abs(dx) > 100) {
      const forward = dx > 0;
      startX = x1 + (forward ? 220 : 0);
      startY = y1 + 58;
      endX = x2 + (forward ? 0 : 220);
      endY = y2 + 58;
      const curve = Math.max(32, Math.abs(endX - startX) * 0.43);
      c1x = startX + (forward ? curve : -curve); c1y = startY;
      c2x = endX - (forward ? curve : -curve); c2y = endY;
    } else {
      const down = dy >= 0;
      startX = x1 + 110;
      startY = y1 + (down ? 116 : 0);
      endX = x2 + 110;
      endY = y2 + (down ? 0 : 116);
      const curve = Math.max(30, Math.abs(endY - startY) * 0.43);
      c1x = startX; c1y = startY + (down ? curve : -curve);
      c2x = endX; c2y = endY - (down ? curve : -curve);
    }
    const p = n => Math.round(n + 5000);
    line.setAttribute("d", `M ${p(startX)} ${p(startY)} C ${p(c1x)} ${p(c1y)}, ${p(c2x)} ${p(c2y)}, ${p(endX)} ${p(endY)}`);
    line.setAttribute("class", relation.type === "related" ? "edge edge-related" : "edge");
    edges.append(line);
  }

  for (const skill of skills) {
    const node = document.createElement("article");
    node.className = "skill-node" + (skill.examRequired ? " exam-required" : "") + (state.selectedSkillId === skill.id ? " selected" : "");
    node.style.left = Number(skill.x || 0) + "px";
    node.style.top = Number(skill.y || 0) + "px";
    const topic = currentExam()?.topics?.find((t) => t.id === skill.topicId);
    const klass = readinessClass(Number(skill.mastery || 0));
    const dueBadge = isSkillDue(skill) ? '<span class="review-due-badge">повторить</span>' : '';
    const examBadge = skill.examRequired ? `<span class="exam-required-badge">EXAM ×${Number(skill.examFrequency?.count || 1)}</span>` : "";
    node.innerHTML = `
      <div class="skill-card-head">
        <div class="skill-topic">${escapeHtml(topic?.title || "Навык")}</div>
        <div class="skill-card-badges">${examBadge}${dueBadge}</div>
      </div>
      <div class="skill-title">${escapeHtml(skill.title)}</div>
      ${skill.slideNumbers?.length ? `<div class="skill-slide-source">Слайд ${skill.slideNumbers.join(", ")}</div>` : ""}
      <div class="skill-subtitle">${escapeHtml(skill.subtitle || "")}</div>
      ${quizTodayBadgeMarkup(skill)}
      <div class="skill-bottom">
        <span class="skill-percent">${Number(skill.mastery || 0)}%</span>
        <span class="badge ${klass}">${masteryLabel(Number(skill.mastery || 0))}</span>
      </div>
    `;
    node.onclick = (event) => {
      event.stopPropagation();
      state.selectedSkillId = skill.id;
      renderMap(skills);
      showInspector(skill);
    };
    nodes.append(node);
  }

  applyTransform();
}

function renderList(skills) {
  const host = $("list");
  host.replaceChildren();
  const exam = currentExam();
  const topics = exam?.topics || [];
  if (!skills.length) {
    host.innerHTML = '<div class="no-data">По этому фильтру ничего не найдено.</div>';
    return;
  }

  const groups = state.topicId === "all" ? topics : topics.filter((t) => t.id === state.topicId);
  for (const topic of groups) {
    const topicSkills = skills.filter((s) => s.topicId === topic.id);
    if (!topicSkills.length) continue;
    const block = document.createElement("section");
    block.className = "list-group";
    const heading = document.createElement("h3");
    heading.textContent = topic.title;
    block.append(heading);
    for (const skill of topicSkills) {
      const row = document.createElement("div");
      row.className = "list-row" + (skill.examRequired ? " exam-required" : "");
      row.innerHTML = `
        <div>
          <div class="list-row-title">${escapeHtml(skill.title)} ${skill.examRequired ? `<span class="exam-required-inline">EXAM ×${Number(skill.examFrequency?.count || 1)}</span>` : ""}</div>
          <div class="list-row-sub">${escapeHtml(skill.subtitle || "")}</div>
          ${skill.slideNumbers?.length ? `<div class="skill-slide-source">Слайд ${skill.slideNumbers.join(", ")}</div>` : ""}
          ${quizTodayBadgeMarkup(skill)}
        </div>
        <div class="list-row-percent">${Number(skill.mastery || 0)}%</div>
        <span class="badge ${readinessClass(Number(skill.mastery || 0))}">${masteryLabel(Number(skill.mastery || 0))}</span>
      `;
      row.onclick = () => {
        state.selectedSkillId = skill.id;
        showInspector(skill);
      };
      block.append(row);
    }
    host.append(block);
  }
}

function masteryLabel(value) {
  if (value >= 90) return "закреплено";
  if (value >= 70) return "уверенно";
  if (value >= 40) return "в работе";
  return "слабое место";
}

function showInspector(skill) {
  const inspector = $("inspector");
  $("history-panel")?.classList.add("closed");
  $("review-panel")?.classList.add("closed");
  const host = $("inspector-content");
  const topic = currentExam()?.topics?.find((t) => t.id === skill.topicId);
  const evidence = skill.evidence || [];

  host.innerHTML = `
    <h2>${escapeHtml(skill.title)}</h2>
    <div class="de">${escapeHtml(skill.subtitle || topic?.title || "")}</div>
    ${skill.examRequired ? `<div class="exam-required-panel">EXAM ×${Number(skill.examFrequency?.count || 1)} · ${escapeHtml((skill.examYears || []).join(", "))}</div>` : ""}

    <div class="inspector-section">
      <div class="inspector-label">ТЕКУЩЕЕ ОСВОЕНИЕ</div>
      <div class="big-percent">${Number(skill.mastery || 0)}%</div>
      <span class="badge ${readinessClass(Number(skill.mastery || 0))}">${masteryLabel(Number(skill.mastery || 0))}</span>
    </div>

    <div class="inspector-section">
      <div class="inspector-label">ЧТО НУЖНО УМЕТЬ</div>
      <div>${escapeHtml(skill.description || "Описание появится после разбора материалов.")}</div>
    </div>

    <div class="inspector-section">
      <div class="inspector-label">ПОСЛЕДНЕЕ ОБНОВЛЕНИЕ</div>
      <div>${fmtDate(skill.lastUpdated)}</div>
    </div>

    <div class="inspector-section">
      <div class="inspector-label">ПОВТОРЕНИЕ</div>
      <div>${reviewStatusText(skill)}</div>
    </div>

    ${quizTodayInspectorMarkup(skill)}

    <div class="inspector-section">
      <div class="inspector-label">ДОКАЗАТЕЛЬСТВА</div>
      <div id="evidence-list"></div>
    </div>
  `;

  const evidenceHost = host.querySelector("#evidence-list");
  if (!evidence.length) {
    evidenceHost.innerHTML = '<div class="no-data">Пока нет подтверждённых попыток.</div>';
  } else {
    for (const item of evidence.slice().reverse()) {
      const box = document.createElement("div");
      box.className = "evidence";
      box.innerHTML = `
        <div>${escapeHtml(item.note || "")}</div>
        <div class="evidence-meta">${fmtDate(item.date)} · ${escapeHtml(item.source || "занятие")}</div>
      `;
      evidenceHost.append(box);
    }
  }
  inspector.classList.remove("closed");
}

function reviewStatusText(skill) {
  const mastery = Number(skill.mastery || 0);
  const review = skillReview(skill);
  if (mastery <= 0 && !review.dueDate) {
    return "Появится после первого изучения навыка.";
  }
  if (!review.dueDate || review.dueDate <= todayIso()) {
    return "Нужно повторить сегодня.";
  }
  return `Следующее повторение: ${fmtDate(review.dueDate)} · этап ${Number(review.repetition || 0)}/6`;
}

// The review queue contains flashcards only. Skills are tracked in the map,
// but are not independently scheduled for repetition.
function renderReview() {
  const count = $("review-count");
  const summary = $("review-summary");
  const list = $("review-list");
  const upcomingHost = $("review-upcoming");
  if (!count || !summary || !list || !upcomingHost) return;
  count.textContent = "0";
  count.classList.add("zero");
  summary.innerHTML = '<strong>Карточки</strong><span>Повторения по расписанию доступны в разделе «Карточки». Навыки отдельно не повторяются.</span>';
  list.replaceChildren();
  upcomingHost.replaceChildren();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "primary";
  button.textContent = "Открыть карточки";
  button.onclick = () => {
    $("review-panel").classList.add("closed");
    $("flashcard-toggle")?.click();
  };
  list.append(button);
}


function renderHomework() {
  const count = $("homework-count");
  const summary = $("next-lecture-summary");
  const host = $("homework-list");
  if (!count || !summary || !host) return;

  const open = openLectureTasks();
  count.textContent = String(open.length);
  count.classList.toggle("zero", open.length === 0);

  const next = nextLectureDate();
  const nextDate = next ? new Date(next + "T12:00:00") : null;
  summary.innerHTML = nextDate
    ? `<div class="next-lecture-label">Следующая лекция</div>
       <strong>${weekdayRu(nextDate.getDay())}, ${fmtDate(next)}</strong>
       <span>Расписание: среда</span>`
    : `<strong>Расписание лекций не задано</strong>`;

  host.replaceChildren();
  const tasks = state.lectureTasks.slice().sort((a, b) => {
    if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
    return String(a.dueDate || "").localeCompare(String(b.dueDate || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });

  if (!tasks.length) {
    host.innerHTML = '<div class="review-empty">Пока задач нет. Добавь то, что нужно сделать до следующей лекции.</div>';
    return;
  }

  for (const task of tasks) {
    const row = document.createElement("article");
    row.className = "homework-task" + (task.done ? " done" : "");
    const exam = state.data?.semesters
      ?.flatMap((semester) => semester.exams || [])
      .find((item) => item.id === task.examId);
    const overdue = !task.done && task.dueDate && task.dueDate < todayIso();
    row.innerHTML = `
      <label class="homework-check">
        <input type="checkbox" ${task.done ? "checked" : ""} aria-label="Готово" />
        <span></span>
      </label>
      <div class="homework-task-body">
        <div class="homework-task-title">${escapeHtml(task.title)}</div>
        <div class="homework-task-meta">
          <span>${escapeHtml(exam?.title || "Учёба")}</span>
          <span class="${overdue ? "overdue" : ""}">${overdue ? "просрочено · " : ""}${fmtDate(task.dueDate)}</span>
        </div>
      </div>
      <button class="homework-delete" type="button" aria-label="Удалить">×</button>
    `;

    row.querySelector('input[type="checkbox"]').onchange = async (event) => {
      const checkbox = event.target;
      checkbox.disabled = true;
      try {
        const saved = await api("/api/tasks/" + encodeURIComponent(task.id), {
          method:"PATCH",
          body:JSON.stringify({done:checkbox.checked})
        });
        Object.assign(task, saved);
        localStorage.removeItem(LECTURE_TASKS_KEY);
      } catch (error) {
        alert("Не удалось сохранить выполнение в базе. Проверь подключение и попробуй ещё раз.");
      }
      renderHomework();
      renderCalendar("study");
      window.dispatchEvent(new Event("study-tasks-updated"));
    };
    row.querySelector(".homework-delete").onclick = async () => {
      try {
        await api("/api/tasks/" + encodeURIComponent(task.id), {method:"DELETE"});
      } catch {
        alert("Не удалось удалить задачу с сервера. Попробуй ещё раз.");
        return;
      }
      state.lectureTasks = state.lectureTasks.filter((item) => item.id !== task.id);
      localStorage.removeItem(LECTURE_TASKS_KEY);
      renderHomework();
      window.dispatchEvent(new Event("study-tasks-updated"));
    };
    host.append(row);
  }
}

async function addHomeworkTask(title, targetDay) {
  const clean = String(title || "").trim();
  if (!clean) return;
  const exactDate = $("homework-date").value || "";
  const preferred = exactDate ? null : (targetDay === "auto" ? null : Number(targetDay));
  const draft = {
    id: "lecture-task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    title: clean,
    semesterId: state.semesterId,
    examId: state.examId,
    targetDay: preferred,
    dueDate: exactDate || nextLectureDate(preferred),
    createdAt: new Date().toISOString(),
    done: false,
    completedAt: null
  };
  try {
    const saved = await api("/api/tasks", {method:"POST", body:JSON.stringify(draft)});
    state.lectureTasks.push(saved);
    localStorage.removeItem(LECTURE_TASKS_KEY);
  } catch {
    alert("Не удалось добавить задачу на сервер. Попробуй ещё раз, чтобы она попала в напоминания.");
    return;
  }
  renderHomework();
  window.dispatchEvent(new Event("study-tasks-updated"));
}


function renderHistory() {
  const host = $("session-history");
  host.replaceChildren();
  const quizSessions = quizHistoryForMap()
    .filter(s => (!state.examId || s.examId === state.examId))
    .map(s => ({
      id:s.id, examId:s.examId, semesterId:state.semesterId,
      date:s.completedAt || s.date,
      title:s.type === "PRACTICE" ? "Свободная тренировка карточек" : "Повторение карточек по расписанию",
      summary:"С первой попытки: "+Number(s.correctFirstTry || 0)+" из "+Number(s.totalCards || 0)+
        ". "+(s.type === "PRACTICE" ? "Прогресс навыков не изменяется." : "Результат учтён в карте навыков."),
      changes:[]
    }));
  const sessions = [...(state.data?.sessions || []), ...quizSessions]
    .filter((s) => (!state.semesterId || s.semesterId === state.semesterId) && (!state.examId || s.examId === state.examId))
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  if (!sessions.length) {
    host.innerHTML = '<div class="no-data">История появится после первого занятия и обновления знаний.</div>';
    return;
  }

  for (const session of sessions) {
    const exam = currentSemester()?.exams?.find((e) => e.id === session.examId);
    const item = document.createElement("article");
    item.className = "session";
    item.innerHTML = `
      <div class="session-top">
        <div class="session-title">${escapeHtml(session.title || exam?.title || "Учебная сессия")}</div>
        <div class="session-date">${fmtDate(session.date)}</div>
      </div>
      <div class="session-summary">${escapeHtml(session.summary || "")}</div>
      <div class="session-changes"></div>
    `;
    // Keep exact learning position visible in history, not only in JSON.
    const cp=session.checkpoint;
    if (cp?.document && Number.isInteger(Number(cp.page))) {
      const marker=document.createElement("div");
      marker.className="session-checkpoint";
      const heading=document.createElement("strong");
      heading.textContent=`Где остановились: ${cp.document}, стр. ${cp.page} из ${cp.totalPages || "?"} — ${cp.topic || ""}`;
      const note=document.createElement("span");
      note.textContent=`Последний подробно разобранный слайд: ${cp.lastExplainedPage || "?"}. ${cp.note || ""}`;
      marker.append(heading,note);
      item.querySelector(".session-summary").after(marker);
    }
    const changes = item.querySelector(".session-changes");
    for (const change of session.changes || []) {
      const chip = document.createElement("span");
      chip.className = "change-chip";
      const delta = Number(change.to || 0) - Number(change.from || 0);
      chip.textContent = `${change.skillTitle}: ${change.from}% → ${change.to}% ${delta > 0 ? "↑" : delta < 0 ? "↓" : ""}`;
      changes.append(chip);
    }
    host.append(item);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function applyTransform() {
  $("world").style.transform = `translate(${state.viewport.x}px,${state.viewport.y}px) scale(${state.viewport.z})`;
  const level = $("zoom-level");
  if (level) level.textContent = Math.round(state.viewport.z * 100) + "%";
}

function zoomAtCenter(factor) {
  const map = $("map");
  const px = map.clientWidth / 2;
  const py = map.clientHeight / 2;
  const oldZ = state.viewport.z;
  const nextZ = clamp(oldZ * factor, .3, 2);
  const wx = (px - state.viewport.x) / oldZ;
  const wy = (py - state.viewport.y) / oldZ;
  state.viewport.z = nextZ;
  state.viewport.x = px - wx * nextZ;
  state.viewport.y = py - wy * nextZ;
  applyTransform();
}

function fitMap() {
  if (state.viewMode !== "map") return;
  const skills = filteredSkills();
  if (!skills.length) return;
  const map = $("map");
  const minX = Math.min(...skills.map((s) => Number(s.x || 0)));
  const minY = Math.min(...skills.map((s) => Number(s.y || 0)));
  const maxX = Math.max(...skills.map((s) => Number(s.x || 0) + 220));
  const maxY = Math.max(...skills.map((s) => Number(s.y || 0) + 116));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const padding = 80;
  const z = clamp(Math.min((map.clientWidth - padding) / width, (map.clientHeight - padding) / height, 1.25), .35, 1.25);
  state.viewport.z = z;
  state.viewport.x = (map.clientWidth - width * z) / 2 - minX * z;
  state.viewport.y = (map.clientHeight - height * z) / 2 - minY * z;
  applyTransform();
}

$("search").addEventListener("input", renderWorkspace);
$("map-view").onclick = () => {
  state.viewMode = "map";
  $("map-view").classList.add("active");
  $("list-view").classList.remove("active");
  renderWorkspace();
  setTimeout(fitMap, 0);
};
$("list-view").onclick = () => {
  state.viewMode = "list";
  $("list-view").classList.add("active");
  $("map-view").classList.remove("active");
  renderWorkspace();
};
$("fit").onclick = fitMap;
$("zoom-in").onclick = () => zoomAtCenter(1.2);
$("zoom-out").onclick = () => zoomAtCenter(1 / 1.2);

const leftPanel = $("left-panel");
const leftPanelToggle = $("left-panel-toggle");
leftPanelToggle.onclick = () => {
  const collapsed = leftPanel.classList.toggle("collapsed");
  leftPanelToggle.classList.toggle("collapsed", collapsed);
  leftPanelToggle.textContent = collapsed ? "☰" : "×";
  leftPanelToggle.title = collapsed ? "Показать настройки" : "Скрыть настройки";
};

const reviewPanel = $("review-panel");
if ($("review-toggle")) $("review-toggle").onclick = () => {
  renderReview();
  const willOpen = reviewPanel.classList.contains("closed");
  reviewPanel.classList.toggle("closed", !willOpen);
  if (willOpen) {
    $("inspector").classList.add("closed");
    $("history-panel").classList.add("closed");
    $("homework-panel").classList.add("closed");
    $("study-calendar-panel").classList.add("closed");
  }
};
if ($("close-review")) $("close-review").onclick = () => reviewPanel.classList.add("closed");

const historyPanel = $("history-panel");
$("history-toggle").onclick = () => {
  renderHistory();
  const willOpen = historyPanel.classList.contains("closed");
  historyPanel.classList.toggle("closed", !willOpen);
  if (willOpen) {
    $("inspector").classList.add("closed");
    $("review-panel").classList.add("closed");
    $("homework-panel").classList.add("closed");
    $("study-calendar-panel").classList.add("closed");
  }
};
$("close-history").onclick = () => historyPanel.classList.add("closed");

const studyCalendarPanel = $("study-calendar-panel");
$("study-calendar-toggle").onclick = () => {
  renderCalendar("study");
  const willOpen = studyCalendarPanel.classList.contains("closed");
  studyCalendarPanel.classList.toggle("closed", !willOpen);
  if (willOpen) {
    $("inspector").classList.add("closed");
    $("review-panel").classList.add("closed");
    $("history-panel").classList.add("closed");
    $("homework-panel").classList.add("closed");
  }
};
$("close-study-calendar").onclick = () => studyCalendarPanel.classList.add("closed");

const homeworkPanel = $("homework-panel");
$("homework-toggle").onclick = () => {
  renderHomework();
  const willOpen = homeworkPanel.classList.contains("closed");
  homeworkPanel.classList.toggle("closed", !willOpen);
  if (willOpen) {
    $("inspector").classList.add("closed");
    $("review-panel").classList.add("closed");
    $("history-panel").classList.add("closed");
    $("study-calendar-panel").classList.add("closed");
  }
};
$("close-homework").onclick = () => homeworkPanel.classList.add("closed");

function openHomeworkFromHash() {
  if (location.hash !== "#homework" || !state.data) return;
  if (state.section !== "study") switchSection("study");
  renderHomework();
  homeworkPanel.classList.remove("closed");
  for (const id of ["inspector", "review-panel", "history-panel", "study-calendar-panel"]) {
    $(id)?.classList.add("closed");
  }
}
window.addEventListener("hashchange", openHomeworkFromHash);

$("homework-date").min = todayIso();
$("homework-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("homework-input");
  const day = $("homework-day");
  await addHomeworkTask(input.value, day.value);
  input.value = "";
  $("homework-date").value = "";
  input.focus();
};

for (const button of document.querySelectorAll(".section-tab")) {
  button.onclick = () => switchSection(button.dataset.section);
}

const nutritionAddPanel = $("nutrition-add-panel");
$("nutrition-add-toggle").onclick = () => {
  nutritionAddPanel.hidden = !nutritionAddPanel.hidden;
  if (!nutritionAddPanel.hidden) {
    $("nutrition-name")?.focus();
  }
};
$("nutrition-add-close").onclick = () => {
  nutritionAddPanel.hidden = true;
};

$("nutrition-date").value = todayIso();
$("workout-date").value = todayIso();
$("nutrition-date").onchange = loadNutrition;
$("workout-date").onchange = loadWorkouts;

$("nutrition-form").onsubmit = async (event) => {
  event.preventDefault();
  const name = $("nutrition-name").value.trim();
  if (!name) return;
  await api("/api/nutrition", {
    method:"POST",
    body:JSON.stringify({
      date:$("nutrition-date").value || todayIso(),
      meal:$("nutrition-meal").value,
      name,
      quantity:numberOrNull("nutrition-quantity"),
      unit:$("nutrition-unit").value.trim() || null,
      kcal:numberOrNull("nutrition-kcal"),
      protein:numberOrNull("nutrition-protein"),
      carbs:numberOrNull("nutrition-carbs"),
      fat:numberOrNull("nutrition-fat"),
      notes:$("nutrition-notes").value.trim() || null
    })
  });
  event.target.reset();
  $("nutrition-date").value = $("nutrition-date").value || todayIso();
  $("nutrition-add-panel").hidden = true;
  await loadNutrition();
};

$("workout-form").onsubmit = async (event) => {
  event.preventDefault();
  const title = $("workout-title").value.trim();
  if (!title) return;
  const exercises = $("workout-exercises").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  await api("/api/workouts", {
    method:"POST",
    body:JSON.stringify({
      date:$("workout-date").value || todayIso(),
      title,
      durationMinutes:numberOrNull("workout-duration"),
      exercises,
      notes:$("workout-notes").value.trim() || null
    })
  });
  event.target.reset();
  $("workout-date").value = $("workout-date").value || todayIso();
  await loadWorkouts();
};

$("close-inspector").onclick = () => {
  state.selectedSkillId = "";
  $("inspector").classList.add("closed");
  if (state.viewMode === "map") renderMap(filteredSkills());
};

const map = $("map");
map.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".skill-node")) return;
  state.drag = { x: event.clientX, y: event.clientY, vx: state.viewport.x, vy: state.viewport.y, id: event.pointerId };
  map.setPointerCapture(event.pointerId);
});
map.addEventListener("pointermove", (event) => {
  if (!state.drag || state.drag.id !== event.pointerId) return;
  state.viewport.x = state.drag.vx + event.clientX - state.drag.x;
  state.viewport.y = state.drag.vy + event.clientY - state.drag.y;
  applyTransform();
});
map.addEventListener("pointerup", (event) => {
  if (state.drag?.id === event.pointerId) state.drag = null;
  if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
});
map.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = map.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const py = event.clientY - rect.top;
  const oldZ = state.viewport.z;
  const nextZ = clamp(oldZ * Math.exp(-event.deltaY * .0013), .3, 2);
  const wx = (px - state.viewport.x) / oldZ;
  const wy = (py - state.viewport.y) / oldZ;
  state.viewport.z = nextZ;
  state.viewport.x = px - wx * nextZ;
  state.viewport.y = py - wy * nextZ;
  applyTransform();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  $("inspector").classList.add("closed");
  $("history-panel").classList.add("closed");
  $("review-panel").classList.add("closed");
  $("homework-panel").classList.add("closed");
  $("study-calendar-panel").classList.add("closed");
});

window.addEventListener("study-reviews-updated", () => {
  if (!state.data) return;
  state.quizTodayBySkill = todayQuizResults();
  applyFlashcardQuizMastery();
  renderMeta();
  renderExamCards();
  renderHistory();
  const skills = filteredSkills();
  if (state.viewMode === "map") renderMap(skills);
  else renderList(skills);
  if (state.selectedSkillId && !$("inspector").classList.contains("closed")) {
    const skill = examSkills(currentExam()).find(item => item.id === state.selectedSkillId);
    if (skill) showInspector(skill);
  }
});

window.addEventListener("resize", applyTransform);


async function handleOAuthApproval(){
 const match=window.location.hash.match(/^#oauth-approve=([a-f0-9]{64})$/);
 if(!match)return;
 history.replaceState(null,"",location.pathname+location.search);
 const requestId=match[1];
 if(!confirm("Разрешить ChatGPT читать историю твоих учебных карточек? Доступ только для чтения."))return;
 const token=localStorage.getItem("personal-study-map:owner-token:v1");
 if(!/^[a-f0-9]{64}$/.test(token||"")){alert("Сначала открой раздел карточек и дождись синхронизации, затем повтори подключение.");return;}
 try{
  const response=await fetch("https://my-skills-mcp-production.up.railway.app/oauth/approve",{
   method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
   body:JSON.stringify({id:requestId})
  });
  const result=await response.json();
  if(!response.ok||!result.redirect)throw Error(result.error||"Access failed");
  location.assign(result.redirect);
 }catch(e){alert("Не удалось подтвердить доступ: "+e.message);}
}
window.addEventListener("hashchange",()=>void handleOAuthApproval());
void handleOAuthApproval();

loadData().then(() => setTimeout(fitMap, 0)).catch((error) => {
  console.error(error);
  $("empty-state").hidden = false;
  $("empty-state").innerHTML = "<strong>Не удалось открыть карту</strong><p>Проверь файл data/study.json.</p>";
});


// German vocabulary UI; saved on the same PostgreSQL API as the other personal sections.
async function loadGermanWords() {
  try {
    state.germanWords = await api("/api/german-words");
    $("german-status").textContent = "";
    renderGermanWords();
  } catch (err) { $("german-status").textContent = "Не удалось загрузить словарь. Попробуй обновить страницу."; }
}
function renderGermanWords() {
  const query = $("german-search").value.trim().toLocaleLowerCase();
  const items = state.germanWords.filter(w => (w.word+" "+w.translation).toLocaleLowerCase().includes(query));
  $("german-count").textContent = state.germanWords.length+" слов";
  const host = $("german-list"); host.replaceChildren();
  if (!items.length) {host.textContent = "Слов пока нет. Добавь первое слово."; return;}
  for (const word of items) {
    const card=document.createElement("article");card.className="german-card";
    const heading=document.createElement("strong");heading.textContent=word.word;card.append(heading);
    const translation=document.createElement("input");translation.value=word.translation||"";translation.placeholder="Добавить перевод";translation.setAttribute("aria-label","Перевод "+word.word);card.append(translation);
    const context=document.createElement("small");context.textContent=word.context||"";card.append(context);
    const buttons=document.createElement("div");buttons.className="german-card-actions";
    const save=document.createElement("button");save.type="button";save.textContent="Сохранить перевод";
    save.onclick=async()=>{await api("/api/german-words/"+encodeURIComponent(word.id),{method:"PATCH",body:JSON.stringify({translation:translation.value})});word.translation=translation.value;$("german-status").textContent="Перевод сохранён";};
    const known=document.createElement("button");known.type="button";known.textContent="Знаю ✓";
    known.onclick=async()=>{const rep=(word.repetition||0)+1;const due=new Date(Date.now()+[1,2,4,7,14,30][Math.min(rep-1,5)]*86400000).toISOString().slice(0,10);await api("/api/german-words/"+encodeURIComponent(word.id),{method:"PATCH",body:JSON.stringify({repetition:rep,dueDate:due})});await loadGermanWords();};
    const del=document.createElement("button");del.type="button";del.textContent="Удалить";
    del.onclick=async()=>{if(!confirm("Удалить слово «"+word.word+"»?"))return;await api("/api/german-words/"+encodeURIComponent(word.id),{method:"DELETE"});await loadGermanWords();};
    buttons.append(save,known,del);card.append(buttons);host.append(card);
  }
}
$("german-form").onsubmit=async e=>{e.preventDefault();try{await api("/api/german-words",{method:"POST",body:JSON.stringify({word:$("german-word").value,translation:$("german-translation").value})});e.target.reset();await loadGermanWords();}catch{$("german-status").textContent="Не удалось сохранить слово.";}};
$("german-search").oninput=renderGermanWords;
$("german-review").onclick=()=>{const today=todayIso();const due=state.germanWords.filter(w=>!w.dueDate||w.dueDate<=today);if(!due.length){alert("Все слова повторены на сегодня");return;}const w=due[Math.floor(Math.random()*due.length)];const answer=prompt("Переведи: "+w.word+"\n\n"+(w.context||""));if(answer===null)return;alert("Перевод: "+(w.translation||"ещё не указан")+"\nТвой ответ: "+answer+"\nНажми «Знаю ✓» на карточке, если вспомнил правильно.");};

$("slides-toggle")?.addEventListener("click", () => {
  const catalog = $("slides-catalog");
  catalog.hidden = !catalog.hidden;
  $("slides-toggle").setAttribute("aria-expanded", String(!catalog.hidden));
  if (!catalog.hidden) renderSlidesCatalog();
});
