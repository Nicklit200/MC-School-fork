
const $card = (id) => document.getElementById(id);
const CARD_STORAGE_KEY = "personal-study-map:custom-flashcards:v1";
const cardState = {
  cards: [], index: 0, flipped: false, mode: "all",
  scope: "", editingId: null, busy: false, lastMessage: ""
};

function savedCards() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CARD_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function cardContext() {
  return window.studyBoardCards?.context() || {exam:null,topicId:"all",semesterId:""};
}

function cardScopeKey() {
  const context = cardContext();
  return [context.semesterId,context.exam?.id,context.topicId,cardState.mode].join(":");
}

function getAvailableCards() {
  const context = cardContext();
  const skills = (context.exam?.skills || []).filter((skill) =>
    context.topicId === "all" || skill.topicId === context.topicId
  );
  const custom = savedCards();
  const result = [];
  for (const skill of skills) {
    for (const source of skill.flashcards || []) {
      result.push({id:source.id,skill,question:source.question,answer:source.answer,custom:false});
    }
    for (const item of custom.filter((card) => card.skillId === skill.id)) {
      result.push({id:item.id,skill,question:item.question,answer:item.answer,custom:true});
    }
  }
  if (cardState.mode === "due") {
    const today = new Date();
    const local = today.getFullYear() + "-" +
      String(today.getMonth() + 1).padStart(2,"0") + "-" +
      String(today.getDate()).padStart(2,"0");
    return result.filter((card) => {
      const due = card.skill.review?.dueDate;
      return due && due <= local;
    });
  }
  return result;
}

function updateCardBadge() {
  const count = $card("flashcard-count");
  if (!count) return;
  const total = (cardContext().exam?.skills || [])
    .reduce((sum, skill) => sum + (skill.flashcards || []).length, 0);
  const custom = savedCards().filter((card) =>
    (cardContext().exam?.skills || []).some((skill) => skill.id === card.skillId)
  ).length;
  count.textContent = String(total + custom);
  count.classList.toggle("zero", !(total + custom));
}

function resetCardDeck() {
  cardState.scope = cardScopeKey();
  cardState.cards = getAvailableCards();
  cardState.index = 0;
  cardState.flipped = false;
  cardState.busy = false;
  renderStudyCard();
}

function showCardEditor(show, card = null) {
  const form = $card("flashcard-editor");
  form.hidden = !show;
  if (!show) {
    cardState.editingId = null;
    form.reset();
    return;
  }
  const select = $card("flashcard-skill");
  select.replaceChildren();
  const context = cardContext();
  for (const skill of context.exam?.skills || []) {
    if (context.topicId !== "all" && skill.topicId !== context.topicId) continue;
    select.add(new Option(skill.title, skill.id));
  }
  cardState.editingId = card?.custom ? card.id : null;
  $card("flashcard-new-question").value = card?.question || "";
  $card("flashcard-new-answer").value = card?.answer || "";
  if (card?.skill) select.value = card.skill.id;
  if (!select.options.length) {
    form.hidden = true;
    $card("flashcard-message").textContent = "Сначала выбери предмет и навык.";
    return;
  }
  $card("flashcard-new-question").focus();
}

function renderStudyCard() {
  updateCardBadge();
  const context = cardContext();
  const item = cardState.cards[cardState.index];
  const finished = cardState.index >= cardState.cards.length;
  $card("flashcard-progress").textContent = context.exam
    ? (finished ? "Карточки закончились" : "Карточка " + (cardState.index + 1) + " из " + cardState.cards.length)
    : "Сначала выбери экзамен";
  const topic = context.exam?.topics?.find((t) => t.id === item?.skill.topicId);
  $card("flashcard-topic").textContent = item ? (topic?.title || context.exam?.title || "") : "";
  $card("flashcard-question").textContent = item?.question ||
    (finished && cardState.cards.length ? "Готово! Сегодня ты просмотрел все карточки из этой подборки." :
      "В этом разделе пока нет карточек. Выбери «Все карточки» или создай новую.");
  $card("flashcard-answer").textContent = item?.answer || "";
  $card("flashcard-answer").hidden = !cardState.flipped || !item;
  $card("flashcard-reveal").hidden = !item || cardState.flipped;
  $card("flashcard-reveal").disabled = cardState.busy;
  $card("flashcard-ratings").hidden = !item || !cardState.flipped;
  for (const button of $card("flashcard-ratings").querySelectorAll("button")) {
    button.disabled = cardState.busy;
  }
  $card("flashcard-edit-current").hidden = !item?.custom;
  $card("flashcard-delete-current").hidden = !item?.custom;
  $card("flashcard-message").textContent = cardState.lastMessage;
  $card("flashcard-all").classList.toggle("active", cardState.mode === "all");
  $card("flashcard-due").classList.toggle("active", cardState.mode === "due");
}

$card("flashcard-toggle").onclick = () => {
  const panel = $card("flashcard-panel");
  if (!panel.classList.contains("closed")) {
    panel.classList.add("closed");
    return;
  }
  for (const id of ["inspector","history-panel","review-panel","study-calendar-panel","homework-panel"]) {
    $card(id)?.classList.add("closed");
  }
  panel.classList.remove("closed");
  cardState.mode = "all";
  cardState.lastMessage = "";
  showCardEditor(false);
  resetCardDeck();
};

$card("close-flashcards").onclick = () => $card("flashcard-panel").classList.add("closed");

$card("flashcard-all").onclick = () => {
  cardState.mode = "all"; cardState.lastMessage = ""; resetCardDeck();
};
$card("flashcard-due").onclick = () => {
  cardState.mode = "due"; cardState.lastMessage = ""; resetCardDeck();
};
$card("flashcard-restart").onclick = () => {
  cardState.lastMessage = ""; resetCardDeck();
};
$card("flashcard-reveal").onclick = () => {
  if (cardState.cards[cardState.index]) {
    cardState.flipped = true;
    renderStudyCard();
  }
};
for (const button of $card("flashcard-ratings").querySelectorAll("button")) {
  button.onclick = async () => {
    const item = cardState.cards[cardState.index];
    if (!item || !cardState.flipped || cardState.busy) return;
    cardState.busy = true;
    renderStudyCard();
    const result = await window.studyBoardCards.rate(item.skill, button.dataset.rating);
    cardState.busy = false;
    cardState.index += 1;
    cardState.flipped = false;
    cardState.lastMessage = result.storedRemotely
      ? "Результат самооценки сохранён · следующее повторение " + result.dueDate
      : "Сайт не смог синхронизировать прогресс: запись сохранена в этом браузере.";
    renderStudyCard();
  };
}

$card("flashcard-create-toggle").onclick = () =>
  showCardEditor($card("flashcard-editor").hidden);
$card("flashcard-cancel").onclick = () => showCardEditor(false);

$card("flashcard-editor").onsubmit = (event) => {
  event.preventDefault();
  const skillId = $card("flashcard-skill").value;
  const question = $card("flashcard-new-question").value.trim();
  const answer = $card("flashcard-new-answer").value.trim();
  if (!skillId || !question || !answer) return;
  const cards = savedCards();
  if (cardState.editingId) {
    const card = cards.find((x) => x.id === cardState.editingId);
    if (card) Object.assign(card,{skillId,question,answer});
  } else {
    cards.push({id:"user-card-"+crypto.randomUUID(),skillId,question,answer});
  }
  localStorage.setItem(CARD_STORAGE_KEY,JSON.stringify(cards));
  showCardEditor(false);
  cardState.lastMessage = "Карточка сохранена в этом браузере (синхронизация между устройствами пока не включена).";
  resetCardDeck();
};

$card("flashcard-edit-current").onclick = () => {
  const card = cardState.cards[cardState.index];
  if (card?.custom) showCardEditor(true,card);
};
$card("flashcard-delete-current").onclick = () => {
  const card = cardState.cards[cardState.index];
  if (!card?.custom) return;
  localStorage.setItem(CARD_STORAGE_KEY,
    JSON.stringify(savedCards().filter((item) => item.id !== card.id)));
  cardState.lastMessage = "Карточка удалена с этого устройства.";
  resetCardDeck();
};

window.addEventListener("study-context-updated",() => {
  updateCardBadge();
  if (!$card("flashcard-panel").classList.contains("closed")
      && cardScopeKey() !== cardState.scope) {
    showCardEditor(false);
    resetCardDeck();
  }
});
updateCardBadge();
