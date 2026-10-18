/**
 * Personal Study Map quiz core.
 * Adapted from Mindcrafti School's DistractorGenerator, StudySessionItem,
 * StudyService and Sm2Scheduler (branch integration/railway-and-ux).
 * Same four-choice flow, first-attempt scoring and end-of-queue retries.
 * Day 1 is the initial study day. A first correct answer is reviewed
 * 2 days later, then after 3, 7, 14 and 30 days; mistakes return tomorrow.
 * Pure client-side engine; UI/persistence lives in flashcards.js.
 */
window.CardQuizEngine = (() => {
  // The initial study is day 1. The 1-day interval is reserved for mistakes.
  // Successful scheduled reviews progress through 2, 3, 7, 14 and 30 days.
  const INTERVAL_DAYS = Object.freeze([1, 2, 3, 7, 14, 30]);
  const FIRST_CORRECT_DELAY_DAYS = INTERVAL_DAYS[1];
  const SCHEDULE_VERSION = 2;

  function isoDay(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0");
  }

  function plusDays(day, amount) {
    const parts = day.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2], 12);
    date.setDate(date.getDate() + amount);
    return isoDay(date);
  }

  function clampStage(stage) {
    return Math.min(INTERVAL_DAYS.length, Math.max(0, Math.floor(Number(stage) || 0)));
  }

  function reviewDelayDays(stage) {
    // Stage 0 is a missed/unseen card; stage 1 is the first success.
    // Clamp the final stage at the 30-day maintenance interval.
    const index = Math.min(Math.max(1, clampStage(stage)), INTERVAL_DAYS.length - 1);
    return INTERVAL_DAYS[index];
  }

  function afterReview(previousState, firstTryCorrect, today = isoDay()) {
    if (!firstTryCorrect) {
      return { repetitionNumber: 0, dueDate: plusDays(today, INTERVAL_DAYS[0]),
        status: "RESET", scheduleVersion: SCHEDULE_VERSION };
    }
    const nextStage = Math.min(clampStage(previousState?.repetitionNumber) + 1, INTERVAL_DAYS.length);
    return { repetitionNumber: nextStage,
      dueDate: plusDays(today, reviewDelayDays(nextStage)),
      status: "ACTIVE", scheduleVersion: SCHEDULE_VERSION };
  }

  function shuffle(items, random = Math.random) {
    const list = [...items];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  function cleanAnswer(value) {
    return String(value ?? "").trim();
  }

  function buildOptions(card, sessionCards, random = Math.random) {
    const correct = cleanAnswer(card.answer ?? card.correctAnswer);
    if (!correct) return [];
    const explicit = [card.wrongAnswer1, card.wrongAnswer2, card.wrongAnswer3].map(cleanAnswer);
    const saved = explicit.every(Boolean) &&
      new Set([correct, ...explicit]).size === 4;
    if (saved) return shuffle([correct, ...explicit], random);

    const pool = [...new Set(sessionCards
      .filter(other => other.id !== card.id)
      .map(other => cleanAnswer(other.answer ?? other.correctAnswer))
      .filter(answer => answer && answer !== correct))];
    return shuffle([correct, ...shuffle(pool, random).slice(0, 3)], random);
  }

  function startSession(mode, cards, scope = {}, now = new Date()) {
    if (!["SCHEDULED", "PRACTICE"].includes(mode)) {
      throw new Error("Unknown session mode");
    }
    if (!cards.length || new Set(cards.map(card => card.id)).size !== cards.length) {
      throw new Error("A session needs unique cards");
    }
    const items = {};
    for (const card of cards) {
      items[card.id] = { cardId:card.id, state:"PENDING", hadWrongAttempt:false,
        firstSelectedAnswer:null, attempts:0 };
    }
    return {
      version:2, id:"quiz-"+Math.random().toString(36).slice(2),
      mode, scope:{...scope}, startedAt:now.toISOString(),
      cardIds:cards.map(card => card.id),
      queue:cards.map(card => card.id), items, currentQuestion:null
    };
  }

  function recordAnswer(session, card, rawSelectedAnswer, timedOut = false) {
    if (!session?.queue?.length || session.queue[0] !== card?.id) {
      throw new Error("Card is not the current pending question");
    }
    const item = session.items[card.id];
    if (!item || item.state !== "PENDING") throw new Error("This card was already answered");
    const selectedAnswer = timedOut ? "" : cleanAnswer(rawSelectedAnswer);
    const correctAnswer = cleanAnswer(card.answer ?? card.correctAnswer);
    const correct = !timedOut && selectedAnswer === correctAnswer;
    if (item.firstSelectedAnswer === null) item.firstSelectedAnswer = selectedAnswer;
    item.attempts += 1;
    session.queue.shift();
    if (correct) {
      item.state = "ANSWERED_CORRECT";
    } else {
      item.hadWrongAttempt = true;
      // Match the school: a wrong card goes to the end of the queue.
      session.queue.push(card.id);
    }
    session.currentQuestion = null;
    return {
      correct, timedOut, selectedAnswer, correctAnswer,
      sessionCompleted:session.queue.length === 0,
      remaining:session.queue.length
    };
  }

  function finishSession(session, cards, states, today = isoDay()) {
    if (session.queue.length) throw new Error("Cannot finish with pending cards");
    const byId = new Map(cards.map(card => [card.id, card]));
    const updatedStates = {...states};
    const review = [];
    let firstTry = 0;
    for (const id of session.cardIds) {
      const item = session.items[id];
      const card = byId.get(id);
      if (!card || !item || item.state !== "ANSWERED_CORRECT") {
        throw new Error("Missing completed card: " + id);
      }
      const correct = !item.hadWrongAttempt;
      if (correct) firstTry += 1;
      review.push({
        cardId:id, skillId:card.skillId, question:card.question,
        selectedAnswer:item.firstSelectedAnswer, correctAnswer:card.answer ?? card.correctAnswer,
        correct, attempts:item.attempts
      });
      if (session.mode === "SCHEDULED") {
        updatedStates[id] = {...afterReview(updatedStates[id], correct, today), updatedAt:new Date().toISOString()};
      }
    }
    const next = session.mode === "SCHEDULED" ?
      review.map(item => updatedStates[item.cardId].dueDate).sort()[0] : null;
    return {
      states:updatedStates,
      result:{
        id:session.id, type:session.mode, date:today, completedAt:new Date().toISOString(),
        startedAt:session.startedAt, examId:session.scope?.examId || null,
        topicId:session.scope?.topicId || "all", totalCards:session.cardIds.length,
        correctFirstTry:firstTry, nextReviewDate:next, review
      }
    };
  }

  function parseImport(rawText) {
    const cards = [], warnings = [];
    const lines = String(rawText || "").split(/\r?\n/);
    lines.forEach((line, index) => {
      const entry = line.trim();
      if (!entry) return;
      const sep = entry.indexOf("->");
      if (sep < 0) {
        warnings.push("Строка " + (index + 1) + ": отсутствует ->");
        return;
      }
      const question = entry.slice(0, sep).trim();
      const parts = entry.slice(sep + 2).split("|").map(part => part.trim());
      if (!question || question.length > 1000 || (parts.length !== 4 && parts.length !== 5)) {
        warnings.push("Строка " + (index + 1) + ": нужен вопрос и 4 ответа");
        return;
      }
      const answers = parts.slice(0, 4);
      if (answers.some(answer => !answer || answer.length > 500) || new Set(answers).size !== 4) {
        warnings.push("Строка " + (index + 1) + ": ответы должны быть непустыми и разными");
        return;
      }
      let timeLimitSeconds = null;
      if (parts.length === 5) {
        if (!/^\d{1,4}t$/i.test(parts[4])) {
          warnings.push("Строка " + (index + 1) + ": время укажи как 15t");
          return;
        }
        timeLimitSeconds = Number(parts[4].slice(0, -1));
        if (timeLimitSeconds < 1 || timeLimitSeconds > 3600) {
          warnings.push("Строка " + (index + 1) + ": таймер от 1 до 3600 секунд");
          return;
        }
      }
      cards.push({
        question, answer:answers[0],wrongAnswer1:answers[1],
        wrongAnswer2:answers[2],wrongAnswer3:answers[3],timeLimitSeconds
      });
    });
    return {cards,warnings};
  }

  return {INTERVAL_DAYS,FIRST_CORRECT_DELAY_DAYS,SCHEDULE_VERSION,reviewDelayDays,isoDay,plusDays,afterReview,buildOptions,
    startSession,recordAnswer,finishSession,parseImport,clampStage};
})();
