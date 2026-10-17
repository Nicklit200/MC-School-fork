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
  const KEY_INVALID = "personal-study-map:quiz-invalid-cards:v1";
  const KEY_DELETED = "personal-study-map:quiz-deleted-cards:v1";
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


  const SYNC_URL="https://personal-life-api-production.up.railway.app/api/quiz-sync";
  const OWNER_KEY="personal-study-map:owner-token:v1",PENDING_KEY="personal-study-map:pending-sync:v1";
  let busy=false,timer=null;
  let lastSyncAt=null, lastSyncError=false;
  function owner(){
    let value=localStorage.getItem(OWNER_KEY);
    if(!/^[a-f0-9]{64}$/.test(value||"")){
      value=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
      localStorage.setItem(OWNER_KEY,value);
    }
    return value;
  }
  async function remote(method,body){
    const res=await fetch(SYNC_URL,{method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+owner()},body:body?JSON.stringify(body):undefined});
    if(!res.ok)throw Error("Sync "+res.status);
    return res.json();
  }
  function queueSync(){
    localStorage.setItem(PENDING_KEY,"1");
    clearTimeout(timer);
    timer=setTimeout(sendSync,1200);
  }
  async function sendSync(){
    if(busy||!navigator.onLine)return;
    busy=true;
    try{
      const data={progress:getProgress(),invalid:getInvalidCards(),deleted:getDeletedCards(),
        overrides:getOverrides(),custom:getCustomCards(),sessions:storedHistory().slice(0,100)};
      const result=await remote("POST",data);
      if(result.ok){localStorage.removeItem(PENDING_KEY);lastSyncAt=new Date().toISOString();lastSyncError=false;}
    }catch(e){lastSyncError=true;console.warn("Sync retry on next visit",e);}
    finally{busy=false;}
  }
  async function pullSync(){
    try{
      const response=await remote("GET");
      lastSyncAt=new Date().toISOString();lastSyncError=false;
      const payload=response.snapshot||{};
      for(const [key,name] of [[KEY_PROGRESS,"progress"],[KEY_INVALID,"invalid"],[KEY_DELETED,"deleted"],[KEY_OVERRIDES,"overrides"]]){
        const remoteData=payload[name];
        if(!remoteData||typeof remoteData!=="object"||Array.isArray(remoteData))continue;
        const current=readJson(key,{});
        const merged={...remoteData,...current};
        if(name==="progress")for(const [id,record] of Object.entries(remoteData)){
          if(!current[id]||String(record?.updatedAt||"")>String(current[id]?.updatedAt||""))merged[id]=record;
        }
        writeJson(key,merged);
      }
      if(Array.isArray(payload.custom)){
        const cards=new Map(payload.custom.map(x=>[x.id,x]));
        for(const x of getCustomCards())cards.set(x.id,x);
        writeJson(KEY_CUSTOM,[...cards.values()]);
      }
      const rows=new Map((Array.isArray(response.sessions)?response.sessions:[]).map(x=>[x.id,x]));
      for(const x of storedHistory())rows.set(x.id,x);
      writeJson(KEY_HISTORY,[...rows.values()].sort((a,b)=>String(b.completedAt||b.date).localeCompare(String(a.completedAt||a.date))).slice(0,100));
      window.dispatchEvent(new Event("study-reviews-updated"));
      updateBadge();
      if(ui.view==="home")renderHome();
    }catch(e){lastSyncError=true;console.warn("Quiz stays in local storage",e);}
  }
  window.addEventListener("study-reviews-updated",queueSync);
  window.addEventListener("online",()=>void pullSync());
  window.addEventListener("visibilitychange",()=>{if(!document.hidden&&localStorage.getItem(PENDING_KEY))void sendSync();});

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
    window.dispatchEvent(new Event("study-reviews-updated"));
  }

  function getOverrides() {
    const saved = readJson(KEY_OVERRIDES, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  function getInvalidCards() {
    const saved=readJson(KEY_INVALID,{});
    return saved && typeof saved==="object" && !Array.isArray(saved)?saved:{};
  }
  function getDeletedCards() {
    const saved=readJson(KEY_DELETED,{});
    return saved && typeof saved==="object" && !Array.isArray(saved)?saved:{};
  }
  function isDeletedCard(id,flags=getDeletedCards()) {
    return Object.prototype.hasOwnProperty.call(flags,id);
  }
  function isInvalidCard(id,flags=getInvalidCards()) {
    return Object.prototype.hasOwnProperty.call(flags,id);
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

  function allCards({includeHidden=false, includeInvalid=false, disregardTopic=false}={}) {
    const context = getContext();
    const exam = context.exam;
    if (!exam) return [];
    const overrides = getOverrides();
    const invalid = getInvalidCards();
    const deleted = getDeletedCards();
    const out = [];
    const skills = (exam.skills || []).filter(skill =>
      disregardTopic || context.topicId === "all" || skill.topicId === context.topicId
    );
    const skillById = new Map(skills.map(skill => [skill.id, skill]));
    for (const skill of skills) {
      for (const original of skill.flashcards || []) {
        const ov = overrides[original.id] || {};
        const hidden=Boolean(ov.hidden);
        const invalidCard=isInvalidCard(original.id,invalid);
        if (ov.deleted || isDeletedCard(original.id,deleted) || (hidden && !includeHidden) || (invalidCard && !includeInvalid)) continue;
        out.push({
          ...original,...ov,id:original.id,skillId:skill.id,
          answer:ov.answer ?? original.answer ?? original.correctAnswer,
          hidden,invalid:invalidCard,custom:false,skillTitle:skill.title
        });
      }
    }
    for (const own of getCustomCards()) {
      const skill = skillById.get(own.skillId);
      if (!skill) continue;
      const hidden=Boolean(own.hidden);
      const invalidCard=isInvalidCard(own.id,invalid);
      if (isDeletedCard(own.id,deleted) || (hidden && !includeHidden) || (invalidCard && !includeInvalid)) continue;
      out.push({
        ...own, custom:true, hidden, invalid:invalidCard, skillTitle:skill.title
      });
    }
    return out.filter(card => card.question && card.answer);
  }

  function explanationForCard(card) {
    if (typeof card?.explanation === "string" && card.explanation.trim()) {
      return card.explanation.trim();
    }
    // Existing in-progress sessions were created before explanations were added.
    // Resolve them by stable card ID without discarding the user's session.
    return String(allCards({includeHidden:true,disregardTopic:true})
      .find(item => item.id === card?.id)?.explanation || "").trim();
  }

  function explanationMarkup(card) {
    const explanation=explanationForCard(card);
    return explanation
      ? '<section class="quiz-explanation" aria-label="Почему правильный ответ верен">'+
        '<div class="quiz-explanation-title">Почему это правильный ответ</div>'+
        '<p>'+esc(explanation)+'</p></section>'
      : "";
  }

  function coachMarkup(card) {
    const explanation=explanationForCard(card);
    return '<details class="quiz-coach"><summary>Не понимаю термин — спросить ИИ</summary>'+
      '<p>Скопируй вопрос с контекстом и задай его в ChatGPT. Текущая карточка останется на месте.</p>'+
      (explanation?'<div class="quiz-coach-tip"><strong>Объяснение:</strong> '+esc(explanation)+'</div>':'')+
      '<label for="quiz-coach-question">Что непонятно?</label>'+
      '<textarea id="quiz-coach-question" rows="2" placeholder="Например: что такое Use Case?"></textarea>'+
      '<button data-action="ask-coach" type="button">Скопировать вопрос и открыть ChatGPT ↗</button>'+
      '<div class="quiz-coach-status" id="quiz-coach-status" role="status"></div></details>';
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
    return '<div class="quiz-head"><div><div class="panel-label">'+esc(getContext().exam?.title||"УЧЁБА")+' · КАРТОЧКИ</div>'+
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

  // Save each first-attempt review immediately, rather than waiting for a
  // lengthy session to complete. The active queue remains resumable.
  function saveCardReview(session,card) {
    if(session?.mode!=="SCHEDULED")return;
    const item=session.items?.[card.id];
    if(!item||item.attempts!==1)return;
    const states=getProgress();
    states[card.id]={...engine.afterReview(states[card.id],!item.hadWrongAttempt),lastCorrect:!item.hadWrongAttempt,updatedAt:new Date().toISOString()};
    writeJson(KEY_PROGRESS,states);
    queueSync();
    window.dispatchEvent(new Event("study-reviews-updated"));
  }
  function storedHistory() {
    const rows=readJson(KEY_HISTORY,[]);
    return Array.isArray(rows)?rows:[];
  }
  function sanitizedResult(result) {
    if (!result || !Array.isArray(result.review)) return result;
    const flags=getInvalidCards();
    const deleted=getDeletedCards(),overrides=getOverrides();
    const review=result.review.filter(item=>
      !isInvalidCard(item.cardId,flags) && !isDeletedCard(item.cardId,deleted) && !overrides[item.cardId]?.deleted
    );
    if (!review.length) return null;
    return {...result,review,totalCards:review.length,
      correctFirstTry:review.filter(item=>item.correct).length,
      nextReviewDate:review.length===result.review.length?result.nextReviewDate:null};
  }
  function latestHistory() {
    return storedHistory().map(sanitizedResult).filter(Boolean);
  }

  function cardPackages(){
    const exam=getContext().exam,groups=new Map();
    if(!exam)return [];
    for(const card of visibleCards()){
      const skill=(exam.skills||[]).find(x=>x.id===card.skillId);
      const lecture=(exam.lectures||[]).find(x=>x.id===skill?.lectureId);
      const topic=(exam.topics||[]).find(x=>x.id===skill?.topicId);
      const key=lecture?"lecture:"+lecture.id:"topic:"+(skill?.topicId||"other");
      if(!groups.has(key))groups.set(key,{
        key,title:lecture?.title||topic?.title||"Другие темы",
        date:lecture?.addedAt||(lecture?.id==="se-analysis-usecases-lecture"?"2026-10-15":null),
        cards:[],slides:new Set()
      });
      const pack=groups.get(key);pack.cards.push(card);
      for(const number of skill?.slideNumbers||[])pack.slides.add(number);
    }
    return [...groups.values()].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||a.title.localeCompare(b.title,"de"));
  }
  function topicStats(cards) {
    const progress=getProgress(), history=latestHistory();
    const latest=new Map();
    for (const session of history) for (const item of session.review||[]) {
      if (!latest.has(item.cardId)) latest.set(item.cardId,item);
    }
    const today=engine.isoDay();
    return {
      due:cards.filter(card=>cardState(card,progress).dueDate<=today).length,
      known:cards.filter(card=>cardState(card,progress).repetitionNumber>=1).length,
      errors:cards.filter(card=>progress[card.id]?.lastCorrect===false || (progress[card.id]?.lastCorrect===undefined && (progress[card.id]?.status==="RESET" || latest.get(card.id)?.correct===false))).length,
      unseen:cards.filter(card=>!progress[card.id]&&!latest.has(card.id)).length
    };
  }
  function packagesMarkup(){
    const packages=cardPackages();
    return '<section class="quiz-packages"><strong>История добавленных карточек</strong>'+
      '<p>Когда и по какой теме добавлены карточки. Это оглавление, а не отдельные очереди повторения: все карточки повторяются вместе.</p>'+
      packages.map(pack=>{
        const date=pack.date?labelDate(pack.date):"Дата добавления не сохранена";
        const stats=topicStats(pack.cards);
        const slides=pack.slides.size?' · слайды '+[...pack.slides].sort((a,b)=>a-b).join(", "):"";
        return '<details class="quiz-package"><summary><span class="quiz-package-date">'+esc(date)+'</span>'+
          '<strong>'+esc(pack.title)+'</strong><small>'+pack.cards.length+' карточек'+esc(slides)+'</small>'+ 
          '<small>Ошибки: '+stats.errors+' · К повторению: '+stats.due+' · Освоено: '+stats.known+' · Новые: '+stats.unseen+'</small></summary>'+
          '<div class="quiz-package-questions">'+pack.cards.map((card,i)=>
            '<div class="quiz-package-question"><span>'+String(i+1)+'. '+esc(card.question)+'</span></div>'
          ).join("")+'</div></details>';
      }).join("")+'</section>';
  }
  function renderHome() {
    studyLayout();
    const context = getContext();
    const cards = visibleCards();
    const due = dueCards();
    // A card counts as known after a successful scheduled review (stage >= 1).
    // Free practice does not affect this metric, consistent with scheduling.
    const progress = getProgress();
    const known = cards.filter(card => cardState(card,progress).repetitionNumber >= 1).length;
    const knownPercent = cards.length ? Math.round(known * 100 / cards.length) : 0;
    const past = latestHistory().filter(item => item.examId === context.exam?.id);
    const lesson = past[0];
    const globalSession = ui.session;
    const unrelated = globalSession && !sessionForCurrentContext();
    host.innerHTML = titleBar("Тренировка и повторение",context.exam?.title || "Выбери экзамен")+
      '<div class="quiz-stat-grid">'+countBox("Всего в разделе",cards.length)+
      countBox("Нужно повторить",due.length)+countBox("Тренировок",past.length)+
      countBox("Знаю карточек",knownPercent+"%")+
      '<div class="quiz-note" style="grid-column:1/-1;margin:0">Освоено: '+known+' из '+cards.length+'. Засчитывается после правильного ответа с первой попытки в повторении по расписанию. Ошибка сбрасывает прогресс карточки.</div>'+'</div>'+
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
      '<div class="quiz-note" role="status"><strong>Синхронизация тренировок</strong><div>'+(lastSyncError?"Нет связи с сервером. Результаты пока только на устройстве.":lastSyncAt?"Связь с сервером есть. Последняя проверка: "+esc(new Date(lastSyncAt).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})):"Проверяем подключение…")+(localStorage.getItem(PENDING_KEY)?" · Есть данные для отправки":"")+'.</div><button data-action="sync-now" type="button">Синхронизировать сейчас</button><small>На телефоне результаты передаются серверу после завершения тренировки. Для доступа из ChatGPT потребуется отдельно подключить коннектор «Мои навыки».</small></div>'+
      packagesMarkup()+
      '<div class="quiz-note">Один правильный вариант и до трёх неправильных. Ошибочная карточка возвращается в очередь, а результат засчитывается по первой попытке.</div>'+
      '<div class="quiz-schedule"><strong>Интервалы Mindcrafti School</strong><div>1 → 2 → 3 → 4 → 7 → 14 → 30 дней</div>'+
      '<small>Первый правильный ответ — через 3 дня. После ошибки — повтор завтра и новый цикл 1 → 2 → 3 → 4 → 7 → 14 → 30. Свободная тренировка не меняет расписание.</small></div>'+
      (lesson?'<div class="quiz-last"><strong>Последний результат</strong><span>'+labelDate(lesson.date)+
        ' · '+lesson.correctFirstTry+' из '+lesson.totalCards+' с первой попытки</span></div>':"")+
      (ui.notice?'<div class="quiz-notice" role="status">'+esc(ui.notice)+'</div>':"")+
      '<p class="quiz-storage-note">Карточки и история тренировки сохраняются в этом браузере. При включении уведомлений даты повторений также передаются серверу для расчёта напоминаний.</p>'+
      '<div id="study-reminder-settings" class="study-reminder-settings"></div>';
    window.dispatchEvent(new Event("study-home-rendered"));
  }

  function startSession(mode) {
    const context = getContext();
    if (!context.exam || ui.session) return;
    const source=visibleCards();
    const today=engine.isoDay(),states=getProgress();
    const cards=mode==="SCHEDULED"?source.filter(card=>cardState(card,states).dueDate<=today):source;
    if (!cards.length) {ui.notice="В выбранном разделе нет подходящих карточек.";renderHome();return;}
    const session = engine.startSession(mode,cards,{
      semesterId:context.semesterId,examId:context.exam.id,topicId:context.topicId
    });
    session.cards = cards.map(card => ({
      id:card.id,skillId:card.skillId,question:card.question,answer:card.answer,
      explanation:card.explanation||"",
      wrongAnswer1:card.wrongAnswer1||null,
      wrongAnswer2:card.wrongAnswer2||null,
      wrongAnswer3:card.wrongAnswer3||null,
      timeLimitSeconds:card.timeLimitSeconds == null ? null : Number(card.timeLimitSeconds),
      skillTitle:card.skillTitle||""
    }));
    ui.session=session;ui.view="study";ui.feedback=null;ui.notice="";
    panel.classList.remove("quiz-chat-open");
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

  function studyLayout() {
    const active=ui.view==="study" && !!ui.session;
    panel.classList.toggle("quiz-fullscreen",active);
    document.body.classList.toggle("quiz-learning-active",active && !panel.classList.contains("closed"));
    let chat=panel.querySelector("#quiz-learning-chat");
    let floating=panel.querySelector("#quiz-floating-chat-toggle");
    if(!active){chat?.remove();floating?.remove();return;}
    if(!floating){
      floating=document.createElement("button");
      floating.type="button";floating.id="quiz-floating-chat-toggle";
      floating.className="quiz-floating-chat-toggle";
      floating.onclick=()=>{panel.classList.toggle("quiz-chat-open");updateChatToggle();};
      panel.appendChild(floating);
    }
    updateChatToggle();
    if(chat)return;
    chat=document.createElement("aside");chat.id="quiz-learning-chat";chat.className="quiz-learning-chat";
    chat.innerHTML='<div class="quiz-chat-heading"><strong>ИИ-помощник</strong><button id="quiz-chat-hide" type="button">Скрыть</button></div><p>Спроси о текущей карточке.</p><div id="quiz-chat-messages" class="quiz-chat-messages"></div><form id="quiz-chat-form"><textarea id="quiz-chat-input" rows="3" placeholder="Что такое Use Case?"></textarea><button type="submit">Отправить ИИ</button></form>';
    panel.appendChild(chat);
    chat.querySelector("#quiz-chat-hide").onclick=()=>{panel.classList.remove("quiz-chat-open");updateChatToggle();};
    chat.querySelector("#quiz-chat-form").onsubmit=async event=>{
      event.preventDefault();
      const input=chat.querySelector("#quiz-chat-input"),question=input.value.trim();
      if(!question)return;
      const card=ui.feedback&&ui.lastCard?ui.lastCard:currentCard();
      const messages=chat.querySelector("#quiz-chat-messages");
      const button=chat.querySelector("#quiz-chat-form button");
      const user=document.createElement("p");user.textContent=question;user.className="quiz-chat-user";messages.appendChild(user);
      const reply=document.createElement("p");reply.textContent="ИИ отвечает…";messages.appendChild(reply);
      input.value="";button.disabled=true;messages.scrollTop=messages.scrollHeight;
      try{
        const response=await fetch("https://personal-life-api-production.up.railway.app/api/study-ai-chat",{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+owner()},
          body:JSON.stringify({question,cardQuestion:card?.question||"",cardAnswer:card?.answer||""})
        });
        const result=await response.json();
        if(!response.ok)throw Error(result.message||(response.status===429?"Лимит $5 в месяц исчерпан.":"Ошибка подключения к ИИ."));
        reply.textContent=result.answer||"Ответ не получен.";
      }catch(error){reply.textContent=error.message||"Не удалось получить ответ.";}
      finally{button.disabled=false;messages.scrollTop=messages.scrollHeight;}
    };
  }
  function updateChatToggle(){
    const floating=panel.querySelector("#quiz-floating-chat-toggle");
    if(floating){const open=panel.classList.contains("quiz-chat-open");floating.textContent=open?"Скрыть чат":"ИИ-чат";floating.setAttribute("aria-expanded",String(open));}
    const button=panel.querySelector("#quiz-chat-toggle");
    if(button){
      const open=panel.classList.contains("quiz-chat-open");
      button.textContent=open?"Скрыть ИИ-чат":"Открыть ИИ-чат";
      button.setAttribute("aria-expanded",String(open));
    }
  }
  function quickGrade(known) {
    if(ui.view!=="study"||!ui.session)return;
    // Grading from the visible feedback must not silently grade the next card.
    if(ui.feedback)return;
    const session=ui.session,card=currentCard();
    if(!card)return;
    stopTimer();stopAdvance();
    const item=session.items?.[card.id];
    if(!item||item.state!=="PENDING")return;
    // Mark the card finished immediately; do not add wrong answers back to
    // the end of this fast sorting session.
    session.queue=session.queue.filter(id=>id!==card.id);
    item.state="ANSWERED_CORRECT";
    item.attempts=Math.max(1,item.attempts||0);
    item.firstSelectedAnswer=known?card.answer:"";
    item.hadWrongAttempt=!known;
    session.currentQuestion=null;
    if(session.mode==="SCHEDULED"){
      const states=getProgress();
      const prior=states[card.id];
      // Quick "know" deliberately starts a fresh 3-day interval, even when
      // a legacy state has an inconsistent stage.
      const scheduled=known?{repetitionNumber:1,dueDate:engine.plusDays(engine.isoDay(),3),status:"ACTIVE"}:engine.afterReview(prior,false);
      states[card.id]={...scheduled,lastCorrect:known,updatedAt:new Date().toISOString()};
      writeJson(KEY_PROGRESS,states);
      queueSync();
      window.dispatchEvent(new Event("study-reviews-updated"));
    }
    ui.notice=known?"Отмечено: знаю. Карточка убрана из сегодняшней очереди.":"Отмечено: не знаю. Карточка вернётся завтра.";
    saveSession();updateBadge();
    if(!session.queue.length)finishSession();
    else renderStudy();
  }
  function quickGradeButtons(){
    return '<div class="quiz-quick-grade" aria-label="Быстрая оценка знания">'+
      '<button type="button" data-action="quick-known" class="quiz-quick-known">✓ Знаю <small>Следующее через 3 дня</small></button>'+
      '<button type="button" data-action="quick-unknown" class="quiz-quick-unknown">✕ Не знаю <small>Повторить завтра</small></button></div>';
  }
  function renderStudy() {
    studyLayout();
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
      '<div class="quiz-session-buttons"><button id="quiz-chat-toggle" data-action="toggle-study-chat" type="button">Открыть ИИ-чат</button><button data-action="home" type="button">Пауза</button></div></div>'+
      (ui.notice?'<div class="quiz-notice" role="status">'+esc(ui.notice)+'</div>':"")+
      '<div class="quiz-progress-row"><span>Завершено '+answered+' из '+total+'</span>'+
      (question.expiresAt!=null?'<strong id="quiz-timer" class="quiz-timer"></strong>':"")+
      '</div><div class="quiz-progress-track"><div style="width:'+
      Math.round((answered/total)*100)+'%"></div></div>'+
      '<div class="quiz-question">'+esc(card.question)+'</div>'+
      '<div class="quiz-options">'+controls+'</div>'+
      (!feedback?'<div class="quiz-question-actions quiz-four-actions">'+
        '<button type="button" data-action="quick-known" class="quiz-quick-known"><span>✓ Знаю</span><small>Через 3 дня</small></button>'+
        '<button type="button" data-action="quick-unknown" class="quiz-quick-unknown"><span>✕ Не знаю</span><small>Повторить завтра</small></button>'+
        '<button data-action="skip" class="quiz-skip" type="button">'+
        '<span>Не знаю</span><small>Показать правильный ответ</small></button>'+
        '<button data-action="invalid" class="quiz-invalid" type="button" title="Исключить вопрос из статистики и повторений">'+
        '<span>Некорректный вопрос</span><small>Не учитывать</small></button></div>':'')+
      (feedback?'<div class="quiz-feedback '+(feedback.correct?'ok':'fail')+'">'+
        (feedback.correct?'Правильно.':(feedback.skipped?'Не знаю.':feedback.timedOut?'Время вышло.':'Неправильно.'))+
        (feedback.correct?'':' Правильный ответ: '+esc(feedback.correctAnswer)+
        '. Карточка повторится в этом занятии.')+
        '</div>'+explanationMarkup(card)+
        '<p class="quiz-manual-hint">Прочитай объяснение. Переход только по кнопке «Дальше».</p>'+
        '<button class="quiz-next" data-action="next" type="button">Дальше →</button>':
        '<div class="quiz-note">Выбери один ответ. Проверка происходит сразу после нажатия.</div>')+
      '<p class="quiz-storage-note">Ошибки с первой попытки учитываются отдельно от окончательного ответа.</p>';
    updateChatToggle();
    if (!feedback) startCountdown();
    else stopAdvance(); // Explanation stays visible until the user is ready.
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
    ui.notice="";
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
    saveCardReview(session,card);
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
      '</div>'+explanationMarkup(last)+
      '<p class="quiz-manual-hint">Прочитай объяснение. Переход только по кнопке «Дальше».</p>'+
      '<button class="quiz-next" data-action="next" type="button">Дальше →</button>'+
      '<button class="quiz-invalid-after" data-action="invalid" type="button">Некорректный вопрос · не учитывать</button>';
    // No automatic transition: even a correct answer deserves time to read the rationale.
    host.querySelector?.(".quiz-explanation")?.scrollIntoView?.({behavior:"smooth",block:"nearest"});
  }

  function advance(source) {
    // Never leave feedback automatically. A real user click is mandatory.
    if (source !== "button") return;
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
    // Progress was already persisted on first answer: avoid applying it twice.
    if(session.mode==="SCHEDULED")completed.states=getProgress();
    if (session.mode==="SCHEDULED") {
      writeJson(KEY_PROGRESS,completed.states);
    }
    const history=storedHistory();
    history.unshift(completed.result);
    writeJson(KEY_HISTORY,history.slice(0,MAX_HISTORY));
    queueSync();
    void sendSync();
    window.dispatchEvent(new Event("study-reviews-updated"));
    localStorage.removeItem(KEY_SESSION);
    ui.session=null;ui.feedback=null;ui.result=completed.result;ui.view="result";
    updateBadge();renderResult();
  }

  function renderResult() {
    const result=sanitizedResult(ui.result);
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
        (explanationForCard({id:item.cardId})?
          '<details class="quiz-result-explanation"><summary>Почему этот ответ правильный</summary><p>'+
          esc(explanationForCard({id:item.cardId}))+'</p></details>':"")+
        '<small>Попыток: '+Number(item.attempts||1)+'</small></div>').join("")+
      '</div><div class="quiz-actions"><button data-action="home" class="primary" type="button">Готово</button>'+
      '<button data-action="practice" type="button">Потренироваться ещё</button></div>';
  }

  function renderHistory() {
    const ctx=getContext();
    const rows=latestHistory().filter(item=>item.examId===ctx.exam?.id);
    const lessons=(window.studyBoardCards?.learningSessions?.()||[])
      .filter(item=>item.examId===ctx.exam?.id)
      .slice().sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
    const lessonHtml=lessons.length?
      '<div class="quiz-history">'+lessons.map(item=>{
        const cp=item.checkpoint;
        const checkpoint=cp?.document&&cp?.page?
          '<small>Остановились: '+esc(cp.document)+', стр. '+esc(cp.page)+
          (cp.totalPages?' из '+esc(cp.totalPages):'')+
          (cp.topic?' · '+esc(cp.topic):'')+'</small>':'';
        return '<article class="quiz-result-row"><strong>'+esc(labelDate(item.date))+
          ' · '+esc(item.title||"Учебное занятие")+'</strong>'+
          '<p>'+esc(item.summary||"")+'</p>'+checkpoint+'</article>';
      }).join("")+'</div>':
      '<div class="quiz-empty">Пока нет сохранённых учебных занятий по этому предмету.</div>';
    const trainingHtml=rows.length?
      '<div class="quiz-history">'+rows.map(item=>
        '<button class="quiz-history-item" data-action="history-item" data-id="'+esc(item.id)+'" type="button">'+
        '<strong>'+esc(labelDate(item.date))+' · '+esc(item.type==="PRACTICE"?"Тренировка":"Повторение")+'</strong>'+
        '<span>С первой попытки: '+item.correctFirstTry+'/'+item.totalCards+'</span></button>').join("")+'</div>':
      '<div class="quiz-empty">Пока нет завершённых тренировок. Результат появится после первого теста с карточками.</div>';
    host.innerHTML=titleBar("История занятий",ctx.exam?.title||"")+
      '<h3>Изученные темы ('+lessons.length+')</h3>'+lessonHtml+
      '<h3>Тренировки с карточками ('+rows.length+')</h3>'+trainingHtml;
  }

  function renderManage() {
    const all=allCards({includeHidden:true,includeInvalid:true});
    const invalidCount=all.filter(card=>card.invalid).length;
    const cards=ui.managerFilter==="invalid"?all.filter(card=>card.invalid):all;
    const states=getProgress();
    host.innerHTML=titleBar("Управление карточками")+
      '<div class="quiz-actions"><button data-action="create" class="primary" type="button">+ Новая</button>'+
      '<button data-action="import" type="button">Импортировать</button></div>'+
      '<div class="quiz-manager-filters" role="group" aria-label="Фильтр карточек">'+
      '<button data-action="manager-filter" data-filter="all" type="button"'+
      (ui.managerFilter==="all"?' class="active"':'')+'>Все ('+all.length+')</button>'+
      '<button data-action="manager-filter" data-filter="invalid" type="button"'+
      (ui.managerFilter==="invalid"?' class="active"':'')+'>Некорректные ('+invalidCount+')</button></div>'+
      (ui.notice?'<div class="quiz-notice" role="status">'+esc(ui.notice)+'</div>':"")+
      '<div class="quiz-manage-list">'+
      (cards.length?cards.map(card=>{
        const progress=cardState(card,states);
        return '<div class="quiz-manage-row'+(card.hidden?' hidden-card':'')+
          (card.invalid?' invalid-card':'')+'">'+
          '<strong>'+esc(card.question)+'</strong>'+
          '<span>'+esc(card.skillTitle)+'</span>'+
          (card.invalid?'<small>Некорректная · не учитывается в тренировках и статистике</small>':
            '<small>Этап '+progress.repetitionNumber+'/7 · '+esc(labelDate(progress.dueDate))+
            (card.hidden?' · Скрыта':'')+'</small>')+
          '<div><button data-action="edit" data-id="'+esc(card.id)+'" type="button">Редактировать</button>'+
          (card.invalid?'<button data-action="restore-invalid" data-id="'+esc(card.id)+'" type="button">Восстановить</button>':
            '<button data-action="toggle-hidden" data-id="'+esc(card.id)+'" type="button">'+
            (card.hidden?'Показать':'Скрыть')+'</button>')+
          (card.custom||card.invalid?'<button data-action="delete" data-id="'+esc(card.id)+'" type="button">Удалить</button>':"")+
          '</div></div>';
      }).join(""):'<div class="quiz-empty">В этом списке пока нет карточек.</div>')+
      '</div><p class="quiz-storage-note">Пометки и удаления сохраняются в этом браузере. Исходные карточки на сервере не изменяются.</p>';
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
      '<label><span>Почему это правильный ответ (необязательно)</span>'+
      '<textarea name="explanation" maxlength="1600" rows="4" placeholder="Объясни идею своими словами">'+
      esc(c?.explanation||"")+'</textarea></label>'+
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
    const explanation=String(data.get("explanation")||"").trim();
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
    const values={skillId,question,answer,explanation,wrongAnswer1:wrong[0]||null,
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
    window.dispatchEvent(new Event("study-reviews-updated"));
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
    studyLayout();
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
    const card=allCards({includeHidden:true,includeInvalid:true}).find(c=>c.id===id);
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
    window.dispatchEvent(new Event("study-reviews-updated"));
  }

  function dropCardFromSession(session,id) {
    if (!session) return;
    session.cardIds=(session.cardIds||[]).filter(value=>value!==id);
    session.queue=(session.queue||[]).filter(value=>value!==id);
    session.cards=(session.cards||[]).filter(card=>card.id!==id);
    if (session.items) delete session.items[id];
    if (session.currentQuestion?.cardId===id) session.currentQuestion=null;
  }
  function readActiveSession() {
    const session=readJson(KEY_SESSION,null);
    if (!session || !Array.isArray(session.cardIds) || !Array.isArray(session.queue) ||
        !Array.isArray(session.cards)) return null;
    const excluded=getInvalidCards(),deleted=getDeletedCards(),overrides=getOverrides();
    const remove=session.cardIds.filter(id=>
      isInvalidCard(id,excluded) || isDeletedCard(id,deleted) || overrides[id]?.deleted
    );
    // An old unfinished queue may contain cards which have since been
    // scheduled into the future on another device or in another session.
    const progress=getProgress(), today=engine.isoDay();
    for(const id of session.cardIds){
      const item=session.items?.[id];
      const due=progress[id]?.dueDate;
      if(session.mode==="SCHEDULED" && item?.state==="PENDING" &&
          !item.hadWrongAttempt && due && due>today && !remove.includes(id)) remove.push(id);
    }
    for (const id of remove) dropCardFromSession(session,id);
    if (!session.cardIds.length) {
      localStorage.removeItem(KEY_SESSION);
      return null;
    }
    if (remove.length) writeJson(KEY_SESSION,session);
    return session;
  }
  function reportInvalid() {
    if (ui.view!=="study" || !ui.session) return;
    const card=ui.feedback && ui.lastCard?ui.lastCard:currentCard();
    if (!card) return;
    stopTimer();stopAdvance();
    const invalid=getInvalidCards();
    invalid[card.id]={markedAt:new Date().toISOString(),question:card.question};
    writeJson(KEY_INVALID,invalid);
    const progress=getProgress();
    if (Object.prototype.hasOwnProperty.call(progress,card.id)) {
      delete progress[card.id];
      writeJson(KEY_PROGRESS,progress);
    }
    dropCardFromSession(ui.session,card.id);
    ui.feedback=null;ui.lastCard=null;ui.lastQuestionOptions=null;
    ui.notice="Вопрос исключён. Его можно восстановить в разделе «Все карточки».";
    updateBadge();
    window.dispatchEvent(new Event("study-reviews-updated"));
    if (!ui.session.cardIds.length) {
      ui.session=null;ui.view="home";
      localStorage.removeItem(KEY_SESSION);
      renderHome();
    } else {
      saveSession();
      if (!ui.session.queue.length) finishSession();
      else renderStudy();
    }
  }
  function restoreInvalid(id) {
    const invalid=getInvalidCards();
    if (!isInvalidCard(id,invalid)) return;
    delete invalid[id];
    writeJson(KEY_INVALID,invalid);
    ui.notice="Вопрос восстановлен. Он снова доступен для повторения.";
    renderManage();updateBadge();
    window.dispatchEvent(new Event("study-reviews-updated"));
  }
  function removeCard(id) {
    const c=allCards({includeHidden:true,includeInvalid:true}).find(card=>card.id===id);
    if (!c || (!c.custom && !c.invalid)) return;
    if (!window.confirm("Удалить карточку из своей карты? Для исходных вопросов удаление действует только в этом браузере.")) return;
    if (c.custom) {
      persistCustomCards(getCustomCards().filter(card=>card.id!==id));
    } else {
      const ov=getOverrides();
      ov[id]={...(ov[id]||{}),deleted:true};
      writeJson(KEY_OVERRIDES,ov);
    }
    const deleted=getDeletedCards();
    deleted[id]={deletedAt:new Date().toISOString(),question:c.question};
    writeJson(KEY_DELETED,deleted);
    const flags=getInvalidCards();
    if (isInvalidCard(id,flags)) {
      delete flags[id];
      writeJson(KEY_INVALID,flags);
    }
    const states=getProgress();
    if (Object.prototype.hasOwnProperty.call(states,id)) {
      delete states[id];
      writeJson(KEY_PROGRESS,states);
    }
    if (ui.session && ui.session.cardIds.includes(id)) {
      dropCardFromSession(ui.session,id);
      if (ui.session.cardIds.length)saveSession();
      else {ui.session=null;localStorage.removeItem(KEY_SESSION);}
    }
    ui.notice="Карточка удалена из этой карты.";
    renderManage();updateBadge();
    window.dispatchEvent(new Event("study-reviews-updated"));
  }

  async function handleClick(event) {
    const button=event.target.closest("button[data-action]");
    if (!button || !host.contains(button) || button.disabled) return;
    const action=button.dataset.action;
    const id=button.dataset.id;
    if (action==="home") {
      cleanupTimers();ui.view="home";panel.classList.remove("quiz-fullscreen");document.body.classList.remove("quiz-learning-active");ui.feedback=null;ui.notice="";
      renderHome();
    } else if (action==="quick-known") {
      quickGrade(true);
    } else if (action==="quick-unknown") {
      quickGrade(false);
    } else if (action==="toggle-study-chat") {
      panel.classList.toggle("quiz-chat-open");
      updateChatToggle();
    } else if (action==="ask-coach") {
      const card=ui.feedback && ui.lastCard?ui.lastCard:currentCard();
      if(!card)return;
      const typed=document.getElementById("quiz-coach-question")?.value?.trim()||"Объясни понятие из вопроса.";
      const prompt="Я изучаю "+(getContext().exam?.title||"Software Engineering")+
        ". Объясни по-русски простыми словами, с примером и коротким немецким определением. "+
        "Карточка: "+card.question+". Правильный ответ: "+card.answer+
        (explanationForCard(card)?". Объяснение: "+explanationForCard(card):"")+
        ". Мой вопрос: "+typed;
      const status=document.getElementById("quiz-coach-status");
      if(status)status.textContent="Открываем ChatGPT. Вставь туда вопрос из буфера обмена.";
      if(navigator.clipboard?.writeText){
        navigator.clipboard.writeText(prompt).catch(()=>{
          const input=document.getElementById("quiz-coach-question");
          if(input){input.value=prompt;input.select();}
          if(status)status.textContent="Скопируй выделенный текст вручную.";
        });
      } else {
        const input=document.getElementById("quiz-coach-question");
        if(input){input.value=prompt;input.select();}
        if(status)status.textContent="Скопируй выделенный текст вручную.";
      }
      window.open("https://chatgpt.com/","_blank","noopener,noreferrer");
    } else if (action==="sync-now") {
      await sendSync();await pullSync();ui.notice=lastSyncError?"Синхронизация не удалась. Попробуй снова при наличии интернета.":"Данные проверены и отправлены на сервер.";renderHome();
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
    } else if (action==="invalid") reportInvalid();
    else if (action==="manager-filter") {
      ui.managerFilter=button.dataset.filter==="invalid"?"invalid":"all";
      ui.notice="";renderManage();
    } else if (action==="restore-invalid") restoreInvalid(id);
    else if (action==="answer") {
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
    } else if (action==="next") advance("button");
    else if (action==="manage") {cleanupTimers();ui.view="manage";ui.notice="";renderManage();}
    else if (action==="create") {ui.editing=null;ui.view="editor";renderEditor();}
    else if (action==="edit") {
      const card=allCards({includeHidden:true,includeInvalid:true}).find(c=>c.id===id);
      if(card){ui.editing=card;ui.view="editor";renderEditor();}
    } else if (action==="toggle-hidden") toggleHidden(id);
    else if (action==="delete") {removeCard(id);
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
    ui.session=readActiveSession();
    ui.view="home";ui.feedback=null;ui.notice="";
    render();
  };
  document.getElementById("close-flashcards").onclick=()=>{
    cleanupTimers();panel.classList.add("closed");panel.classList.remove("quiz-fullscreen","quiz-chat-open");document.body.classList.remove("quiz-learning-active");
  };
  window.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!panel.classList.contains("closed")){
      cleanupTimers();panel.classList.add("closed");panel.classList.remove("quiz-fullscreen","quiz-chat-open");document.body.classList.remove("quiz-learning-active");
    }
  });
  window.addEventListener("study-context-updated",()=>{
    updateBadge();
    if(!panel.classList.contains("closed") && ui.view==="home"){
      renderHome();
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
  void pullSync();
  openCardsFromLink();
})();
