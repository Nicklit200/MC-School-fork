/* Personal Study Map — interactive four-choice study sessions.
 * Session rules ported from Mindcrafti School (StudyService/Sm2Scheduler).
 * Local storage is used intentionally: the current personal API has no
 * authentication and must not receive card content or session history.
 */
(() => {
  "use strict";
  const engine = window.CardQuizEngine;
  const panel = document.getElementById("flashcard-panel");
  const host = document.getElementById("flashcard-app");
  if (!engine || !panel || !host) return;

  const KEY_CUSTOM = "personal-study-map:custom-flashcards:v2";
  const KEY_OLD_CUSTOM = "personal-study-map:custom-flashcards:v1";
  const KEY_OVERRIDES = "personal-study-map:card-overrides:v1";
  const KEY_PROGRESS = "personal-study-map:quiz-card-progress:v1";
  const KEY_SESSION = "personal-study-map:quiz-active-session:v1";
  const KEY_HISTORY = "personal-study-map:quiz-session-history:v1";
  const MAX_HISTORY = 100;

  const ui = {
    view:"home", session:null, feedback:null, result:null, importPreview:null,
    importText:"", importSkill:"", editing:null, notice:"",
    timer:null, advanceTimer:null, managerFilter:"all"
  };

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[char]));

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getContext() {
    return window.studyBoardCards?.context() || {exam:null,semesterId:"",topicId:"all"};
  }

  function getCustomCards() {
    const stored = readJson(KEY_CUSTOM, null);
    const cards = Array.isArray(stored) ? stored : readJson(KEY_OLD_CUSTOM, []);
    return (Array.isArray(cards) ? cards : []).map(card => ({
      ...card, answer:card.answer ?? card.correctAnswer ?? "",
      skillId:String(card.skillId || "")
    }));
  }

  function persistCustomCards(cards) {
    writeJson(KEY_CUSTOM, cards);
  }

  function getOverrides() {
    const saved = readJson(KEY_OVERRIDES, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  function getProgress() {
    const saved = readJson(KEY_PROGRESS, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  function cardState(card, states = getProgress()) {
    const saved = states[card.id];
    return {
      repetitionNumber:engine.clampStage(saved?.repetitionNumber),
      dueDate:saved?.dueDate || engine.isoDay()
    };
  }

  function allCards({includeHidden=false, disregardTopic=false}={}) {
    const context = getContext();
    const exam = context.exam;
    if (!exam) return [];
    const overrides = getOverrides();
    const out = [];
    const skills = (exam.skills || []).filter(skill =>
      disregardTopic || context.topicId === "all" || skill.topicId === context.topicId
    );
    const skillById = new Map(skills.map(skill => [skill.id, skill]));
    for (const skill of skills) {
      for (const original of skill.flashcards || []) {
        const ov = overrides[original.id] || {};
        const hidden = Boolean(ov.hidden);
        if (hidden && !includeHidden) continue;
        out.push({
          ...original,...ov,id:original.id,skillId:skill.id,
          answer:ov.answer ?? original.answer ?? original.correctAnswer,
          hidden,custom:false,skillTitle:skill.title
        });
      }
    }
    for (const own of getCustomCards()) {
      const skill = skillById.get(own.skillId);
      if (!skill) continue;
      const hidden = Boolean(own.hidden);
      if (hidden && !includeHidden) continue;
      out.push({
        ...own, custom:true, hidden, skillTitle:skill.title
      });
    }
    return out.filter(card => card.question && card.answer);
  }

  function visibleCards() {
    return allCards();
  }

  function dueCards() {
    const today = engine.isoDay();
    const states = getProgress();
    return visibleCards().filter(card => cardState(card,states).dueDate <= today);
  }

  function updateBadge() {
    const count = allCards({disregardTopic:true}).length;
    for (const id of ["flashcard-count","flashcard-top-count","flashcard-sidebar-count"]) {
      const counter = document.getElementById(id);
      if (!counter) continue;
      counter.textContent = String(count);
      counter.classList.toggle("zero", count === 0);
    }
  }

  function labelDate(date) {
    if (!date) return "—";
    const [year,month,day] = String(date).slice(0,10).split("-").map(Number);
    if (!year || !month || !day) return String(date);
    return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"})
      .format(new Date(year,month-1,day,12));
  }

  function countBox(label,value) {
    return '<div class="quiz-stat"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>';
  }

  function titleBar(title, subtitle="") {
    return '<div class="quiz-head"><div><div class="panel-label">SWEG · КАРТОЧКИ</div>'+
      '<h2>'+esc(title)+'</h2>'+ (subtitle?'<p>'+esc(subtitle)+'</p>':"") +
      '</div><button data-action="home" type="button">На главную</button></div>';
  }

  function sessionForCurrentContext() {
    const session = ui.session;
    if (!session) return false;
    const ctx = getContext();
    return session.scope?.examId === ctx.exam?.id && session.scope?.semesterId === ctx.semesterId;
  }

  function hideOtherPanels() {
    for (const id of ["inspector","review-panel","history-panel","study-calendar-panel","homework-panel"]) {
      document.getElementById(id)?.classList.add("closed");
    }
  }

  function stopTimer() {
    if (ui.timer !== null) clearInterval(ui.timer);
    ui.timer = null;
  }

  function stopAdvance() {
    if (ui.advanceTimer !== null) clearTimeout(ui.advanceTimer);
    ui.advanceTimer = null;
  }

  function cleanupTimers() { stopTimer();stopAdvance(); }

  function saveSession() {
    if (ui.session) writeJson(KEY_SESSION,ui.session);
  }

  function latestHistory() {
    const rows = readJson(KEY_HISTORY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function renderHome() {
    const context = getContext();
    const cards = visibleCards();
    const due = dueCards();
    const past = latestHistory().filter(item => item.examId === context.exam?.id);
    const lesson = past[0];
    const globalSession = ui.session;
    const unrelated = globalSession && !sessionForCurrentContext();
    host.innerHTML = titleBar("Тренировка и повторение",context.exam?.title || "Выбери экзамен")+
      '<div class="quiz-stat-grid">'+countBox("Всего в разделе",cards.length)+
      countBox("Нужно повторить",due.length)+countBox("Занятий",past.length)+'</div>'+
      (unrelated?'<div class="quiz-warning">Есть незавершённое занятие другого предмета. Продолжи его или отмени, прежде чем начинать новое.</div>':"")+
      '<div class="quiz-actions">'+
      (globalSession?'<button data-action="resume" type="button" class="primary">Продолжить занятие</button>'+
        '<button data-action="cancel-session" type="button" class="subtle">Отменить незавершённое</button>':
        '<button data-action="scheduled" class="primary" type="button" '+(!due.length?'disabled':'')+
        '>Повторить по расписанию ('+due.length+')</button>'+
        '<button data-action="practice" type="button" '+(!cards.length?'disabled':'')+'>Свободная тренировка</button>')+
      '</div>'+
      '<div class="quiz-actions secondary">'+
      '<button data-action="create" type="button">+ Создать карточку</button>'+
      '<button data-action="import" type="button">Импорт как в школе</button>'+
      '<button data-action="manage" type="button">Все карточки</button>'+
      '<button data-action="history" type="button">История занятий</button>'+
      '</div>'+
      '<div class="quiz-note">Один правильный вариант и до трёх неправильных. Ошибочная карточка возвращается в очередь, а результат засчитывается по первой попытке.</div>'+
      '<div class="quiz-schedule"><strong>Интервалы Mindcrafti School</strong><div>1 → 2 → 4 → 7 → 14 → 30 дней</div>'+
      '<small>Ошибка с первой попытки — сброс до этапа 0 и повтор завтра. Свободная тренировка не меняет расписание.</small></div>'+
      (lesson?'<div class="quiz-last"><strong>Последний результат</strong><span>'+labelDate(lesson.date)+
        ' · '+lesson.correctFirstTry+' из '+lesson.totalCards+' с первой попытки</span></div>':"")+
      (ui.notice?'<div class="quiz-notice" role="status">'+esc(ui.notice)+'</div>':"")+
      '<p class="quiz-storage-note">Созданные здесь карточки, интервалы и история сохраняются в этом браузере. Синхронизация между устройствами пока не подключена.</p>';
  }

  function startSession(mode) {
    const context = getContext();
    if (!context.exam || ui.session) return;
    const cards = mode==="SCHEDULED"?dueCards():visibleCards();
    if (!cards.length) {ui.notice="В выбранном разделе нет подходящих карточек.";renderHome();return;}
    const session = engine.startSession(mode,cards,{
      semesterId:context.semesterId,examId:context.exam.id,topicId:context.topicId
    });
    session.cards = cards.map(card => ({
      id:card.id,skillId:card.skillId,question:card.question,answer:card.answer,
      wrongAnswer1:card.wrongAnswer1||null,
      wrongAnswer2:card.wrongAnswer2||null,
      wrongAnswer3:card.wrongAnswer3||null,
      timeLimitSeconds:card.timeLimitSeconds == null ? null : Number(card.timeLimitSeconds),
      skillTitle:card.skillTitle||""
    }));
    ui.session=session;ui.view="study";ui.feedback=null;ui.notice="";
    saveSession();
    renderStudy();
  }

  function currentCard() {
    const session=ui.session;
    return session?.cards?.find(card => card.id === session.queue[0]) || null;
  }

  function ensureQuestion() {
    const session=ui.session;
    const card=currentCard();
    if (!card) return null;
    if (!session.currentQuestion || session.currentQuestion.cardId!==card.id) {
      const opts=engine.buildOptions(card,session.cards);
      const seconds = Number(card.timeLimitSeconds);
      const expiresAt=card.timeLimitSeconds != null && Number.isFinite(seconds) && seconds>0
        ? Date.now()+seconds*1000 : null;
      session.currentQuestion={cardId:card.id,options:opts,expiresAt};
      saveSession();
    }
    return session.currentQuestion;
  }

  function renderStudy() {
    stopTimer();
    const session=ui.session;
    if (!session) {ui.view="home";renderHome();return;}
    if (!session.queue.length) {finishSession();return;}
    const card=currentCard();
    const question=ensureQuestion();
    if (!card || !question) {
      ui.notice="Карточка не найдена. Отмени незавершённое занятие.";
      ui.view="home";renderHome();return;
    }
    const answered=Object.values(session.items).filter(x=>x.state==="ANSWERED_CORRECT").length;
    const total=session.cardIds.length;
    const feedback=ui.feedback;
    const controls=question.options.map((value,i)=>{
      const good=feedback && value===feedback.correctAnswer;
      const wrong=feedback && !feedback.correct && value===feedback.selectedAnswer;
      return '<button data-action="answer" data-index="'+i+'" type="button" '+
        (feedback?'disabled ':'')+'class="quiz-option'+(good?' correct':wrong?' wrong':'')+'">'+
        '<span class="quiz-option-letter">'+String.fromCharCode(65+i)+'</span><span>'+
        esc(value)+'</span></button>';
    }).join("");
    host.innerHTML = '<div class="quiz-session-head">'+
      '<div><span class="panel-label">'+(session.mode==="PRACTICE"?"СВОБОДНАЯ ТРЕНИРОВКА":"ПОВТОРЕНИЕ ПО РАСПИСАНИЮ")+
      '</span><h2>'+esc(card.skillTitle||"Карточка")+'</h2></div>'+
      '<button data-action="home" type="button">Пауза</button></div>'+
      '<div class="quiz-progress-row"><span>Завершено '+answered+' из '+total+'</span>'+
      (question.expiresAt!=null?'<strong id="quiz-timer" class="quiz-timer"></strong>':"")+
      '</div><div class="quiz-progress-track"><div style="width:'+
      Math.round((answered/total)*100)+'%"></div></div>'+
      '<div class="quiz-question">'+esc(card.question)+'</div>'+
      '<div class="quiz-options">'+controls+'</div>'+
      (!feedback?'<button data-action="skip" class="quiz-skip" type="button">'+
        '<span>Не знаю</span><small>Показать правильный ответ</small></button>':'')+
      (feedback?'<div class="quiz-feedback '+(feedback.correct?'ok':'fail')+'">'+
        (feedback.correct?'Правильно.':(feedback.skipped?'Не знаю.':feedback.timedOut?'Время вышло.':'Неправильно.'))+
        (feedback.correct?'':' Правильный ответ: '+esc(feedback.correctAnswer)+
        '. Карточка повторится в этом занятии.')+
        '</div><button class="quiz-next" data-action="next" type="button">Дальше</button>':
        '<div class="quiz-note">Выбери один ответ. Проверка происходит сразу после нажатия.</div>')+
      '<p class="quiz-storage-note">Ошибки с первой попытки учитываются отдельно от окончательного ответа.</p>';
    if (!feedback) {
      startCountdown();
    } else {
      stopAdvance();
      ui.advanceTimer=setTimeout(() => advance(),feedback.correct?1000:4000);
    }
  }

  function startCountdown() {
    const question=ui.session?.currentQuestion;
    if (!question?.expiresAt) return;
    const draw=()=>{
      const left=Math.max(0,Math.ceil((question.expiresAt-Date.now())/1000));
      const element=document.getElementById("quiz-timer");
      if (element) {
        element.textContent=left+" сек.";
        element.classList.toggle("low",left<=3);
      }
      if (left<=0) {
        stopTimer();
        if (ui.view==="study" && !ui.feedback) answerQuestion("",true);
      }
    };
    draw();
    if (!ui.feedback) ui.timer=setInterval(draw,250);
  }

  function answerQuestion(value,timedOut=false,skipped=false) {
    if (ui.view!=="study" || ui.feedback) return;
    const session=ui.session,card=currentCard();
    if (!session || !card) return;
    stopTimer();
    // Keep the exact choices shown before timeout; the engine clears currentQuestion on answer.
    if (timedOut) {
      ui.lastCard=card;
      ui.lastQuestionOptions=[...(session.currentQuestion?.options||[])];
    }
    const feedback=engine.recordAnswer(session,card,value,timedOut);
    feedback.skipped=skipped;
    ui.feedback=feedback;
    saveSession();
    renderStudyFeedback(card,feedback);
  }

  function renderStudyFeedback(card,feedback) {
    // We have already shifted the queue. Render the previous question's feedback
    // rather than prematurely showing the next card.
    stopTimer();stopAdvance();
    const questionOptions=ui.lastQuestionOptions || [];
    const last=ui.lastCard || card;
    const selected=feedback.selectedAnswer;
    const options=questionOptions.length?questionOptions:
      engine.buildOptions(card,ui.session?.cards||[]);
    const answered=Object.values(ui.session.items).filter(x=>x.state==="ANSWERED_CORRECT").length;
    const total=ui.session.cardIds.length;
    host.innerHTML='<div class="quiz-session-head"><div><span class="panel-label">'+
      (ui.session.mode==="PRACTICE"?"СВОБОДНАЯ ТРЕНИРОВКА":"ПОВТОРЕНИЕ ПО РАСПИСАНИЮ")+
      '</span><h2>'+esc(last.skillTitle||"Карточка")+'</h2></div>'+
      '<button data-action="home" type="button">Пауза</button></div>'+
      '<div class="quiz-progress-row"><span>Завершено '+answered+' из '+total+'</span></div>'+
      '<div class="quiz-progress-track"><div style="width:'+Math.round(answered/total*100)+'%"></div></div>'+
      '<div class="quiz-question">'+esc(last.question)+'</div><div class="quiz-options">'+
      options.map((option,i)=>'<button class="quiz-option'+
        (option===feedback.correctAnswer?' correct':!feedback.correct&&option===selected?' wrong':'')+
        '" disabled type="button"><span class="quiz-option-letter">'+String.fromCharCode(65+i)+
        '</span><span>'+esc(option)+'</span></button>').join("")+
      '</div><div class="quiz-feedback '+(feedback.correct?'ok':'fail')+'">'+
      (feedback.correct?'Правильно.':feedback.skipped?'Не знаю.':feedback.timedOut?'Время вышло.':'Неправильно.')+
      (!feedback.correct?' Правильный ответ: '+esc(feedback.correctAnswer)+
      '. Вопрос появится ещё раз в этом занятии.':"")+
      '</div><button class="quiz-next" data-action="next" type="button">Дальше</button>';
    ui.advanceTimer=setTimeout(()=>advance(),feedback.correct?1000:4000);
  }

  function advance() {
    stopAdvance();
    if (ui.view!=="study" || !ui.feedback) return;
    ui.feedback=null;ui.lastQuestionOptions=null;ui.lastCard=null;
    if (!ui.session?.queue.length) finishSession();
    else renderStudy();
  }

  function finishSession() {
    cleanupTimers();
    const session=ui.session;
    if (!session) return;
    const completed=engine.finishSession(session,session.cards,getProgress());
    if (session.mode==="SCHEDULED") writeJson(KEY_PROGRESS,completed.states);
    const history=latestHistory();
    history.unshift(completed.result);
    writeJson(KEY_HISTORY,history.slice(0,MAX_HISTORY));
    localStorage.removeItem(KEY_SESSION);
    ui.session=null;ui.feedback=null;ui.result=completed.result;ui.view="result";
    updateBadge();renderResult();
  }

  function renderResult() {
    const result=ui.result;
    if (!result) {ui.view="home";renderHome();return;}
    host.innerHTML=titleBar("Результат занятия",result.type==="PRACTICE"?
      "Свободная тренировка — интервалы не изменились":
      "Повторение по расписанию — этапы обновлены")+
      '<div class="quiz-stat-grid">'+countBox("С первой попытки",result.correctFirstTry)+
      countBox("Всего вопросов",result.totalCards)+
      countBox("Ошибок",result.totalCards-result.correctFirstTry)+'</div>'+
      '<div class="quiz-schedule"><strong>Следующее повторение</strong><div>'+
      (result.type==="PRACTICE"?"По старому расписанию":labelDate(result.nextReviewDate))+
      '</div></div><div class="quiz-result-items">'+
      result.review.map(item=>'<div class="quiz-result-row">'+
        '<div class="quiz-result-top"><strong>'+esc(item.question)+'</strong>'+
        '<span class="'+(item.correct?'right':'incorrect')+'">'+
        (item.correct?'Верно':'Ошибка')+'</span></div>'+
        '<div>Первый ответ: '+esc(item.selectedAnswer||"не ответил")+'</div>'+
        (!item.correct?'<div>Правильный: '+esc(item.correctAnswer)+'</div>':"")+
        '<small>Попыток: '+Number(item.attempts||1)+'</small></div>').join("")+
      '</div><div class="quiz-actions"><button data-action="home" class="primary" type="button">Готово</button>'+
      '<button data-action="practice" type="button">Потренироваться ещё</button></div>';
  }

  function renderHistory() {
    const ctx=getContext();
    const rows=latestHistory().filter(item=>item.examId===ctx.exam?.id);
    host.innerHTML=titleBar("История занятий")+
      (rows.length?'<div class="quiz-history">'+rows.map(item=>
        '<button class="quiz-history-item" data-action="history-item" data-id="'+esc(item.id)+'" type="button">'+
        '<strong>'+esc(labelDate(item.date))+' · '+esc(item.type==="PRACTICE"?"Тренировка":"Повторение")+'</strong>'+
        '<span>С первой попытки: '+item.correctFirstTry+'/'+item.totalCards+'</span></button>').join("")+'</div>':
        '<div class="quiz-empty">История пока пустая. После первой тренировки здесь появится результат.</div>');
  }

  function renderManage() {
    const cards=allCards({includeHidden:true});
    const states=getProgress();
    host.innerHTML=titleBar("Управление карточками")+
      '<div class="quiz-actions"><button data-action="create" class="primary" type="button">+ Новая</button>'+
      '<button data-action="import" type="button">Импортировать</button></div>'+
      '<div class="quiz-manage-list">'+
      (cards.length?cards.map(card=>{
        const progress=cardState(card,states);
        return '<div class="quiz-manage-row'+(card.hidden?' hidden-card':'')+'">'+
          '<strong>'+esc(card.question)+'</strong>'+
          '<span>'+esc(card.skillTitle)+'</span>'+
          '<small>Этап '+progress.repetitionNumber+'/6 · '+esc(labelDate(progress.dueDate))+
          (card.hidden?' · Скрыта':'')+'</small>'+
          '<div><button data-action="edit" data-id="'+esc(card.id)+'" type="button">Редактировать</button>'+
          '<button data-action="toggle-hidden" data-id="'+esc(card.id)+'" type="button">'+
          (card.hidden?'Восстановить':'Скрыть')+'</button>'+
          (card.custom?'<button data-action="delete" data-id="'+esc(card.id)+'" type="button">Удалить</button>':"")+
          '</div></div>';
      }).join(""):'<div class="quiz-empty">Карточек пока нет.</div>')+
      '</div><p class="quiz-storage-note">Изменения исходных карточек сохраняются только у тебя в этом браузере. Оригиналы на сервере не удаляются.</p>';
  }

  function selectSkillOptions(selected="") {
    const ctx=getContext();
    return (ctx.exam?.skills||[]).filter(skill=>
      ctx.topicId==="all" || skill.topicId===ctx.topicId || selected===skill.id
    ).map(skill=>'<option value="'+esc(skill.id)+'"'+(skill.id===selected?' selected':'')+'>'+
      esc(skill.title)+'</option>').join("");
  }

  function renderEditor() {
    const c=ui.editing;
    host.innerHTML=titleBar(c?"Редактирование карточки":"Новая карточка")+
      '<form id="quiz-card-form" class="quiz-form"><label><span>Навык</span><select name="skillId" required>'+
      selectSkillOptions(c?.skillId||"")+'</select></label>'+
      '<label><span>Вопрос</span><textarea name="question" maxlength="1000" rows="3" required>'+
      esc(c?.question||"")+'</textarea></label>'+
      '<label><span>Правильный ответ</span><textarea name="answer" maxlength="500" rows="3" required>'+
      esc(c?.answer||"")+'</textarea></label>'+
      '<div class="quiz-form-note">Три неправильных ответа можно заполнить вручную. Если оставить все три поля пустыми, варианты будут браться из других карточек текущего занятия, как в школе.</div>'+
      [1,2,3].map(i=>'<label><span>Неправильный ответ '+i+'</span>'+
        '<textarea name="wrongAnswer'+i+'" maxlength="500" rows="2">'+
        esc(c?.["wrongAnswer"+i]||"")+'</textarea></label>').join("")+
      '<label><span>Таймер, секунд (необязательно)</span><input name="timeLimitSeconds" type="number" min="1" max="3600" placeholder="Без лимита" value="'+
      esc(c?.timeLimitSeconds??"")+'"></label>'+
      '<div class="quiz-actions"><button type="submit" class="primary">Сохранить</button>'+
      '<button data-action="manage" type="button">Отмена</button></div></form>'+
      '<div id="quiz-form-error" class="quiz-form-error" role="alert"></div>';
  }

  function saveEditor(form) {
    const data=new FormData(form);
    const skillId=String(data.get("skillId")||"");
    const question=String(data.get("question")||"").trim();
    const answer=String(data.get("answer")||"").trim();
    const wrong=[1,2,3].map(i=>String(data.get("wrongAnswer"+i)||"").trim());
    const seconds=String(data.get("timeLimitSeconds")||"").trim();
    const err=document.getElementById("quiz-form-error");
    const validSkill=(getContext().exam?.skills||[]).some(x=>x.id===skillId);
    if (!validSkill || !question || !answer) {
      err.textContent="Выбери навык, вопрос и правильный ответ.";return;
    }
    if (wrong.some(Boolean) && !wrong.every(Boolean)) {
      err.textContent="Заполни либо все 3 неправильных ответа, либо ни одного.";return;
    }
    if (wrong.every(Boolean) && new Set([answer,...wrong]).size!==4) {
      err.textContent="Все 4 ответа должны отличаться.";return;
    }
    const limit=seconds===""?null:Number(seconds);
    if (limit!==null && (!Number.isInteger(limit)||limit<1||limit>3600)) {
      err.textContent="Таймер должен быть от 1 до 3600 секунд.";return;
    }
    const values={skillId,question,answer,wrongAnswer1:wrong[0]||null,
      wrongAnswer2:wrong[1]||null,wrongAnswer3:wrong[2]||null,timeLimitSeconds:limit};
    if (ui.editing?.custom) {
      const cards=getCustomCards();
      const index=cards.findIndex(card=>card.id===ui.editing.id);
      if(index<0){err.textContent="Карточка не найдена.";return;}
      cards[index]={...cards[index],...values};
      persistCustomCards(cards);
    } else if (ui.editing) {
      const overrides=getOverrides();
      overrides[ui.editing.id]={...(overrides[ui.editing.id]||{}),...values};
      writeJson(KEY_OVERRIDES,overrides);
    } else {
      const cards=getCustomCards();
      cards.push({id:"user-card-"+crypto.randomUUID(),...values});
      persistCustomCards(cards);
    }
    ui.editing=null;ui.notice="Карточка сохранена.";ui.view="manage";
    updateBadge();renderManage();
  }

  function renderImport() {
    const ctx=getContext();
    host.innerHTML=titleBar("Импорт карточек","Формат преподавателя Mindcrafti School")+
      '<div class="quiz-form-note"><code>Вопрос -&gt; правильный | неправильный 1 | неправильный 2 | неправильный 3 | 15t</code><br>'+
      'Каждая карточка — с новой строки. <strong>15t</strong> — необязательный таймер на 15 секунд.</div>'+
      '<label class="quiz-import-label"><span>Сохранить к навыку</span><select id="quiz-import-skill">'+
      selectSkillOptions(ui.importSkill)+'</select></label>'+
      '<label class="quiz-import-label"><span>Карточки</span>'+
      '<textarea id="quiz-import-text" rows="9" placeholder="2 + 2 -> 4 | 3 | 5 | 6 | 15t">'+esc(ui.importText)+'</textarea></label>'+
      '<div class="quiz-actions"><button data-action="preview-import" class="primary" type="button">Проверить формат</button>'+
      '<button data-action="home" type="button">Отмена</button></div>'+
      (ui.importPreview?'<div class="quiz-import-preview"><h3>Готово к импорту: '+
        ui.importPreview.cards.length+'</h3>'+
        ui.importPreview.cards.map(card=>'<div><strong>'+esc(card.question)+'</strong><span>'+
          esc(card.answer)+' · '+[card.wrongAnswer1,card.wrongAnswer2,card.wrongAnswer3].map(esc).join(" · ")+
          '</span></div>').join("")+
        (ui.importPreview.warnings.length?'<div class="quiz-warning">'+
          ui.importPreview.warnings.map(esc).join("; ")+'</div>':"")+
        (ui.importPreview.cards.length?'<button data-action="confirm-import" type="button" class="primary">Импортировать '+
          ui.importPreview.cards.length+' карточек</button>':"")+'</div>':"")+
      (!ctx.exam?'<div class="quiz-warning">Сначала выбери экзамен.</div>':"");
  }

  function render() {
    updateBadge();
    if (ui.view==="study") return renderStudy();
    if (ui.view==="result") return renderResult();
    if (ui.view==="history") return renderHistory();
    if (ui.view==="manage") return renderManage();
    if (ui.view==="editor") return renderEditor();
    if (ui.view==="import") return renderImport();
    renderHome();
  }

  function toggleHidden(id) {
    const card=allCards({includeHidden:true}).find(c=>c.id===id);
    if (!card) return;
    if (card.custom) {
      const custom=getCustomCards();
      const i=custom.findIndex(c=>c.id===id);
      if(i>=0){custom[i].hidden=!custom[i].hidden;persistCustomCards(custom);}
    } else {
      const ov=getOverrides();
      ov[id]={...(ov[id]||{}),hidden:!card.hidden};
      writeJson(KEY_OVERRIDES,ov);
    }
    renderManage();updateBadge();
  }

  function handleClick(event) {
    const button=event.target.closest("button[data-action]");
    if (!button || !host.contains(button) || button.disabled) return;
    const action=button.dataset.action;
    const id=button.dataset.id;
    if (action==="home") {
      cleanupTimers();ui.view="home";ui.feedback=null;ui.notice="";
      renderHome();
    } else if (action==="scheduled") startSession("SCHEDULED");
    else if (action==="practice") {
      if (ui.session) return;
      startSession("PRACTICE");
    } else if (action==="resume") {
      ui.view="study";ui.feedback=null;renderStudy();
    } else if (action==="cancel-session") {
      if (!window.confirm("Отменить незавершённое занятие? Прогресс этой сессии не будет засчитан.")) return;
      cleanupTimers();ui.session=null;ui.feedback=null;
      localStorage.removeItem(KEY_SESSION);
      ui.notice="Незавершённое занятие отменено.";renderHome();
    } else if (action==="answer") {
      const q=ui.session?.currentQuestion, index=Number(button.dataset.index);
      if (!q || !Number.isInteger(index)||index<0||index>=q.options.length) return;
      ui.lastCard=currentCard();ui.lastQuestionOptions=[...q.options];
      answerQuestion(q.options[index]);
    } else if (action==="skip") {
      const q=ui.session?.currentQuestion;
      if (!q || ui.feedback) return;
      ui.lastCard=currentCard();
      ui.lastQuestionOptions=[...q.options];
      // An explicit "Не знаю" is a wrong first attempt; the card returns later.
      answerQuestion("",false,true);
    } else if (action==="next") advance();
    else if (action==="manage") {cleanupTimers();ui.view="manage";ui.notice="";renderManage();}
    else if (action==="create") {ui.editing=null;ui.view="editor";renderEditor();}
    else if (action==="edit") {
      const card=allCards({includeHidden:true}).find(c=>c.id===id);
      if(card){ui.editing=card;ui.view="editor";renderEditor();}
    } else if (action==="toggle-hidden") toggleHidden(id);
    else if (action==="delete") {
      const c=allCards({includeHidden:true}).find(card=>card.id===id);
      if (!c?.custom) return;
      if (!window.confirm("Удалить эту созданную тобой карточку?")) return;
      persistCustomCards(getCustomCards().filter(card=>card.id!==id));
      renderManage();updateBadge();
    } else if (action==="import") {ui.view="import";ui.importPreview=null;renderImport();}
    else if (action==="preview-import") {
      ui.importText=document.getElementById("quiz-import-text")?.value||"";
      ui.importSkill=document.getElementById("quiz-import-skill")?.value||"";
      ui.importPreview=engine.parseImport(ui.importText);renderImport();
    } else if (action==="confirm-import") {
      const skillId=document.getElementById("quiz-import-skill")?.value||ui.importSkill;
      const existing=getCustomCards();
      const skillExists=(getContext().exam?.skills||[]).some(s=>s.id===skillId);
      if (!skillExists || !ui.importPreview?.cards.length) return;
      for (const values of ui.importPreview.cards) {
        existing.push({id:"user-card-"+crypto.randomUUID(),skillId,...values});
      }
      persistCustomCards(existing);
      ui.notice="Импортировано "+ui.importPreview.cards.length+" карточек.";
      ui.importPreview=null;ui.importText="";ui.importSkill="";ui.view="home";
      renderHome();updateBadge();
    } else if (action==="history") {ui.view="history";renderHistory();}
    else if (action==="history-item") {
      ui.result=latestHistory().find(x=>x.id===id);
      if(ui.result){ui.view="result";renderResult();}
    }
  }

  host.addEventListener("click",handleClick);
  host.addEventListener("submit",event=>{
    if(event.target?.id!=="quiz-card-form")return;
    event.preventDefault();saveEditor(event.target);
  });
  host.addEventListener("input",event=>{
    if(event.target?.id==="quiz-import-text"){ui.importText=event.target.value;ui.importPreview=null;}
    if(event.target?.id==="quiz-import-skill"){ui.importSkill=event.target.value;ui.importPreview=null;}
  });
  document.getElementById("flashcard-toggle").onclick=()=>{
    if(!panel.classList.contains("closed")) {
      cleanupTimers();panel.classList.add("closed");return;
    }
    hideOtherPanels();panel.classList.remove("closed");
    ui.session=readJson(KEY_SESSION,null);
    ui.view=ui.session?"study":"home";ui.feedback=null;ui.notice="";
    render();
  };
  document.getElementById("close-flashcards").onclick=()=>{
    cleanupTimers();panel.classList.add("closed");
  };
  window.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!panel.classList.contains("closed")){
      cleanupTimers();panel.classList.add("closed");
    }
  });
  window.addEventListener("study-context-updated",()=>{
    updateBadge();
    if(!panel.classList.contains("closed")&&!ui.session){
      ui.view="home";renderHome();
    }
  });
  const openCardsWithExistingControl = () =>
    document.getElementById("flashcard-toggle")?.click();
  document.getElementById("flashcard-top-toggle")?.addEventListener("click",openCardsWithExistingControl);
  document.getElementById("flashcard-sidebar-toggle")?.addEventListener("click",openCardsWithExistingControl);

  // Open the cards directly from /#cards, including after a normal Safari reload.
  const openCardsFromLink = () => {
    if (!["#cards","#flashcards"].includes(window.location.hash)) return;
    if (panel.classList.contains("closed")) openCardsWithExistingControl();
  };
  window.addEventListener("hashchange",openCardsFromLink);
  updateBadge();
  openCardsFromLink();
})();
