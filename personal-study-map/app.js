const API_BASE = "https://personal-life-api-production.up.railway.app";

const state = {
  data: null,
  section: "study",
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
  viewMode: "map",
  selectedSkillId: "",
  viewport: { x: 80, y: 70, z: 1 },
  drag: null,
  lectureTasks: [],
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
  return Array.isArray(days) && days.length ? days.map(Number) : [2, 3];
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


function renderSection() {
  const study = state.section === "study";
  document.body.dataset.section = state.section;

  $("map").hidden = !study || state.viewMode !== "map";
  $("list").hidden = !study || state.viewMode !== "list";
  $("nutrition-view").hidden = state.section !== "nutrition";
  $("workouts-view").hidden = state.section !== "workouts";

  for (const id of ["left-panel-toggle", "left-panel"]) {
    $(id).hidden = !study;
  }
  for (const selector of [".floating-toolbar", ".top-search", ".top-status"]) {
    const element = document.querySelector(selector);
    if (element) element.hidden = !study;
  }

  if (!study) {
    for (const id of ["inspector", "review-panel", "history-panel", "study-calendar-panel", "homework-panel"]) {
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

  host.innerHTML = `
    <div class="calendar-head">
      <button type="button" class="calendar-nav prev" aria-label="Предыдущий месяц">‹</button>
      <div>
        <div class="calendar-title">${escapeHtml(monthTitle(month))}</div>
        <div class="calendar-subtitle">${
          section === "workouts" ? "Зелёный - была тренировка" :
          section === "study" ? "Зелёный - была учебная активность" :
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
  `;

  const grid = host.querySelector(".calendar-grid");
  for (let i = 0; i < mondayOffset; i++) {
    const blank = document.createElement("span");
    blank.className = "calendar-day empty";
    grid.append(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateIso = isoDateFromParts(year, monthIndex, day);
    const status = calendarStatus(section, dateIso);
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
    } else {
      button.textContent = String(day);
      button.title = dateIso;
    }
    if (section === "workouts") {
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
        <div class="life-card-title">${escapeHtml(item.title)}</div>
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
  const firstSemester = state.data.semesters?.[0];
  state.semesterId = firstSemester?.id || "";
  state.examId = firstSemester?.exams?.[0]?.id || "";
  renderAll();
}

function renderAll() {
  renderSection();
  renderMeta();
  renderSemesterSelect();
  renderExamCards();
  renderExamSelect();
  renderTopics();
  renderWorkspace();
  renderHistory();
  renderReview();
  renderHomework();
  renderAllCalendars();
}

function renderMeta() {
  $("updated-at").textContent = state.data?.updatedAt
    ? "Обновлено " + fmtDate(state.data.updatedAt)
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
    renderWorkspace();
    renderExamCards();
    renderReview();
    fitMap();
  };
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
    if (!query) return true;
    const haystack = [skill.title, skill.subtitle, skill.description].filter(Boolean).join(" ").toLowerCase();
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
    const x1 = Number(from.x || 0) + 220;
    const y1 = Number(from.y || 0) + 58;
    const x2 = Number(to.x || 0);
    const y2 = Number(to.y || 0) + 58;
    const mid = Math.max(50, Math.abs(x2 - x1) * 0.45);
    line.setAttribute("d", `M ${x1 + 5000} ${y1 + 5000} C ${x1 + mid + 5000} ${y1 + 5000}, ${x2 - mid + 5000} ${y2 + 5000}, ${x2 + 5000} ${y2 + 5000}`);
    line.setAttribute("class", "edge");
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
      <div class="skill-subtitle">${escapeHtml(skill.subtitle || "")}</div>
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

function renderReview() {
  const exam = currentExam();
  const count = $("review-count");
  const summary = $("review-summary");
  const list = $("review-list");
  const upcomingHost = $("review-upcoming");
  if (!count || !summary || !list || !upcomingHost) return;

  const { due, upcoming } = reviewQueues(exam);
  count.textContent = String(due.length);
  count.classList.toggle("zero", due.length === 0);

  const intervals = state.data?.reviewSchedule?.intervalDays || [1, 2, 4, 7, 14, 30];
  summary.innerHTML = due.length
    ? `<strong>${due.length}</strong><span>навыков нужно повторить сегодня · интервалы ${intervals.join(" → ")} дней</span>`
    : `<strong>0</strong><span>сегодня обязательных повторений нет · интервалы ${intervals.join(" → ")} дней</span>`;

  list.replaceChildren();
  upcomingHost.replaceChildren();

  const dueTitle = document.createElement("div");
  dueTitle.className = "review-section-title";
  dueTitle.textContent = "СЕГОДНЯ";
  list.append(dueTitle);

  if (!due.length) {
    const empty = document.createElement("div");
    empty.className = "review-empty";
    const hasStudied = examSkills(exam).some((skill) => Number(skill.mastery || 0) > 0);
    empty.textContent = hasStudied
      ? "На сегодня всё закреплено. Следующее повторение ниже."
      : "Пока нечего повторять. После первого занятия я поставлю изученные навыки в интервальное повторение.";
    list.append(empty);
  } else {
    for (const skill of due) list.append(reviewCard(skill, true));
  }

  if (upcoming.length) {
    const title = document.createElement("div");
    title.className = "review-section-title";
    title.textContent = "ДАЛЬШЕ";
    upcomingHost.append(title);
    for (const skill of upcoming.slice(0, 8)) upcomingHost.append(reviewCard(skill, false));
  }
}

function reviewCard(skill, due) {
  const review = skillReview(skill);
  const card = document.createElement("div");
  card.className = "review-card";
  const overdue = review.dueDate && review.dueDate < todayIso();
  card.innerHTML = `
    <div class="review-card-top">
      <div class="review-card-title">${escapeHtml(skill.title)}</div>
      <div class="review-card-date">${due ? (overdue ? "просрочено" : "сегодня") : fmtDate(review.dueDate)}</div>
    </div>
    <div class="review-card-meta">
      <span class="review-chip ${overdue ? "urgent" : due ? "due" : ""}">${Number(skill.mastery || 0)}% знания</span>
      <span class="review-chip">этап ${Number(review.repetition || 0)}/6</span>
    </div>
  `;
  card.onclick = () => {
    state.selectedSkillId = skill.id;
    $("review-panel").classList.add("closed");
    showInspector(skill);
    if (state.viewMode === "map") renderMap(filteredSkills());
  };
  return card;
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
       <span>Расписание: вторник и среда</span>`
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
      task.done = event.target.checked;
      task.completedAt = task.done ? new Date().toISOString() : null;
      try {
        const saved = await api("/api/tasks/" + encodeURIComponent(task.id), {
          method:"PATCH",
          body:JSON.stringify({done:task.done})
        });
        Object.assign(task, saved);
        localStorage.removeItem(LECTURE_TASKS_KEY);
      } catch {
        saveLectureTasks();
      }
      renderHomework();
      renderCalendar("study");
    };
    row.querySelector(".homework-delete").onclick = async () => {
      try {
        await api("/api/tasks/" + encodeURIComponent(task.id), {method:"DELETE"});
        localStorage.removeItem(LECTURE_TASKS_KEY);
      } catch {}
      state.lectureTasks = state.lectureTasks.filter((item) => item.id !== task.id);
      saveLectureTasks();
      renderHomework();
    };
    host.append(row);
  }
}

async function addHomeworkTask(title, targetDay) {
  const clean = String(title || "").trim();
  if (!clean) return;
  const preferred = targetDay === "auto" ? null : Number(targetDay);
  const draft = {
    id: "lecture-task-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    title: clean,
    semesterId: state.semesterId,
    examId: state.examId,
    targetDay: preferred,
    dueDate: nextLectureDate(preferred),
    createdAt: new Date().toISOString(),
    done: false,
    completedAt: null
  };
  try {
    const saved = await api("/api/tasks", {method:"POST", body:JSON.stringify(draft)});
    state.lectureTasks.push(saved);
    localStorage.removeItem(LECTURE_TASKS_KEY);
  } catch {
    state.lectureTasks.push(draft);
    saveLectureTasks();
  }
  renderHomework();
}


function renderHistory() {
  const host = $("session-history");
  host.replaceChildren();
  const sessions = (state.data?.sessions || [])
    .filter((s) => !state.semesterId || s.semesterId === state.semesterId)
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
$("review-toggle").onclick = () => {
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
$("close-review").onclick = () => reviewPanel.classList.add("closed");

const historyPanel = $("history-panel");
$("history-toggle").onclick = () => {
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

$("homework-form").onsubmit = async (event) => {
  event.preventDefault();
  const input = $("homework-input");
  const day = $("homework-day");
  await addHomeworkTask(input.value, day.value);
  input.value = "";
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

window.addEventListener("resize", applyTransform);

loadData().then(() => setTimeout(fitMap, 0)).catch((error) => {
  console.error(error);
  $("empty-state").hidden = false;
  $("empty-state").innerHTML = "<strong>Не удалось открыть карту</strong><p>Проверь файл data/study.json.</p>";
});
