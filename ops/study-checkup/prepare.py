"""One-time, exact-marker patch for the isolated checkup branch; never runs in production."""
from pathlib import Path
import re

root = Path('personal-study-map')
p = root / 'flashcards.js'
s = p.read_text()
assert 'lastVerifiedCount=0' in s
start = s.index('  const SYNC_URL=')
end = s.index('  function getContext()', start)
sync = r'''  const SYNC_URL="https://personal-life-api-production.up.railway.app/api/quiz-sync";
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

'''
s = s[:start]+sync+s[end:]
s = s.replace('examId:context.exam.id,topicId:context.topicId','examId:context.exam?.id||null,topicId:context.topicId')
s = s.replace('<small>Через 3 дня</small>', '<small>По расписанию</small>')
s = s.replace('Синхронизировать сейчас</button><small>', 'Синхронизировать сейчас</button> <button data-action="pair-export" type="button">Ключ синхронизации</button> <button data-action="pair-import" type="button">Подключить устройство</button><small>')
s = s.replace('На телефоне результаты передаются серверу после завершения тренировки.', 'Ответы отправляются автоматически и проверяются обратным чтением. Два устройства должны использовать один секретный ключ.')
s = s.replace('countBox("Новые карточки",unseen.length)', 'countBox("К повторению завтра",allCards({disregardTopic:true}).filter(c=>progress[c.id]&&cardState(c,progress).dueDate<=engine.plusDays(engine.isoDay(),1)).length)+countBox("Новые карточки",unseen.length)')
s = s.replace("'<small>Попыток: '+Number(item.attempts||1)","'<small>Карточка № '+esc(item.cardId)+' · Попыток: '+Number(item.attempts||1)")
s = s.replace(' * Local storage is used intentionally: the current personal API has no\n * authentication and must not receive card content or session history.', ' * PostgreSQL is the shared durable store. Local storage retains unsent answers\n * across reloads; synchronization requires the same private owner key.')
p.write_text(s)

p = root / 'flashcard-engine.js'
s = p.read_text()
a = s.index('  function isoDay(')
b = s.index('  function clampStage(',a)
s = s[:a]+'''  function isoDay(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(d.getTime())) throw new Error("Invalid review date");
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(d);
    const get = key => parts.find(p => p.type === key).value;
    return get("year") + "-" + get("month") + "-" + get("day");
  }

  function plusDays(day, amount) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) throw new Error("Invalid calendar date");
    const [year, month, date] = day.split("-").map(Number);
    const value = new Date(Date.UTC(year, month - 1, date + amount, 12));
    return value.toISOString().slice(0, 10);
  }

'''+s[b:]
p.write_text(s)

p=root/'index.html'
s=p.read_text()
s=re.sub(r'flashcards\.js\?v=[^"\s]+','flashcards.js?v=20261020-checkup-v3',s)
s=re.sub(r'flashcard-engine\.js\?v=[^"\s]+','flashcard-engine.js?v=20261020-berlin-v3',s)
p.write_text(s)
(root/'Dockerfile').write_text('''FROM node:22-alpine AS verified
WORKDIR /check
COPY . ./personal-study-map/
RUN find personal-study-map -type f \\( -name '*.js' -o -name '*.mjs' \\) -print0 | xargs -0 -n1 node --check
RUN node --test personal-study-map/tests/*.test.mjs
FROM nginx:alpine
COPY --from=verified /check/personal-study-map /usr/share/nginx/html
COPY nginx-cache.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
''')
print('Prepared isolated frontend checkup patch; production branch unchanged.')
