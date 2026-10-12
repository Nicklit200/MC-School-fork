/* Study Map opt-in web push reminders, Europe/Berlin mornings.
 * Push only works on iOS when opened from Add to Home Screen.
 * Card dates remain in the browser and are copied to the server only on opt-in.
 */
(() => {
  "use strict";
  const API="https://personal-life-api-production.up.railway.app";
  const KEY_TOKEN="personal-study-map:push-device-token:v1";
  const KEY_ENABLED="personal-study-map:push-enabled:v1";
  const KEY_HOUR="personal-study-map:push-hour:v1";
  const KEY_PROGRESS="personal-study-map:quiz-card-progress:v1";
  const KEY_CUSTOM="personal-study-map:custom-flashcards:v2";
  const KEY_OLD_CUSTOM="personal-study-map:custom-flashcards:v1";
  const KEY_OVERRIDES="personal-study-map:card-overrides:v1";
  const hourChoices=[7,8,9,10,11];
  let busy=false;
  let localNotice="";
  let lastSync=0;

  const el=id=>document.getElementById(id);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const read=(key,otherwise)=>{try{
    const s=localStorage.getItem(key);
    return s===null?otherwise:JSON.parse(s);
  }catch{return otherwise;}};
  const today=()=> {
    const d=new Date();
    const part=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",
      year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
    const get=key=>part.find(p=>p.type===key)?.value||"";
    return get("year")+"-"+get("month")+"-"+get("day");
  };
  const isInstalled=()=>window.matchMedia?.("(display-mode: standalone)").matches
    || navigator.standalone===true;
  const canPush=()=>"serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;
  const isAppleMobile=()=>/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints>1);
  const settingsHour=()=> {
    const v=Number(read(KEY_HOUR,9));
    return hourChoices.includes(v)?v:9;
  };
  function deviceToken(){
    let token=localStorage.getItem(KEY_TOKEN);
    if(token && /^[A-Za-z0-9_-]{32,128}$/.test(token))return token;
    const buf=new Uint8Array(32);
    crypto.getRandomValues(buf);
    token=[...buf].map(x=>x.toString(16).padStart(2,"0")).join("");
    localStorage.setItem(KEY_TOKEN,token);
    return token;
  }
  function getAllExams(){
    const list=window.studyBoardCards?.allExams?.();
    if(Array.isArray(list)&&list.length)return list;
    const single=window.studyBoardCards?.context?.()?.exam;
    return single?[single]:[];
  }
  function gather(){
    const rawProgress=read(KEY_PROGRESS,{});
    const rawOverrides=read(KEY_OVERRIDES,{});
    const rawCustom=read(KEY_CUSTOM,read(KEY_OLD_CUSTOM,[]));
    const progress=rawProgress && typeof rawProgress==="object"?rawProgress:{};
    const overrides=rawOverrides&&typeof rawOverrides==="object"?rawOverrides:{};
    const custom=Array.isArray(rawCustom)?rawCustom:[];
    const all=[],knownSkills=new Map();
    for(const exam of getAllExams()) {
      for(const skill of exam.skills||[]){
        knownSkills.set(skill.id,exam.title||"Учёба");
        for(const card of skill.flashcards||[]){
          if(overrides[card.id]?.hidden)continue;
          const item=progress[card.id];
          all.push({id:card.id,dueDate:item?.dueDate||today(),subject:exam.title||"Учёба"});
        }
      }
    }
    for(const card of custom) {
      if(card.hidden || !knownSkills.has(card.skillId))continue;
      const item=progress[card.id];
      all.push({id:card.id,dueDate:item?.dueDate||today(),subject:knownSkills.get(card.skillId)});
    }
    const unique=new Map(all.map(item=>[item.id,item]));
    return [...unique.values()];
  }
  function counts(){
    const schedule=gather(),current=today();
    const due=schedule.filter(item=>item.dueDate<=current);
    const future=schedule.filter(item=>item.dueDate>current).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
    const subjects={};
    for(const item of due) subjects[item.subject]=(subjects[item.subject]||0)+1;
    return {total:schedule.length,due:due.length,subjects,next:future[0]?.dueDate||null};
  }
  function pushEnabled(){return localStorage.getItem(KEY_ENABLED)==="yes";}
  async function api(path,body=null){
    const result=await fetch(API+path,{
      method:body===null?"GET":"POST",
      ...(body===null?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),
      cache:"no-store"
    });
    let data={};
    try{data=await result.json();}catch{}
    if(!result.ok)throw new Error(data?.error||"Сервер вернул ошибку "+result.status);
    return data;
  }
  function urlB64ToBytes(value) {
    const padding="=".repeat((4-value.length%4)%4);
    const binary=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  async function registerWorker(){
    await navigator.serviceWorker.register("/sw.js",{scope:"/"});
    return navigator.serviceWorker.ready;
  }
  async function updateSubscription(){
    const reg=await registerWorker();
    const subscription=await reg.pushManager.getSubscription();
    if(!subscription)throw new Error("Подписка не найдена. Включи напоминания заново.");
    return api("/api/push/subscribe",{
      deviceToken:deviceToken(),subscription:subscription.toJSON(),
      schedule:gather(),hour:settingsHour()
    });
  }
  async function sync(options={}){
    if(!pushEnabled()||busy)return;
    if(!options.force && Date.now()-lastSync<120000)return;
    lastSync=Date.now();
    try{
      await api("/api/push/sync",{deviceToken:deviceToken(),schedule:gather()});
    }catch(error){
      lastSync=0;
      if(options.showError){localNotice="Не удалось синхронизировать: "+error.message;render();}
      console.warn("Study reminder sync unavailable",error);
    }
  }
  function render(){
    const host=el("study-reminder-settings");
    if(!host)return;
    const c=counts(),enabled=pushEnabled(),installed=isInstalled(),supported=canPush();
    const permission=typeof Notification==="undefined"?"unsupported":Notification.permission;
    const fmt=date=>date ? date.split("-").reverse().join(".") : "—";
    const options=hourChoices.map(v=>'<option value="'+v+'"'+(settingsHour()===v?" selected":"")+
      '>'+String(v).padStart(2,"0")+':00</option>').join("");
    const status=enabled?"Включены":"Выключены";
    host.innerHTML=
      '<div class="study-reminder-heading"><h3>Утренние напоминания</h3>'+
      '<span class="'+(enabled?"active":"inactive")+'">'+status+'</span></div>'+
      '<p class="study-reminder-lead">По расписанию повторений: <strong>'+
      c.due+' из '+c.total+'</strong> карточек к повторению сегодня.</p>'+
      (c.next?'<p class="study-reminder-next">Следующее повторение: '+fmt(c.next)+'</p>':"")+
      '<div class="study-reminder-row"><label for="study-push-hour">Напоминать утром</label>'+
      '<select id="study-push-hour" aria-label="Час напоминания"'+(busy?' disabled':'')+'>'+options+'</select>'+
      '<span>по Германии</span></div>'+
      (!installed && isAppleMobile()?
        '<p class="study-reminder-warning"><strong>Чтобы получать уведомления при закрытом сайте:</strong> открой сайт в Safari → Поделиться → «На экран Домой» → открой созданный ярлык. В ярлыке появится кнопка включения.</p>':
       !supported?
        '<p class="study-reminder-warning">Этот браузер не поддерживает push-уведомления. Используй актуальный Safari на iPhone или iPad.</p>':
        '<div class="study-reminder-actions">'+
        (enabled?
          '<button data-push-action="test" type="button"'+(busy?' disabled':'')+'>Проверить уведомление</button>'+
          '<button data-push-action="disable" type="button"'+(busy?' disabled':'')+'>Выключить</button>':
          '<button data-push-action="enable" class="primary" type="button"'+(busy?' disabled':'')+
          '>Включить уведомления</button>')+
        '</div>')+
      (permission==="denied"?'<p class="study-reminder-warning">Уведомления запрещены в настройках устройства. Разреши их для «Моих навыков».</p>':"")+
      '<p class="study-reminder-footnote">Напоминание приходит, если есть карточки к повторению. Интервалы: 1, 2, 4, 7, 14, 30 дней. Изменения синхронизируются при открытии сайта.</p>'+
      (localNotice?'<p class="study-reminder-notice" role="status">'+esc(localNotice)+'</p>':"");
  }
  async function runAction(action) {
    if(busy)return;
    busy=true;localNotice="";render();
    try{
      if(action==="enable"){
        if(!canPush())throw new Error("Push не поддерживается в этом браузере.");
        if(!isInstalled() && isAppleMobile()){
          throw new Error("Сначала добавь сайт на экран Домой и открой ярлык.");
        }
        // Permission must be requested from a direct user action.
        const permission=await Notification.requestPermission();
        if(permission!=="granted")throw new Error("Не получено разрешение на уведомления.");
        const registration=await registerWorker();
        const config=await api("/api/push/config");
        const current=await registration.pushManager.getSubscription();
        const subscription=current||await registration.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:urlB64ToBytes(config.publicKey)
        });
        await api("/api/push/subscribe",{
          deviceToken:deviceToken(),subscription:subscription.toJSON(),
          schedule:gather(),hour:settingsHour()
        });
        localStorage.setItem(KEY_ENABLED,"yes");
        localNotice="Готово! Уведомления включены. Отправь тест, чтобы проверить.";
      } else if(action==="disable"){
        await api("/api/push/unsubscribe",{deviceToken:deviceToken()});
        localStorage.removeItem(KEY_ENABLED);
        localNotice="Уведомления отключены.";
      } else if(action==="test"){
        await api("/api/push/test",{deviceToken:deviceToken()});
        localNotice="Проверочное уведомление отправлено на устройство.";
      } else if(action==="change-hour"){
        if(pushEnabled()){
          await updateSubscription();
          localNotice="Время напоминания обновлено.";
        }
      }
    } catch(e){localNotice="Ошибка: "+(e?.message||String(e));}
    finally{busy=false;lastSync=0;render();}
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest?.("[data-push-action]");
    if(!button)return;
    const action=button.dataset.pushAction;
    if(["enable","disable","test"].includes(action))runAction(action);
  });
  document.addEventListener("change",event=>{
    if(event.target.id!=="study-push-hour")return;
    const hour=Number(event.target.value);
    if(!hourChoices.includes(hour))return;
    localStorage.setItem(KEY_HOUR,JSON.stringify(hour));
    runAction("change-hour");
  });
  window.addEventListener("study-home-rendered",()=>{render();sync();});
  window.addEventListener("study-reviews-updated",()=>{render();sync({force:true});});
  window.addEventListener("study-context-updated",()=>{render();sync();});
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"){render();sync();}
  });
  render();
  setTimeout(()=>sync(),1200);
  window.studyReminderStatus={counts,sync,render};
})();
