const state = {
  data: null,
  semesterId: "",
  examId: "",
  topicId: "all",
  viewMode: "map",
  selectedSkillId: "",
  viewport: { x: 80, y: 70, z: 1 },
  drag: null,
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
  const firstSemester = state.data.semesters?.[0];
  state.semesterId = firstSemester?.id || "";
  state.examId = firstSemester?.exams?.[0]?.id || "";
  renderAll();
}

function renderAll() {
  renderMeta();
  renderSemesterSelect();
  renderExamCards();
  renderExamSelect();
  renderTopics();
  renderWorkspace();
  renderHistory();
  renderReview();
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
    node.className = "skill-node" + (state.selectedSkillId === skill.id ? " selected" : "");
    node.style.left = Number(skill.x || 0) + "px";
    node.style.top = Number(skill.y || 0) + "px";
    const topic = currentExam()?.topics?.find((t) => t.id === skill.topicId);
    const klass = readinessClass(Number(skill.mastery || 0));
    const dueBadge = isSkillDue(skill) ? '<span class="review-due-badge">повторить</span>' : '';
    node.innerHTML = `
      <div class="skill-card-head">
        <div class="skill-topic">${escapeHtml(topic?.title || "Навык")}</div>
        ${dueBadge}
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
      row.className = "list-row";
      row.innerHTML = `
        <div>
          <div class="list-row-title">${escapeHtml(skill.title)}</div>
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
  }
};
$("close-history").onclick = () => historyPanel.classList.add("closed");

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
});

window.addEventListener("resize", applyTransform);

loadData().then(() => setTimeout(fitMap, 0)).catch((error) => {
  console.error(error);
  $("empty-state").hidden = false;
  $("empty-state").innerHTML = "<strong>Не удалось открыть карту</strong><p>Проверь файл data/study.json.</p>";
});
