/* Portable, user-controlled recovery file for study-card history. */
(() => {
  "use strict";
  const fields = {
    progress: "personal-study-map:quiz-card-progress:v1",
    sessions: "personal-study-map:quiz-session-history:v1",
    custom: "personal-study-map:custom-flashcards:v2"
  };
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
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
    description.textContent = "Скачай историю на компьютере и восстанови её на телефоне. Исходные данные останутся на компьютере.";
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
      const content = {format:"mindcrafti-card-backup",version:1,
        createdAt:new Date().toISOString(),
        progress:read(fields.progress,{}),sessions:read(fields.sessions,[]),
        custom:read(fields.custom,[])};
      const url = URL.createObjectURL(new Blob([JSON.stringify(content)],{type:"application/json"}));
      const link = document.createElement("a");
      link.href=url; link.download="my-skills-cards-backup.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
    });
    importButton.addEventListener("click",()=>fileInput.click());
    fileInput.addEventListener("change",async()=>{
      const file=fileInput.files?.[0];
      if(!file || file.size>5_000_000)return;
      try{
        const data=JSON.parse(await file.text());
        if(data.format!=="mindcrafti-card-backup" || data.version!==1 ||
           !data.progress || typeof data.progress!=="object" ||
           !Array.isArray(data.sessions))throw Error("Неверный формат файла");
        if(!confirm("Объединить результаты из файла с сохранённой историей этого устройства?"))return;
        const local=read(fields.progress,{});
        for(const [id,state] of Object.entries(data.progress)){
          if(!local[id] || String(state?.updatedAt||"")>String(local[id]?.updatedAt||""))local[id]=state;
        }
        localStorage.setItem(fields.progress,JSON.stringify(local));
        const history=new Map(read(fields.sessions,[]).map(x=>[x.id,x]));
        for(const session of data.sessions)if(session && typeof session.id==="string")history.set(session.id,session);
        localStorage.setItem(fields.sessions,JSON.stringify(
          [...history.values()].sort((a,b)=>String(b.completedAt||b.date).localeCompare(String(a.completedAt||a.date))).slice(0,100)));
        const cards=new Map(read(fields.custom,[]).map(x=>[x.id,x]));
        if(Array.isArray(data.custom))for(const c of data.custom)if(c?.id)cards.set(c.id,c);
        localStorage.setItem(fields.custom,JSON.stringify([...cards.values()]));
        alert("Результаты объединены. Открой карточки после обновления страницы.");
        location.reload();
      }catch(error){alert("Не удалось прочитать копию: "+error.message);}
      finally{fileInput.value="";}
    });
    section.append(title,description,exportButton,importButton,fileInput);
    host.append(section);
  }
  window.addEventListener("study-home-rendered",showButtons);
})();