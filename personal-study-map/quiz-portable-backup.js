/* Portable, user-controlled recovery file for study-card history. */
(() => {
  "use strict";
  const fields = {
    progress: "personal-study-map:quiz-card-progress:v1",
    sessions: "personal-study-map:quiz-session-history:v1",
    custom: "personal-study-map:custom-flashcards:v2",
    owner: "personal-study-map:owner-token:v1",
    invalid: "personal-study-map:quiz-invalid-cards:v1",
    deleted: "personal-study-map:quiz-deleted-cards:v1",
    overrides: "personal-study-map:card-overrides:v1",
    pending: "personal-study-map:pending-sync:v1"
  };
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  }

  const engine = window.CardQuizEngine;
  function sessionSummary(rows) {
    const day = engine.plusDays(engine.isoDay(), -1);
    const results = (Array.isArray(rows) ? rows : []).filter(x =>
      x?.date === day && Array.isArray(x.review))
      .sort((a,b)=>String(a.completedAt||"").localeCompare(String(b.completedAt||"")));
    const reviewed = new Map();
    // The first try that day wins even when the student later fixes a mistake.
    for(const session of results)for(const item of session.review) {
      if(item?.cardId && typeof item.correct === "boolean" && !reviewed.has(item.cardId))
        reviewed.set(item.cardId,item.correct);
    }
    const historyCount=reviewed.size;
    if(!historyCount){
      const saved=read(fields.progress,{});
      for(const [id,state] of Object.entries(saved)){
        const time=Date.parse(String(state?.updatedAt||""));
        if(Number.isFinite(time) && engine.isoDay(new Date(time))===day &&
           typeof state.lastCorrect==="boolean")reviewed.set(id,state.lastCorrect);
      }
    }
    return {day, sessions:results.length, cards:reviewed.size,
      source:historyCount?"history":"saved-progress",
      practice:results.filter(x=>x.type==="PRACTICE").length,
      correct:[...reviewed.values()].filter(Boolean).length,
      wrong:[...reviewed.values()].filter(x=>!x).length};
  }
  function showButtons() {
    const host = document.getElementById("flashcard-app");
    if (!host || host.querySelector("#quiz-transfer")) return;
    const section = document.createElement("section");
    section.id = "quiz-transfer";
    section.className = "quiz-note";
    const title = document.createElement("strong");
    title.textContent = "Резервная копия карточек";
    const description = document.createElement("p");
    description.textContent = "Экспортируй на компьютере и импортируй на iPhone. Так оба устройства будут пользоваться одной серверной историей. Исходные данные сохраняются."; 
    const report = document.createElement("p");
    const summary = sessionSummary(read(fields.sessions, []));
    report.textContent = summary.cards ?
      "Вчера ("+summary.day+"): "+summary.cards+" ответов; "+
      summary.correct+" правильных, "+summary.wrong+" с ошибкой. "+
      (summary.source==="history"?"Есть запись занятия.":"По сохранённым ответам.") :
      "Вчерашние ответы здесь не найдены. Открой сайт в том браузере компьютера, где проходил занятие.";
    report.style.fontWeight = "600";
    const warning = document.createElement("p");
    warning.textContent = "Приватный файл содержит ключ доступа к истории карточек. Не отправляй его в чат или посторонним, удали после переноса.";
    warning.style.fontSize = "12px";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Скачать результаты";
    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.textContent = "Восстановить из файла";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.hidden = true;
    exportButton.addEventListener("click", () => {
      const syncToken=localStorage.getItem(fields.owner)||"";
      if(!/^[0-9a-f]{64}$/.test(syncToken)){
        alert("Ключ синхронизации не создан. Открой карточки и попробуй снова.");return;
      }
      if(!confirm("Этот приватный файл свяжет компьютер и телефон. Храни его в защищённом месте и удали после переноса. Скачать?"))return;
      const content = {format:"mindcrafti-card-backup",version:2,
        createdAt:new Date().toISOString(),syncToken,
        progress:read(fields.progress,{}),sessions:read(fields.sessions,[]),
        custom:read(fields.custom,[]),invalid:read(fields.invalid,{}),
        deleted:read(fields.deleted,{}),overrides:read(fields.overrides,{})};
      const url = URL.createObjectURL(new Blob([JSON.stringify(content)],{type:"application/json"}));
      const link = document.createElement("a");
      link.href=url; link.download="private-my-skills-transfer.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    });
    importButton.addEventListener("click",()=>fileInput.click());
    fileInput.addEventListener("change",async()=>{
      const file=fileInput.files?.[0];
      if(!file || file.size>5_000_000)return;
      try{
        const data=JSON.parse(await file.text());
        if(data.format!=="mindcrafti-card-backup" || data.version!==2 ||
           !/^[0-9a-f]{64}$/.test(String(data.syncToken||"")) ||
           !data.progress || typeof data.progress!=="object" ||
           Array.isArray(data.progress) || !Array.isArray(data.sessions))
          throw Error("Неверный формат файла или нет ключа синхронизации");
        if(!confirm("Объединить результаты из файла с сохранённой историей этого устройства?"))return;
        const local=read(fields.progress,{});
        for(const [id,state] of Object.entries(data.progress)){
          if(!local[id] || String(state?.updatedAt||"")>String(local[id]?.updatedAt||""))local[id]=state;
        }
        localStorage.setItem(fields.progress,JSON.stringify(local));
        const history=new Map(read(fields.sessions,[]).map(x=>[x.id,x]));
        for(const session of data.sessions)if(session && typeof session.id==="string"){
          const previous=history.get(session.id);
          if(!previous || (session.review?.length||0)>(previous.review?.length||0))
            history.set(session.id,session);
        }
        localStorage.setItem(fields.sessions,JSON.stringify(
          [...history.values()].sort((a,b)=>String(b.completedAt||b.date).localeCompare(String(a.completedAt||a.date))).slice(0,100)));
        const cards=new Map(read(fields.custom,[]).map(x=>[x.id,x]));
        if(Array.isArray(data.custom))for(const c of data.custom)if(c?.id)cards.set(c.id,c);
        localStorage.setItem(fields.custom,JSON.stringify([...cards.values()]));
        for(const key of ["invalid","deleted","overrides"]){
          if(data[key] && typeof data[key]==="object" && !Array.isArray(data[key])){
            localStorage.setItem(fields[key],JSON.stringify({
              ...data[key],...read(fields[key],{})
            }));
          }
        }
        // Both browsers now address the same private account on the server.
        localStorage.setItem(fields.owner,data.syncToken);
        localStorage.setItem(fields.pending,"1");
        alert("История объединена и устройства связаны. После обновления нажми «Синхронизировать сейчас».");
        location.reload();
      }catch(error){alert("Не удалось прочитать копию: "+error.message);}
      finally{fileInput.value="";}
    });
    section.append(title,description,report,exportButton,importButton,fileInput,warning);
    host.append(section);
  }
  window.addEventListener("study-home-rendered",showButtons);
})();