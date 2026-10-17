(()=>{"use strict";
const api="https://personal-life-api-production.up.railway.app/api/study-prompts";
const tokenKey="personal-study-map:owner-token:v1";
const dialog=document.getElementById("study-settings-dialog");
const open=document.getElementById("study-settings-open"),close=document.getElementById("study-settings-close");
const select=document.getElementById("study-settings-select"),area=document.getElementById("study-settings-content");
const save=document.getElementById("study-settings-save"),status=document.getElementById("study-settings-status");
if(!dialog||!open||!select)return;
let prompts=[];
function token(){let t=localStorage.getItem(tokenKey);if(!/^[a-f0-9]{64}$/.test(t||"")){t=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");localStorage.setItem(tokenKey,t);}return t;}
async function request(method,url,body){const r=await fetch(url,{method,headers:{"Authorization":"Bearer "+token(),"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||data.error||"Ошибка сервера ("+r.status+")");return data;}
function showSelected(){const p=prompts.find(x=>x.key===select.value);area.value=p?.content||"";status.textContent="";}
open.addEventListener("click",async()=>{dialog.hidden=false;status.textContent="Загрузка…";try{const result=await request("GET",api);prompts=result.prompts||[];select.innerHTML="";for(const p of prompts){const option=document.createElement("option");option.value=p.key;option.textContent=p.title;select.appendChild(option);}showSelected();}catch(e){status.textContent=e.message;}});
close.addEventListener("click",()=>dialog.hidden=true);
dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.hidden=true;});
select.addEventListener("change",showSelected);
save.addEventListener("click",async()=>{const key=select.value;if(!key||!area.value.trim())return;save.disabled=true;status.textContent="Сохранение…";try{const result=await request("PUT",api+"/"+encodeURIComponent(key),{content:area.value});const i=prompts.findIndex(x=>x.key===key);if(i>=0)prompts[i]=result.prompt;status.textContent="Сохранено на сервере";}catch(e){status.textContent=e.message;}finally{save.disabled=false;}});
})();