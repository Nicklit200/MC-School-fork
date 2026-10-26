/* Personal Study Map — interactive four-choice study sessions.
 * Session rules ported from Mindcrafti School (StudyService/Sm2Scheduler).
 * PostgreSQL is the shared durable store. Local storage retains unsent answers
 * across reloads; synchronization requires the same private owner key.
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




  // PostgreSQL owns review schedules; browser data is only an offline cache/outbox.
  const ACCOUNT_KEY="personal-study-map:account-session:v2";
  const ACCOUNT_MODE_KEY="personal-study-map:account-enabled:v2";
  const OUTBOX_KEY="personal-study-map:account-outbox:v2";
  const META_KEY="personal-study-map:account-meta-outbox:v2";
  const IMPORT_KEY="personal-study-map:legacy-import-outbox:v2";
  const IMPORT_DONE_KEY="personal-study-map:legacy-imported-owner:v2";
  const QUEUE_KEY="personal-study-map:server-queue:v2";
  const ACCOUNT_API="https://personal-life-api-production.up.railway.app/api/quiz-v2";
  let accountToken=localStorage.getItem(ACCOUNT_KEY)||"";
  let accountMode=!!accountToken || localStorage.getItem(ACCOUNT_MODE_KEY)==="true";
  let accountOnline=false,accountFlight=null,accountSetupInfo=null;
  let serverQueue=readJson(QUEUE_KEY,null);
  const outbox=()=>readJson(OUTBOX_KEY,[]);
  const metadata=()=>({invalid:getInvalidCards(),deleted:getDeletedCards(),
    overrides:getOverrides(),custom:getCustomCards(),sessions:storedHistory().slice(0,100)});
  async function accountRequest(path,method="GET",body){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(ACCOUNT_API+path,{method,cache:"no-store",signal:controller.signal,
        headers:{"Authorization":"Bearer "+accountToken,"Content-Type":"application/json"},
        body:body===undefined?undefined:JSON.stringify(body)});
      const result=await response.json().catch(()=>({}));
      if(!response.ok){const error=Error(result.error||"Сервер: "+response.status);error.status=response.status;throw error;}
      return result;
    }finally{clearTimeout(timeout);}
  }
  function hydrateAccount(result){
    const s=result.snapshot||{};
    applyingRemote=true;
    try{
      for(const [key,name] of [[KEY_PROGRESS,"progress"],[KEY_OVERRIDES,"overrides"],
        [KEY_INVALID,"invalid"],[KEY_DELETED,"deleted"]])writeJson(key,s[name]||{});
      writeJson(KEY_CUSTOM,Array.isArray(s.custom)?s.custom:[]);
      writeJson(KEY_HISTORY,Array.isArray(result.sessions)?result.sessions:[]);
      window.dispatchEvent(new Event("study-reviews-updated"));
    }finally{applyingRemote=false;}
  }
  async function waitForCards(){
    for(let i=0;i<50;i++){
      if(window.studyBoardCards?.allExams?.()?.length)return;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw Error("Карта ещё загружается");
  }
  function markAccountMeta(){
    writeJson(META_KEY,metadata());
    clearTimeout(timer);
    timer=setTimeout(()=>void updateAccount(),1200);
  }
  async function updateAccount(){
    if(!accountToken)return false;
    if(accountFlight)return accountFlight;
    accountFlight=(async()=>{
      try{
        const migration=readJson(IMPORT_KEY,null);
        if(migration){
          const ack=await accountRequest("/import","POST",migration);
          if(ack.ok!==true)throw Error("Перенос старой истории не подтверждён");
          localStorage.setItem(IMPORT_DONE_KEY,migration.legacyToken);
          localStorage.removeItem(IMPORT_KEY);
        }
        for(const item of outbox()){
          const ack=await accountRequest("/answer","POST",item);
          if(ack.accepted!==true && ack.duplicate!==true &&
             ack.reason!=="not-due-or-already-reviewed")throw Error("Ответ не подтверждён");
          writeJson(OUTBOX_KEY,outbox().filter(x=>x.eventId!==item.eventId));
        }
        const meta=readJson(META_KEY,null);
        if(meta){
          const ack=await accountRequest("/sync","POST",meta);
          if(ack.ok!==true)throw Error("История не подтверждена");
          if(stable(meta)===stable(readJson(META_KEY,null)))localStorage.removeItem(META_KEY);
        }
        await waitForCards();
        const snapshot=await accountRequest("/state");
        hydrateAccount(snapshot);
        serverQueue=await accountRequest("/queue","POST",{
          cardIds:allCards({disregardTopic:true}).map(card=>card.id)});
        writeJson(QUEUE_KEY,serverQueue);
        lastSyncAt=lastVerifiedAt=new Date().toISOString();
        lastVerifiedCount=Object.keys(snapshot.snapshot?.progress||{}).length;
        accountOnline=true;lastSyncError=false;
        updateBadge();
        if(ui.view==="home"&&!panel.classList.contains("closed"))renderHome();
        return true;
      }catch(error){
        accountOnline=false;lastSyncError=true;
        console.warn("Server sync failed; unsent data retained",error);
        if(error.status===401){
          accountToken="";localStorage.removeItem(ACCOUNT_KEY);
          ui.notice="Время входа истекло. Войди повторно, сохранённые ответы останутся.";
        }
        if(ui.view==="home"&&!panel.classList.contains("closed"))renderHome();
        return false;
      }finally{
        accountFlight=null;
        if(accountToken&&navigator.onLine&&
          (outbox().length||readJson(META_KEY,null)||readJson(IMPORT_KEY,null)))
          setTimeout(()=>void updateAccount(),5000);
      }
    })();
    return accountFlight;
  }
  function queueInitialImport(){
    const legacy=owner();
    if(localStorage.getItem(IMPORT_DONE_KEY)===legacy)return;
    if(!readJson(IMPORT_KEY,null))
      writeJson(IMPORT_KEY,{legacyToken:legacy,snapshot:localSnapshot(),sessions:storedHistory()});
  }
  async function acceptAccountLogin(result){
    if(!/^[a-f0-9]{64}$/.test(result?.token||""))throw Error("Недопустимый ответ сервера");
    queueInitialImport();
    accountToken=result.token;accountMode=true;
    localStorage.setItem(ACCOUNT_KEY,accountToken);
    localStorage.setItem(ACCOUNT_MODE_KEY,"true");
    if(!await updateAccount())throw Error("Вход выполнен, но данные пока не подтверждены сервером");
  }

  async function checkAccountSetup(){
    if(accountToken)return;
    try{
      const response=await fetch(ACCOUNT_API+"/setup-status",{cache:"no-store",
        headers:{"Authorization":"Bearer "+owner()}});
      if(!response.ok)throw Error("HTTP "+response.status);
      accountSetupInfo=await response.json();
    }catch(error){
      console.warn("Account status could not be loaded",error);
      accountSetupInfo={error:true};
    }
    if(ui.view==="home"&&!panel.classList.contains("closed"))renderHome();
  }
  function accountStatusMarkup(){
    if(accountToken)return "";
    const configured=accountSetupInfo?.configured;
    const maySetup=accountSetupInfo?.maySetup;
    const status=configured===true
      ?"Единый аккаунт уже существует. Введи пароль для входа, общий прогресс загрузится из PostgreSQL."
      :configured===false
      ?(maySetup?"Единый аккаунт ещё не создан. Создай его с паролем длиной не менее 12 символов."
        :"Единый аккаунт ещё не создан. Создай его на компьютере, который раньше подключал коннектор «Мои навыки».")
      :"Проверяем, создан ли единый аккаунт. История этого браузера пока не означает успешный перенос.";
    const actions=configured===true
      ?'<button type="submit" value="login" class="primary">Войти и загрузить историю</button>'
      :configured===false
        ?(maySetup?'<button type="submit" value="setup" class="primary">Создать единый аккаунт</button>':"")
        :'<button type="submit" value="login" class="primary">Войти</button> <button type="submit" value="setup">Создать аккаунт</button>';
    return '<section class="quiz-note" id="quiz-account-status" aria-label="Серверный аккаунт">'+
      '<strong>Нет подтверждённого входа в единый аккаунт</strong><p>'+esc(status)+'</p>'+
      (actions?'<form id="quiz-account-form" class="quiz-form">'+
        '<label>Пароль (не менее 12 символов)<input name="password" type="password" autocomplete="current-password" minlength="12" maxlength="180" required placeholder="12+ символов"></label>'+
        '<div class="quiz-actions">'+actions+'</div></form>':"")+
      '<p class="quiz-warning" id="quiz-account-error" role="alert" hidden></p>'+
      '</section>';
  }
  async function handleAccountForm(event){
    event.preventDefault();
    const form=event.target, password=String(form.elements.namedItem("password")?.value||"");
    const action=event.submitter?.value||"login";
    const errorNode=form.parentElement?.querySelector("#quiz-account-error");
    const showError=message=>{
      if(errorNode){errorNode.textContent=message;errorNode.hidden=false;}
      ui.notice=message;
    };
    if(password.length<12||password.length>180){
      showError("Вход не выполнен: пароль должен содержать минимум 12 символов.");
      return;
    }
    const buttons=[...form.querySelectorAll("button")];
    buttons.forEach(x=>x.disabled=true);
    try{
      if(action==="setup")await setupAccount(password);
      else await loginAccount(password);
      ui.notice="Вход подтверждён сервером. История получена из PostgreSQL.";
      renderHome();
    }catch(error){
      showError("Вход не выполнен: "+String(error.message||error));
      buttons.forEach(x=>x.disabled=false);
    }
  }

  async function loginAccount(password){
    const response=await fetch(ACCOUNT_API+"/login",{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||"Вход не удался");
    await acceptAccountLogin(result);
  }
  async function setupAccount(password){
    const response=await fetch(ACCOUNT_API+"/setup",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+owner()},
      body:JSON.stringify({password})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||"Не удалось создать аккаунт");
    await acceptAccountLogin(result);
  }
  function sendAccountAnswer(session,card,correct){
    const item={eventId:crypto.randomUUID(),sessionId:session.id,cardId:card.id,
      correct,occurredAt:new Date().toISOString()};
    writeJson(OUTBOX_KEY,[...outbox(),item]);
    if(accountToken)void updateAccount();
  }

  const SYNC_URL="https://personal-life-api-production.up.railway.app/api/quiz-sync";
  const OWNER_KEY="personal-study-map:owner-token:v1",PENDING_KEY="personal-study-map:pending-sync:v1";
  let busy=false,timer=null,inFlight=null,applyingRemote=false,retryDelay=3000;
  let lastSyncAt=null,lastSyncError=false,lastVerifiedAt=null,lastVerifiedCount=0;
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  function stable(value){
    if(Array.isArray(value))return "["+value.map(stable).join(",")+"]";
    if(object(value))return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+stable(value[k])).join(",")+"}";
    return JSON.stringify(value);
  }
  function owner(){
    let value=localStorage.getItem(OWNER_KEY);
    if(!/^[a-f0-9]{64}$/.test(value||"")){
      value=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,"0")).join("");
      localStorage.setItem(OWNER_KEY,value);
    }
    return value;
  }
  function localSnapshot(){
    return {progress:getProgress(),invalid:getInvalidCards(),deleted:getDeletedCards(),
      overrides:getOverrides(),custom:getCustomCards(),sessions:storedHistory().slice(0,100)};
  }
  async function remote(method,body){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      const res=await fetch(SYNC_URL,{method,cache:"no-store",signal:controller.signal,
        headers:{"Content-Type":"application/json",Authorization:"Bearer "+owner()},
        body:body?JSON.stringify(body):undefined});
      if(!res.ok)throw Error("Sync HTTP "+res.status);
      const data=await res.json();
      if(!object(data))throw Error("Invalid sync response");
      return data;
    }finally{clearTimeout(timeout);}
  }
  function queueSync(){
    if(applyingRemote)return;
    if(accountMode){markAccountMeta();return;}
    localStorage.setItem(PENDING_KEY,Date.now()+":"+crypto.randomUUID());
    clearTimeout(timer);
    timer=setTimeout(()=>void sendSync(),1200);
  }
  function later(a,b){
    const ta=Date.parse(a?.updatedAt||"")||0,tb=Date.parse(b?.updatedAt||"")||0;
    return ta>tb || (ta===tb && Number(a?.scheduleVersion||0)>Number(b?.scheduleVersion||0));
  }
  function validateResponse(response){
    if(!object(response.snapshot)||!Array.isArray(response.sessions))throw Error("Invalid server history shape");
    const progress=response.snapshot.progress;
    if(progress!==undefined && !object(progress))throw Error("Invalid server progress shape");
    if(Object.values(progress||{}).some(x=>!object(x)))throw Error("Invalid server card state");
    return response;
  }
  function mergeResponse(response){
    const payload=validateResponse(response).snapshot;
    for(const [key,name] of [[KEY_PROGRESS,"progress"],[KEY_INVALID,"invalid"],[KEY_DELETED,"deleted"],[KEY_OVERRIDES,"overrides"]]){
      const cloud=payload[name];
      if(!object(cloud))continue;
      const local=readJson(key,{}),merged={...cloud,...(object(local)?local:{})};
      if(name==="progress")for(const [id,record] of Object.entries(cloud)){
        if(!local[id]||later(record,local[id]))merged[id]=record;
      }
      writeJson(key,merged);
    }
    if(Array.isArray(payload.custom)){
      const cards=new Map(payload.custom.filter(x=>object(x)&&x.id).map(x=>[x.id,x]));
      for(const card of getCustomCards())cards.set(card.id,card);
      writeJson(KEY_CUSTOM,[...cards.values()]);
    }
    const rows=new Map(response.sessions.filter(x=>object(x)&&x.id).map(x=>[x.id,x]));
    for(const row of storedHistory())if(object(row)&&row.id)rows.set(row.id,row);
    writeJson(KEY_HISTORY,[...rows.values()].sort((a,b)=>String(b.completedAt||b.date).localeCompare(String(a.completedAt||a.date))).slice(0,100));
    migrateLegacyIntervals();
    restoreHistoryProgress();
  }
  function syncView(){
    applyingRemote=true;
    try{
      window.dispatchEvent(new Event("study-reviews-updated"));
      updateBadge();
      if(ui.view==="home"&&!panel.classList.contains("closed"))renderHome();
    }finally{applyingRemote=false;}
  }
  function validSession(s){
    return object(s)&&typeof s.id==="string"&&s.id.length<=180&&/^\d{4}-\d{2}-\d{2}$/.test(s.date||"")&&Array.isArray(s.review)&&s.review.length<=500;
  }
  function verifySaved(data,response){
    const progress=validateResponse(response).snapshot.progress||{};
    const missing=Object.entries(data.progress).filter(([id,record])=>{
      const saved=progress[id];
      return !saved || (!later(saved,record)&&stable(saved)!==stable(record));
    });
    const byId=new Map(response.sessions.map(s=>[s.id,s]));
    const unsaved=data.sessions.filter(validSession).filter(s=>{
      const saved=byId.get(s.id);
      return !saved || stable(saved.review)!==stable(s.review) || saved.date!==s.date || saved.type!==s.type;
    });
    if(missing.length||unsaved.length)throw Error("Readback mismatch: "+missing.length+" cards, "+unsaved.length+" sessions");
  }
  function serverDiffers(data,response){
    const payload=response.snapshot;
    return ["progress","invalid","deleted","overrides","custom"].some(k=>stable(data[k])!==stable(payload[k]||(k==="custom"?[]:{}))) ||
      data.sessions.filter(validSession).some(s=>!response.sessions.some(r=>r.id===s.id&&stable(r)===stable(s)));
  }
  function synchronize(){
    if(accountMode)return accountToken?updateAccount():Promise.resolve(false);
    if(inFlight)return inFlight;
    if(!navigator.onLine){lastSyncError=true;syncView();return Promise.resolve(false);}
    busy=true;
    inFlight=(async()=>{
      try{
        // Read first: a pending local write must never prevent recovery from the cloud.
        let response=validateResponse(await remote("GET"));
        mergeResponse(response);
        let data=localSnapshot();
        if(serverDiffers(data,response)&&!localStorage.getItem(PENDING_KEY))queueSync();
        if(localStorage.getItem(PENDING_KEY)){
          const revision=localStorage.getItem(PENDING_KEY);
          data=localSnapshot();
          const result=await remote("POST",data);
          if(result.ok!==true)throw Error("Server did not acknowledge save");
          response=validateResponse(await remote("GET"));
          verifySaved(data,response);
          if(revision===localStorage.getItem(PENDING_KEY))localStorage.removeItem(PENDING_KEY);
          mergeResponse(response);
          if(result.skippedSessions)ui.notice="Некоторые старые записи занятий требуют проверки; они сохранены на устройстве. Прогресс карточек отправлен.";
        }
        lastSyncAt=lastVerifiedAt=new Date().toISOString();
        lastVerifiedCount=Object.keys(response.snapshot.progress||{}).length;
        lastSyncError=false;retryDelay=3000;
        return true;
      }catch(error){
        lastSyncError=true;
        console.warn("Quiz sync not confirmed; local answers retained",error);
        retryDelay=Math.min(retryDelay*2,30000);
        return false;
      }finally{
        busy=false;inFlight=null;
        clearTimeout(timer);
        if(localStorage.getItem(PENDING_KEY)&&navigator.onLine)timer=setTimeout(()=>void sendSync(),lastSyncError?retryDelay:250);
        syncView();
      }
    })();
    return inFlight;
  }
  function sendSync(){return synchronize();}
  function pullSync(){return synchronize();}
  window.addEventListener("study-reviews-updated",queueSync);
  window.addEventListener("online",()=>void synchronize());
  window.addEventListener("pagehide",()=>{if(localStorage.getItem(PENDING_KEY))void synchronize();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)void synchronize();});
  window.addEventListener("storage",event=>{
    if([KEY_PROGRESS,KEY_HISTORY,KEY_CUSTOM,KEY_OVERRIDES,KEY_INVALID,KEY_DELETED].includes(event.key)){
      queueSync();syncView();
    }
  });
  // Synchronize even during a long session; never rerender the current question.
  setInterval(()=>{if(!document.hidden&&!busy)void synchronize();},30000);

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
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }

  // Upgrade prior saved review dates without losing answer history or scores.
  // Never fabricate a review for a card with no recorded timestamp.
  function migrateLegacyIntervals() {
    const progress = getProgress();
    let next = null;
    for (const [id,record] of Object.entries(progress)) {
      if (!record || typeof record !== "object" ||
          Number(record.scheduleVersion) >= engine.SCHEDULE_VERSION ||
          !record.updatedAt || !record.dueDate) continue;
      const reviewedAt = new Date(record.updatedAt);
      if (!Number.isFinite(reviewedAt.getTime())) continue;
      const lastReviewDay = engine.isoDay(reviewedAt);
      const incorrect = record.lastCorrect === false || record.status === "RESET" || engine.clampStage(record.repetitionNumber) === 0;
      const stage = incorrect ? 0 : Math.max(1,engine.clampStage(record.repetitionNumber));
      const delay = incorrect ? 1 : engine.reviewDelayDays(stage);
      if (!next) next = {...progress};
      next[id] = {...record,repetitionNumber:stage,status:incorrect?"RESET":"ACTIVE",
        dueDate:engine.plusDays(lastReviewDay,delay),scheduleVersion:engine.SCHEDULE_VERSION};
    }
    if (next) {
      writeJson(KEY_PROGRESS,next);
      queueSync();
      window.dispatchEvent(new Event("study-reviews-updated"));
    }
  }
  migrateLegacyIntervals();

  // Recreate lost per-card dates only when an actual dated scheduled review
  // provides the card ID and first-try result. Never infer IDs from totals.
  function restoreHistoryProgress() {
    const states=getProgress();
    const sessions=storedHistory().filter(s=>s?.type==="SCHEDULED" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s.date||"") && Array.isArray(s.review))
      .sort((a,b)=>String(a.date).localeCompare(String(b.date)) ||
        String(a.completedAt||"").localeCompare(String(b.completedAt||"")));
    let recovered=0;
    for(const session of sessions) for(const item of session.review) {
      if(typeof item?.cardId!=="string" || typeof item.correct!=="boolean")continue;
      const old=states[item.cardId];
      const priorTime=Date.parse(String(old?.updatedAt||""));
      if(Number.isFinite(priorTime) && engine.isoDay(new Date(priorTime)) >= session.date)continue;
      if(old?.dueDate && !Number.isFinite(priorTime))continue;
      const schedule=engine.afterReview(old,item.correct,session.date);
      states[item.cardId]={...old,...schedule,lastCorrect:item.correct,
        updatedAt:session.completedAt||session.date+"T12:00:00.000Z"};
      recovered++;
    }
    if(recovered){
      writeJson(KEY_PROGRESS,states);
      queueSync();
    }
    return recovered;
  }
  restoreHistoryProgress();

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
    if (!exam && !disregardTopic) return [];
    const overrides = getOverrides();
    const invalid = getInvalidCards();
    const deleted = getDeletedCards();
    const out = [];
    const exams = disregardTopic ? (window.studyBoardCards?.allExams?.() || []) : [exam];
    const skills = exams.flatMap(item => item?.skills || []).filter(skill =>
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
    const cards=allCards({disregardTopic:true});
    if(accountMode){const due=new Set(serverQueue?.due||[]);return cards.filter(c=>due.has(c.id));}
    return cards.filter(c=>Boolean(states[c.id])&&cardState(c,states).dueDate<=today);
  }

  function updateBadge() {
    const count = accountMode&&!serverQueue?"…":dueCards().length;
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
    if(accountMode)sendAccountAnswer(session,card,!item.hadWrongAttempt);
    else queueSync();
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
      due:cards.filter(card=>Boolean(progress[card.id]) && cardState(card,progress).dueDate<=today).length,
      known:cards.filter(card=>cardState(card,progress).repetitionNumber>=1).length,
      errors:cards.filter(card=>progress[card.id]?.lastCorrect===false || (progress[card.id]?.lastCorrect===undefined && (progress[card.id]?.status==="RESET" || latest.get(card.id)?.correct===false))).length,
      unseen:cards.filter(card=>!progress[card.id]).length
    };
  }
  function packagesMarkup(){
    const packages=cardPackages();
    return '<section class="quiz-packages"><strong>История добавленных карточек</strong>'+
      '<p>Когда и по какой теме добавлены карточки. Это оглавление тем. Изученные карточки повторяются по индивидуальным датам, новые — отдельно.</p>'+
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
    const globallyTracked=Object.keys(progress).length;
    const unseen = accountMode&&serverQueue ? cards.filter(c=>serverQueue.newCards.includes(c.id)) : cards.filter(card=>!progress[card.id]);
    const known = cards.filter(card => cardState(card,progress).repetitionNumber >= 1).length;
    const knownPercent = cards.length ? Math.round(known * 100 / cards.length) : 0;
    const past = latestHistory().filter(item => item.examId === context.exam?.id);
    const lesson = past[0];
    const globalSession = ui.session;
    const unrelated = globalSession && !sessionForCurrentContext();
    host.innerHTML = titleBar("Тренировка и повторение",context.exam?.title || "Выбери экзамен")+
      accountStatusMarkup()+
      '<div class="quiz-stat-grid">'+countBox("Всего в разделе",cards.length)+
      countBox("Нужно повторить",due.length)+countBox("К повторению завтра",accountMode?(serverQueue?.upcomingTomorrow?.length??"…"):allCards({disregardTopic:true}).filter(c=>progress[c.id]&&cardState(c,progress).dueDate===engine.plusDays(engine.isoDay(),1)).length)+countBox("Новые карточки",unseen.length)+countBox("Тренировок",past.length)+
      countBox("Знаю карточек",knownPercent+"%")+countBox("Записей прогресса",globallyTracked)+countBox("Подтверждено сервером",lastVerifiedAt?lastVerifiedCount:"Не проверено")+
      '<div class="quiz-note" style="grid-column:1/-1;margin:0">Освоено: '+known+' из '+cards.length+'. Засчитывается после правильного ответа с первой попытки в повторении по расписанию. Ошибка сбрасывает прогресс карточки.</div>'+'</div>'+
      (unrelated?'<div class="quiz-warning">Есть незавершённое занятие другого предмета. Продолжи его или отмени, прежде чем начинать новое.</div>':"")+
      '<div class="quiz-actions">'+
      (globalSession?'<button data-action="resume" type="button" class="primary">Продолжить занятие</button>'+
        '<button data-action="cancel-session" type="button" class="subtle">Отменить незавершённое</button>':
        '<button data-action="scheduled" class="primary" type="button" '+(!due.length?'disabled':'')+
        '>Повторить по расписанию ('+due.length+')</button>'+
        '<button data-action="new-cards" type="button" '+(!unseen.length?'disabled':'')+'>Изучить новые ('+unseen.length+')</button>'+
        '<button data-action="practice" type="button" '+(!cards.length?'disabled':'')+'>Свободная тренировка</button>')+
      '</div>'+
      '<div class="quiz-actions secondary">'+
      '<button data-action="create" type="button">+ Создать карточку</button>'+
      '<button data-action="import" type="button">Импорт как в школе</button>'+
      '<button data-action="manage" type="button">Все карточки</button>'+
      '<button data-action="history" type="button">История занятий</button>'+
      '</div>'+
      (accountToken?'<div class="quiz-note"><strong>Единый аккаунт подключён</strong><p>'+(accountOnline?"Серверная синхронизация подтверждена.":"Связь с сервером не подтверждена, ожидаем повторной отправки.")+'</p><button data-action="account-refresh" type="button">Обновить с сервера</button></div>':"")+
      '<div class="quiz-note" role="status"><strong>Синхронизация тренировок</strong><div>'+(accountMode?(accountOnline?"Проверено чтением из PostgreSQL: "+esc(new Date(lastVerifiedAt).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})):"Нет подтверждения сервера")+(outbox().length?" · Неотправленных ответов: "+outbox().length:"")+(readJson(META_KEY,null)?" · Есть изменения для отправки":""):(lastSyncError?"Нет связи с сервером":lastSyncAt?"Последняя проверка: "+esc(new Date(lastSyncAt).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})):"Проверяем подключение"))+'.</div><button data-action="sync-now" type="button">Синхронизировать сейчас</button><small>На всех устройствах используется один аккаунт и общая база PostgreSQL. Старые данные сохраняются до успешного переноса.</small></div>'+
      packagesMarkup()+
      '<div class="quiz-note">Один правильный вариант и до трёх неправильных. Ошибочная карточка возвращается в очередь, а результат засчитывается по первой попытке.</div>'+
      '<div class="quiz-schedule"><strong>Интервалы Mindcrafti School</strong><div>1 → 2 → 3 → 7 → 14 → 30 дней</div>'+
      '<small>День 1 — первичное изучение; первый правильный ответ — повтор через 2 дня, затем через 3, 7, 14 и 30. После ошибки — завтра. Новые карточки отдельно; свободная тренировка не меняет расписание.</small></div>'+
      (lesson?'<div class="quiz-last"><strong>Последний результат</strong><span>'+labelDate(lesson.date)+
        ' · '+lesson.correctFirstTry+' из '+lesson.totalCards+' с первой попытки</span></div>':"")+
      (ui.notice?'<div class="quiz-notice" role="status">'+esc(ui.notice)+'</div>':"")+
      '<p class="quiz-storage-note">Расписание и история хранятся в PostgreSQL Railway. Браузер сохраняет только временную копию и очередь при потере связи.</p>'+
      '<div id="study-reminder-settings" class="study-reminder-settings"></div>';
    window.dispatchEvent(new Event("study-home-rendered"));
  }

  async function startSession(mode,group="due") {
    if(!accountToken){ui.notice="Войди в аккаунт, чтобы заниматься и сохранять прогресс в PostgreSQL.";renderHome();return;}
    if(!await updateAccount()){
      ui.notice="Не удалось подтвердить очередь на сервере. История сохранена.";renderHome();return;
    }
    const context = getContext();
    if (ui.session || (mode!=="SCHEDULED" && !context.exam)) return;
    // Scheduled reviews are global, not limited to the currently selected exam.
    const source=mode==="SCHEDULED" && group==="due" ?
      allCards({disregardTopic:true}) : visibleCards();
    const today=engine.isoDay(),states=getProgress();
    const cards=mode==="SCHEDULED" ? source.filter(card =>
      accountMode && serverQueue ? (group==="new"?serverQueue.newCards:serverQueue.due).includes(card.id) :
      group==="new" ? !states[card.id] :
        Boolean(states[card.id]) && cardState(card,states).dueDate<=today
    ) : source;
    if (!cards.length) {ui.notice="В выбранном разделе нет подходящих карточек.";renderHome();return;}
    const session = engine.startSession(mode,cards,{
      semesterId:context.semesterId,examId:context.exam?.id||null,topicId:context.topicId
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
    if(!active){
      chat?.remove();
      panel.classList.remove("quiz-chat-open");
      return;
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
  function chatToggleMarkup(){
    return '<button id="quiz-chat-toggle" class="quiz-chat-inline-toggle" '+
      'data-action="toggle-study-chat" type="button" aria-expanded="false">ИИ-чат</button>';
  }
  function updateChatToggle(){
    const button=panel.querySelector("#quiz-chat-toggle");
    if(button){
      const open=panel.classList.contains("quiz-chat-open");
      button.textContent=open?"Скрыть ИИ-чат":"ИИ-чат";
      button.setAttribute("aria-expanded",String(open));
    }
  }
  function quickGrade(known) {
    if(ui.view!=="study"||!ui.session||ui.feedback)return;
    const session=ui.session,card=currentCard();
    if(!card)return;
    stopTimer();stopAdvance();
    const item=session.items?.[card.id];
    if(!item||item.state!=="PENDING")return;
    const firstAttempt=!item.attempts;
    const firstTryCorrect=firstAttempt && known;
    // The first attempt is definitive. A card answered wrongly earlier
    // cannot become "correct on first attempt" when it returns to the queue.
    session.queue=session.queue.filter(id=>id!==card.id);
    item.state="ANSWERED_CORRECT";
    if (firstAttempt) {
      item.firstSelectedAnswer=known?card.answer:"";
      item.hadWrongAttempt=!known;
    }
    item.attempts=(Number(item.attempts)||0)+1;
    session.currentQuestion=null;
    if(session.mode==="SCHEDULED" && firstAttempt){
      const states=getProgress();
      const prior=states[card.id];
      const scheduled=engine.afterReview(prior,firstTryCorrect);
      states[card.id]={...scheduled,lastCorrect:firstTryCorrect,updatedAt:new Date().toISOString()};
      writeJson(KEY_PROGRESS,states);
      if(accountMode)sendAccountAnswer(session,card,firstTryCorrect);
      else queueSync();
      window.dispatchEvent(new Event("study-reviews-updated"));
    }
    ui.notice=item.hadWrongAttempt
      ?"Карточка записана как ошибка. Следующее повторение — завтра."
      :"Отмечено: знаю. Следующее повторение — по расписанию.";
    saveSession();updateBadge();
    if(!session.queue.length)finishSession();
    else renderStudy();
  }
  function quickGradeButtons(){
    return '<div class="quiz-quick-grade" aria-label="Быстрая оценка знания">'+
      '<button type="button" data-action="quick-known" class="quiz-quick-known">✓ Знаю <small>Следующее по расписанию</small></button>'+
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
      '<button data-action="home" type="button">Пауза</button></div>'+
      (ui.notice?'<div class="quiz-notice" role="status">'+esc(ui.notice)+'</div>':"")+
      '<div class="quiz-progress-row"><span>Завершено '+answered+' из '+total+'</span>'+
      (question.expiresAt!=null?'<strong id="quiz-timer" class="quiz-timer"></strong>':"")+
      '</div><div class="quiz-progress-track"><div style="width:'+
      Math.round((answered/total)*100)+'%"></div></div>'+
      '<div class="quiz-question"><div>'+esc(card.question)+'</div></div>'+
      '<div class="quiz-options">'+controls+'</div>'+
      (!feedback?'<div class="quiz-question-actions quiz-four-actions">'+
        '<button type="button" data-action="quick-known" class="quiz-quick-known"><span>✓ Знаю</span><small>По расписанию</small></button>'+
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
        '<button class="quiz-next" data-action="next" type="button">Дальше →</button>'+chatToggleMarkup():
        '<div class="quiz-note">Выбери один ответ. Проверка происходит сразу после нажатия.</div>'+chatToggleMarkup())+
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
      '<div class="quiz-question"><div>'+esc(last.question)+'</div></div><div class="quiz-options">'+
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
      '<button class="quiz-next" data-action="next" type="button">Дальше →</button>'+chatToggleMarkup()+
      '<button class="quiz-invalid-after" data-action="invalid" type="button">Некорректный вопрос · не учитывать</button>';
    updateChatToggle();
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
    // Progress was already persisted when each first answer was received.
    // Do not advance again just to calculate the result's next-review date.
    if (session.mode==="SCHEDULED") {
      completed.states=getProgress();
      completed.result.nextReviewDate=session.cardIds
        .map(id=>completed.states[id]?.dueDate).filter(Boolean).sort()[0]||null;
      writeJson(KEY_PROGRESS,completed.states);
    }
    const history=storedHistory();
    history.unshift(completed.result);
    writeJson(KEY_HISTORY,history.slice(0,MAX_HISTORY));
    queueSync();
    if(accountMode)void updateAccount();
    else void sendSync();
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
          '<strong>'+esc(card.question)+'</strong>'+ '<small>Номер карточки: '+esc(card.id)+'</small>'+
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
    if(action==="account-login"||action==="account-setup"){
      const password=window.prompt(action==="account-setup"?
        "Придумай пароль единого аккаунта (не менее 12 символов):":"Пароль единого аккаунта «Мои навыки»:");
      if(!password)return;
      try{
        if(action==="account-setup")await setupAccount(password);
        else await loginAccount(password);
        ui.notice="Аккаунт подключён. Прогресс получен из PostgreSQL.";
      }catch(error){ui.notice="Ошибка входа: "+error.message;}
      renderHome();return;
    }
    if(action==="account-password"){
      const password=window.prompt("Новый пароль (не менее 12 символов):");
      if(!password)return;
      try{await accountRequest("/change-password","POST",{password});ui.notice="Пароль изменён.";}
      catch(error){ui.notice="Ошибка: "+error.message;}
      renderHome();return;
    }
    if(action==="account-refresh"){
      ui.notice=await updateAccount()?"Данные загружены с сервера.":"Сервер недоступен.";
      renderHome();return;
    }
    if (action==="pair-export") {
      // A bearer token grants access to all quiz history: show only on explicit request.
      const key=owner();
      window.prompt("Секретный ключ для другого устройства. Сохрани его в надёжном месте, никому не отправляй:",key);
      return;
    } else if (action==="pair-import") {
      if(ui.session){ui.notice="Сначала заверши занятие.";renderHome();return;}
      const key=window.prompt("Вставь секретный ключ с первого устройства (64 символа):");
      if(key===null)return;
      if(!/^[a-f0-9]{64}$/.test(key.trim())){ui.notice="Неверный формат ключа.";renderHome();return;}
      if(key.trim()===owner()){ui.notice="Это устройство уже подключено.";renderHome();return;}
      if(!window.confirm("Объединить историю этого устройства с историей другого? Текущие локальные данные сохранятся."))return;
      // Preserve the old account key for recovery, then merge from the new account.
      localStorage.setItem("personal-study-map:previous-owner-token:v1",owner());
      localStorage.setItem(OWNER_KEY,key.trim());
      localStorage.removeItem(PENDING_KEY);
      lastSyncAt=null;
      void pullSync().then(()=>{
        queueSync();
        ui.notice=lastSyncError?"Не удалось подключиться к серверу. Локальная история сохранена.":"Истории объединены. Отправляем на сервер.";
        renderHome();
      });
      return;
    } else if (action==="home") {
      cleanupTimers();ui.view="home";panel.classList.remove("quiz-fullscreen");document.body.classList.remove("quiz-learning-active");ui.feedback=null;ui.notice="";
      renderHome();
    } else if (action==="quick-known") {
      quickGrade(true);
    } else if (action==="quick-unknown") {
      quickGrade(false);
    } else if (action==="toggle-study-chat") {
      const open=panel.classList.toggle("quiz-chat-open");
      updateChatToggle();
      if(open && window.innerWidth<=760){
        requestAnimationFrame(()=>panel.querySelector("#quiz-learning-chat")
          ?.scrollIntoView?.({behavior:"smooth",block:"start"}));
      }
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
    else if (action==="new-cards") startSession("SCHEDULED","new");
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
    if(event.target?.id==="quiz-account-form"){void handleAccountForm(event);return;}
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
  void (accountMode?(accountToken?updateAccount():Promise.resolve(false)):pullSync());
  if(!accountToken)void checkAccountSetup();
  openCardsFromLink();
})();
