'use strict';
(() => {
  const boot = JSON.parse(document.getElementById('bootstrap-data').textContent);
  const deep = o => JSON.parse(JSON.stringify(o));
  const defaults = {story:deep(boot.story), css:boot.storyCSS, html:boot.storyHTML};
  const STORAGE_KEY = 'mindcrafti-stories-studio-v1';
  const $ = id => document.getElementById(id);
  const colours = [
    ['accent','Акцент'],['ink','Основной текст'],['background','Фон'],
    ['soft','Светлые карточки'],['card','Белые карточки'],['muted','Подписи'],
    ['divider','Разделители'],['decoration','Декор']
  ];
  const ranges = [
    ['title-size','Заголовок',72,122,2,'px'],
    ['subtitle-size','Подзаголовок',34,74,2,'px'],
    ['body-size','Основной текст',24,45,1,'px'],
    ['card-radius','Закругления',8,65,1,'px'],
    ['cards-gap','Интервал',0,55,1,'px'],
    ['hero-top','Начало заголовка',350,470,2,'px']
  ];
  const textFields = [
    ['pill_text','Рубрика',1], ['headline_1','Заголовок: строка 1',1],
    ['headline_2','Заголовок: строка 2',1], ['headline_3','Заголовок: строка 3',1],
    ['subheadline','Подзаголовок',3], ['notice_text','Выделенная новость',4],
    ['section_title','Название карточки',1],['footer_text','Нижняя подпись',1],
    ['brand_subtitle','Текст под логотипом',1]
  ];
  const palette = {
    brand:{accent:'#FF6A00',ink:'#0A2463',background:'#FFFFFF',soft:'#F9EEE5',card:'#FFFFFF',muted:'#8190A5',divider:'#F0DED0',decoration:'#FFF1E5'},
    sand:{accent:'#B96D42',ink:'#352F2D',background:'#FFFDFC',soft:'#F7EDE4',card:'#FFFFFF',muted:'#857A72',divider:'#EAD9C9',decoration:'#F7E3D0'},
    navy:{accent:'#365CC8',ink:'#0B244D',background:'#FFFFFF',soft:'#EAF1FF',card:'#FFFFFF',muted:'#71819A',divider:'#D5DFF2',decoration:'#EDF2FF'}
  };
  const paths = {
    people:'<circle cx="18" cy="15" r="6"/><circle cx="38" cy="16" r="5"/><path d="M5 45v-5a15 15 0 0 1 30 0v5H5zM34 32c9 0 15 6 15 13v0H38"/>',
    cap:'<path d="M3 20L27 8l24 12-24 12L3 20zM12 25v13c9 7 21 7 30 0V25M51 20v19"/>',
    calendar:'<rect x="7" y="12" width="40" height="38" rx="5"/><path d="M16 5v14M38 5v14M7 24h40M16 32h4M27 32h4M38 32h2M16 40h4M27 40h4"/>',
    document:'<path d="M14 5h24l10 10v35H14zM38 5v13h10M21 26h21M21 34h21M21 42h14"/>',
    clock:'<circle cx="27" cy="28" r="22"/><path d="M27 14v15l12 7"/>',
    plane:'<path d="M5 25L50 6 35 51 26 31 5 25zM26 31L50 6"/>',
    folder:'<path d="M5 18V12h17l8 7h20v26H5z"/>',
    check:'<circle cx="27" cy="27" r="22"/><path d="M15 28l8 8 16-18"/>',
    book:'<path d="M4 12c9-5 17-4 23 0 6-4 14-5 23 0v35c-9-5-17-4-23 0-6-4-14-5-23 0V12zM27 12v35"/>'
  };
  const iconSvg = name => '<svg xmlns="http://www.w3.org/2000/svg" class="icon" viewBox="0 0 56 56" aria-hidden="true">'+(paths[name]||paths.document)+'</svg>';
  const escapeHtml = x => String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let project = deep(defaults);
  let activeCode = 'css';
  let renderTimer = 0;
  let editTimer = 0;
  let zoomScale = 0;
  let projectDirty = false;
  let pendingChecks = 0;
  let toastTimer = 0;
  let studioHydrated = false;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const p=JSON.parse(saved);
      if (p && typeof p.css==='string' && typeof p.html==='string' && p.story) project=p;
    }
  } catch(e) { console.info('local draft unavailable',e); }

  function toCssVar(prop){return '--'+prop;}
  function getCSS(name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp(escaped+'\\s*:\\s*([^;]+);');return project.css.match(re)?.[1]?.trim()||'';}
  function patchCSS(name,value){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp('('+escaped+'\\s*:\\s*)([^;]+)(;)');
    if(re.test(project.css))project.css=project.css.replace(re,(_a,p,_v,t)=>p+value+t);
    else project.css=project.css.replace(':root {',':root {\n  '+name+': '+value+';');
  }
  function syncStoryTheme(){
    project.story.theme ||= {};
    for (const [key] of colours) project.story.theme[key]=getCSS(toCssVar(key));
    for (const [key] of ranges) project.story.theme[key]=getCSS(toCssVar(key));
  }
  function hexOk(hex){return /^#[0-9A-Fa-f]{6}$/.test(String(hex));}
  function blendHex(hex,p){
    const a=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    return '#'+a.map(v=>Math.round(v+(255-v)*p).toString(16).padStart(2,'0')).join('').toUpperCase();
  }
  function setDesign(name,value,opt={}){
    patchCSS(toCssVar(name),value);
    if(name==='accent' && !opt.skipShades && hexOk(value)){
      patchCSS('--soft',blendHex(value,.915));
      patchCSS('--divider',blendHex(value,.79));
      patchCSS('--decoration',blendHex(value,.945));
    }
    projectDirty=true;
    syncStoryTheme();
    updateControls();
    queueRender();
  }
  function compileBody(){
    const s=project.story;
    const variables={
      layout_class:'layout-'+(s.layout||'editorial'),
      safe_class:s.showSafe?'show-safe':'',
      logo_src:boot.logoSrc,
      brand_subtitle:s.brand_subtitle,
      pill_icon_svg:iconSvg(s.pill_icon||'people'),
      pill_text:s.pill_text,
      headline_1:s.headline_1, headline_2:s.headline_2,headline_3:s.headline_3,
      subheadline:s.subheadline,notice_icon_svg:iconSvg(s.notice_icon||'calendar'),
      notice_text:s.notice_text,section_title:s.section_title,footer_text:s.footer_text,
      photo_block:s.photoEnabled && s.photoData? '<img class="photo-cutout" src="'+escapeHtml(s.photoData)+'" alt="Фоновое изображение"/>':'',
      item_1_text:s.items?.[0]?.text||'',item_2_text:s.items?.[1]?.text||'',item_3_text:s.items?.[2]?.text||'',
      item_1_icon_svg:iconSvg(s.items?.[0]?.icon||'document'),
      item_2_icon_svg:iconSvg(s.items?.[1]?.icon||'clock'),
      item_3_icon_svg:iconSvg(s.items?.[2]?.icon||'plane')
    };
    return project.html.replace(/\{\{([\w.]+)\}\}/g,(_x,key)=>{
      if(!(key in variables)) return '';
      if(key.endsWith('_svg')||key==='photo_block'||key==='logo_src'||key==='layout_class'||key==='safe_class')return variables[key];
      return escapeHtml(variables[key]);
    });
  }
  function outputDocument(forExport=false){
    let css=project.css;
    if(forExport){css+='\n@page{size:1080px 1920px;margin:0}html,body{width:1080px;height:1920px;padding:0;margin:0}';}
    return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,initial-scale=1"><style>${css}</style></head><body>${compileBody()}</body></html>`;
  }
  function validation(){
    const frame=$('storyFrame');
    try{
      const doc=frame.contentDocument;
      if(!doc || !doc.querySelector('.story'))return;
      const issues=[];
      for(const sel of ['.pill-label','.headlines','.headline','.subheadline','.announcement-text','.section-pill','.item-text']){
        for(const el of doc.querySelectorAll(sel)){
          if(el.scrollWidth>el.clientWidth+10)issues.push('Текст выходит за границы: '+sel);
        }
      }
      const blocks=['.pill','.headlines','.subheadline','.announcement','.info-card'];
      for(const sel of blocks){const el=doc.querySelector(sel);if(el){const r=el.getBoundingClientRect();if(r.right>1080+2||r.left<-2||r.bottom>1920+2)issues.push('Блок вне холста: '+sel);}}
      const sub=doc.querySelector('.subheadline');const ann=doc.querySelector('.announcement');
      if(sub&&ann&&sub.getBoundingClientRect().bottom>ann.getBoundingClientRect().top-14)issues.push('Подзаголовок налезает на новость');
      const info=doc.querySelector('.info-card');
      if(info&&ann&&ann.getBoundingClientRect().bottom>info.getBoundingClientRect().top-10)issues.push('Карточки слишком близко друг к другу');
      if(project.story.safeMode==='strict'){const b=info?.getBoundingClientRect(); if(b && b.bottom>1570)issues.push('Контент ниже строгой безопасной зоны (350 px снизу)');}
      if(issues.length){$('previewStatus').textContent=issues[0]+' · '+issues.length+' замечаний';$('previewStatus').classList.add('warning');}
      else{$('previewStatus').textContent='✓ Все основные элементы помещаются · 1080 × 1920';$('previewStatus').classList.remove('warning');}
    }catch(e){$('previewStatus').textContent='Открой редактор по HTTPS, чтобы проверить вёрстку';}
  }
  function queueRender(){clearTimeout(renderTimer);renderTimer=setTimeout(renderNow,90);}
  function renderNow(){
    syncSafeSettings();
    const frame=$('storyFrame');
    frame.onload=()=>{validation();};
    frame.srcdoc=outputDocument(false);
    refreshCode();
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(project));$('savedState').innerHTML='<span class="status-dot"></span> Сохранено локально';}catch(e){$('savedState').textContent='Локальное сохранение недоступно';}
    validateColors();
    if (studioHydrated && window.parent !== window) {
      window.parent.postMessage({ type: 'mindcrafti-studio:save', payload: JSON.stringify(project) }, '*');
    }
  }
  function syncSafeSettings(){
    if(project.story.safeMode==='strict'){
      patchCSS('--safe-top','250px');patchCSS('--safe-bottom','350px');
    } else {patchCSS('--safe-top','125px');patchCSS('--safe-bottom','125px');}
    if(project.story.photoEnabled)patchCSS('--photo-opacity','0.24');
    else patchCSS('--photo-opacity','0');
  }
  function fitPreview(){
    const host=$('previewStage');
    const s=Math.min((host.clientWidth-45)/1080,(host.clientHeight-34)/1920);
    zoomScale=Math.max(.12,s);
    const holder=$('previewHolder');
    holder.style.width=String(Math.floor(1080*zoomScale))+'px';
    holder.style.height=String(Math.floor(1920*zoomScale))+'px';
    $('storyFrame').style.transform='scale('+zoomScale+')';
    $('previewScale').textContent='Масштаб: '+Math.round(zoomScale*100)+'%';
  }
  function fillColorControls(){
    $('colorControls').innerHTML=colours.map(([name,label])=>
      `<div class="color-row"><label class="control-label" for="color_${name}">${label}</label><input class="color-input" type="color" id="color_${name}" data-color="${name}"/><input class="hex-input" type="text" id="hex_${name}" data-hex="${name}" maxlength="7" spellcheck="false"/></div>`
    ).join('');
    $('colorControls').addEventListener('input',e=>{const id=e.target.dataset.color;if(id)setDesign(id,e.target.value.toUpperCase());});
    $('colorControls').addEventListener('change',e=>{const id=e.target.dataset.hex;if(!id)return;const v=e.target.value.trim().toUpperCase();if(hexOk(v)){setDesign(id,v);e.target.classList.remove('invalid');}else{e.target.classList.add('invalid');toast('Цвет указывается как #RRGGBB');}});
  }
  function fillRanges(){
    $('rangeControls').innerHTML=ranges.map(([k,label,min,max,step,u])=>`<div class="range-field"><div class="range-heading"><label for="range_${k}">${label}</label><strong id="display_${k}"></strong></div><input id="range_${k}" type="range" data-range="${k}" min="${min}" max="${max}" step="${step}"/><div class="range-minmax"><span>${min}${u}</span><span>${max}${u}</span></div></div>`).join('');
    $('rangeControls').addEventListener('input',e=>{const id=e.target.dataset.range;if(id)setDesign(id,e.target.value+'px',{skipShades:true});});
  }
  function fillContent(){
    $('textControls').innerHTML=textFields.map(([k,label,rows])=>`<label class="text-field"><span class="control-label">${label}</span>${rows===1?`<input data-content="${k}" type="text"/>`:`<textarea rows="${rows}" data-content="${k}"></textarea>`}</label>`).join('');
    $('itemControls').innerHTML=[0,1,2].map(i=>`<label class="text-field"><span class="control-label">Пункт ${i+1}</span><textarea rows="2" data-item="${i}"></textarea></label>`).join('');
    $('contentControls').addEventListener('input',e=>{
      if(e.target.dataset.content){project.story[e.target.dataset.content]=e.target.value;queueRender();}
      if(e.target.dataset.item!==undefined){project.story.items[Number(e.target.dataset.item)].text=e.target.value;queueRender();}
    });
  }
  function updateControls(){
    for(const [k] of colours){const value=getCSS(toCssVar(k));if(hexOk(value)){$('color_'+k).value=value;$('hex_'+k).value=value.toUpperCase();}}
    for(const [k] of ranges){let size=parseInt(getCSS(toCssVar(k)),10);if(isFinite(size)){const slider=$('range_'+k);slider.value=String(size);$('display_'+k).textContent=String(size)+'px';}}
    for(const [k] of textFields){const el=document.querySelector('[data-content="'+k+'"]');if(el&&document.activeElement!==el)el.value=project.story[k]||'';}
    for(const i of [0,1,2]){const el=document.querySelector('[data-item="'+i+'"]');if(el&&document.activeElement!==el)el.value=project.story.items?.[i]?.text||'';}
    $('layoutSelect').value=project.story.layout||'editorial';
    $('safeGuides').checked=!!project.story.showSafe;
    $('safeModeSelect').value=project.story.safeMode||'standard';
    $('photoToggle').checked=!!project.story.photoEnabled;
    for(const b of document.querySelectorAll('[data-preset]')){
      const key=b.dataset.preset;
      const match=Object.entries(palette[key]).every(([k,v])=>getCSS(toCssVar(k)).toUpperCase()===v.toUpperCase());
      b.classList.toggle('active',match);
    }
  }
  function validateColors(){
    const errors=[];
    for(const [k] of colours){const v=getCSS(toCssVar(k));if(!hexOk(v))errors.push(k+'='+v);}
    $('codeState').textContent=errors.length?'● Проверить CSS':'● Синхронизировано';
    $('codeState').style.color=errors.length?'#dc6a2c':'#1faa76';
  }
  function refreshCode(){
    const src=activeCode==='css'?project.css:(activeCode==='html'?project.html:JSON.stringify(project.story,null,2));
    if(document.activeElement!==$('codeEditor')){$('codeEditor').value=src;updateGutter();}
  }
  function updateGutter(){
    const ed=$('codeEditor');const lines=ed.value.split('\n').length;
    $('editorGutter').textContent=Array.from({length:lines},(_,i)=>i+1).join('\n');
  }
  function changeCodeTab(which){
    activeCode=which;for(const b of document.querySelectorAll('.code-tab'))b.classList.toggle('active',b.dataset.code===which);
    $('codeError').classList.add('hidden');
    $('codeEditor').blur();refreshCode();$('codeEditor').scrollTop=0;
  }
  function applyCode(){
    const value=$('codeEditor').value;
    if(activeCode==='css'){
      project.css=value;
      syncStoryTheme();
      updateControls();
    }else if(activeCode==='html'){
      project.html=value;
    }else{
      let parsed;
      try{parsed=JSON.parse(value);}catch(e){$('codeError').textContent='Неверный JSON: '+e.message;$('codeError').classList.remove('hidden');return;}
      if(!parsed||typeof parsed!=='object'||!Array.isArray(parsed.items)){
        $('codeError').textContent='В JSON должен быть объект с полем items (3 элемента).';$('codeError').classList.remove('hidden');return;
      }
      project.story=parsed;
      if(parsed.theme&&typeof parsed.theme==='object')for(const [k,v] of Object.entries(parsed.theme)){
        if(typeof v==='string' && (colours.some(x=>x[0]===k)||ranges.some(x=>x[0]===k)))patchCSS(toCssVar(k),v);
      }
      updateControls();
    }
    $('codeError').classList.add('hidden');
    queueRender();
  }
  function downloadBlob(blob,filename){
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  }
  function downloadText(text,filename,mime='text/plain;charset=utf-8'){downloadBlob(new Blob([text],{type:mime}),filename);}
  function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3200);}
  function exportProject(){syncStoryTheme();downloadText(JSON.stringify({schema:'mindcrafti.story-studio/1',...project},null,2),'mindcrafti-story-project.json','application/json;charset=utf-8');toast('Проект JSON сохранён');}
  function loadProject(obj){
    if(obj?.story && typeof obj.css==='string' && typeof obj.html==='string'){project={story:obj.story,css:obj.css,html:obj.html};updateControls();renderNow();toast('Проект загружен');return;}
    if(obj&&obj.headline_1){project.story=obj;updateControls();renderNow();toast('Содержание обновлено');return;}
    throw new Error('Нужен JSON проекта Mindcrafti или содержания новости');
  }
  async function shareLink(){
    if(location.protocol==='file:' || location.origin==='null'){exportProject();toast('Для общей ссылки нужно HTTPS-размещение. Пока скачан проект JSON.');return null;}
    syncStoryTheme();
    let obj=deep(project);
    if(obj.story.photoData&&obj.story.photoData.length>40000){delete obj.story.photoData;toast('Для короткой ссылки фотография исключена: её можно сохранить в файле проекта');}
    const buf=new TextEncoder().encode(JSON.stringify(obj));
    let packed=buf, prefix='u';
    if(typeof CompressionStream==='function'){
      const compressed=await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
      packed=new Uint8Array(compressed);prefix='g';
    }
    let binary='';for(const byte of packed)binary+=String.fromCharCode(byte);
    const fragment=prefix+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const url=location.origin+location.pathname+'#design='+fragment;
    try{await navigator.clipboard.writeText(url);toast('Ссылка на этот дизайн скопирована');}
    catch(e){window.prompt('Скопируй ссылку на дизайн:',url);}
    return url;
  }
  async function loadHash(){
    const hash=location.hash;if(!hash.startsWith('#design='))return;
    try{
      const txt=hash.slice(8);const mode=txt[0];const b64=txt.slice(1).replace(/-/g,'+').replace(/_/g,'/');
      const binary=atob(b64.padEnd(Math.ceil(b64.length/4)*4,'='));const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
      let final=bytes;
      if(mode==='g')final=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      const object=JSON.parse(new TextDecoder().decode(final));loadProject(object);toast('Дизайн открыт по общей ссылке');
    }catch(e){console.warn(e);toast('Не удалось открыть данные из ссылки');}
  }
  async function copyCurrentCode(){try{await navigator.clipboard.writeText($('codeEditor').value);toast('Код скопирован');}catch(e){toast('Выдели и скопируй код вручную');}}
  async function downloadPng(){
    const button=$('exportPngBtn');button.disabled=true;button.textContent='Готовим PNG…';
    try{
      const svgMarkup=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><foreignObject x="0" y="0" width="1080" height="1920"><div xmlns="http://www.w3.org/1999/xhtml" style="width:1080px;height:1920px;"><style>${project.css.replace(/<\/style>/gi,'')}</style>${compileBody()}</div></foreignObject></svg>`;
      const svgURL='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgMarkup);
      const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('SVG image could not render'));img.src=svgURL;});
      const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,1080,1920);context.drawImage(img,0,0);
      const png=await new Promise(res=>canvas.toBlob(res,'image/png'));
      if(!png)throw new Error('Не удалось сформировать PNG');
      downloadBlob(png,'mindcrafti-story.png');toast('PNG 1080 × 1920 сохранён');
    }catch(e){console.error(e);downloadText(outputDocument(true),'mindcrafti-story.html','text/html');toast('PNG недоступен в этом браузере. Скачан HTML для печати.');}
    finally{button.disabled=false;button.innerHTML='<span>↧</span> Скачать PNG';}
  }
  function importPhoto(file){
    if(!file)return;
    const reader=new FileReader();reader.onload=()=>{
      const image=new Image();image.onload=()=>{
        const canvas=document.createElement('canvas');const s=Math.min(950/image.width,1200/image.height,1);
        canvas.width=Math.round(image.width*s);canvas.height=Math.round(image.height*s);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        project.story.photoData=canvas.toDataURL('image/jpeg',.83);project.story.photoEnabled=true;updateControls();renderNow();toast('Фотография добавлена');
      };image.src=reader.result;
    };reader.readAsDataURL(file);
  }
  function exportPrompt(){
    const s=project.story;const msg=`Помоги мне настроить фирменный генератор Instagram Stories Mindcrafti. Используй фиксированные цвета, размеры и CSS. НЕ публикуй сторис без моего одобрения. ${location.protocol==='file:'?'Сейчас редактор открыт локально, поэтому через облачный браузер ChatGPT эта ссылка недоступна. Для управления через ChatGPT Work требуется HTTPS-размещение.':'Мой редактор доступен по адресу: '+location.href}\n\nТекущий стиль: акцент ${getCSS('--accent')}, текст ${getCSS('--ink')}, заголовок ${getCSS('--title-size')}. Тема: ${s.headline_1} ${s.headline_2} ${s.headline_3}.`;
    navigator.clipboard.writeText(msg).then(()=>toast('Инструкция для ChatGPT скопирована'),()=>window.prompt('Скопируй текст:',msg));
  }
  function bindEvents(){
    for(const b of document.querySelectorAll('.seg'))b.onclick=()=>{
      const design=b.dataset.mode==='design';$('designControls').classList.toggle('hidden',!design);$('contentControls').classList.toggle('hidden',design);
      for(const bt of document.querySelectorAll('.seg'))bt.classList.toggle('active',bt===b);
    };
    for(const b of document.querySelectorAll('[data-preset]'))b.onclick=()=>{
      const selected=palette[b.dataset.preset];for(const [k,v] of Object.entries(selected))patchCSS(toCssVar(k),v);
      syncStoryTheme();updateControls();queueRender();toast('Тема применена');
    };
    $('layoutSelect').onchange=e=>{project.story.layout=e.target.value;queueRender();};
    $('safeGuides').onchange=e=>{project.story.showSafe=e.target.checked;queueRender();};
    $('safeModeSelect').onchange=e=>{project.story.safeMode=e.target.value;queueRender();};
    $('photoToggle').onchange=e=>{project.story.photoEnabled=e.target.checked;queueRender();};
    $('photoInput').onchange=e=>importPhoto(e.target.files?.[0]);
    $('resetBtn').onclick=()=>{if(!confirm('Вернуть исходные цвета, текст и код?'))return;project=deep(defaults);updateControls();renderNow();toast('Исходный стиль восстановлен');};
    $('saveProjectBtn').onclick=exportProject;
    $('importProjectBtn').onclick=()=>$('importFile').click();
    $('importFile').onchange=async e=>{try{const file=e.target.files?.[0];if(file)loadProject(JSON.parse(await file.text()));}catch(err){toast('Ошибка импорта: '+err.message);}};
    $('shareBtn').onclick=shareLink;
    $('exportPngBtn').onclick=downloadPng;
    $('copyPromptBtn').onclick=exportPrompt;
    $('fitBtn').onclick=fitPreview;
    $('copyCodeBtn').onclick=copyCurrentCode;
    for(const b of document.querySelectorAll('.code-tab'))b.onclick=()=>changeCodeTab(b.dataset.code);
    $('codeEditor').oninput=()=>{updateGutter();clearTimeout(editTimer);editTimer=setTimeout(applyCode,290);};
    $('codeEditor').onscroll=()=>{$('editorGutter').scrollTop=$('codeEditor').scrollTop;};
    $('codeEditor').onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const t=e.target;const a=t.selectionStart,b=t.selectionEnd;t.setRangeText('  ',a,b,'end');t.dispatchEvent(new Event('input'));}};
    $('revertCodeBtn').onclick=()=>{if(activeCode==='json')project.story=deep(defaults.story);else if(activeCode==='css')project.css=defaults.css;else project.html=defaults.html;updateControls();$('codeEditor').blur();refreshCode();renderNow();toast('Правка этой вкладки отменена');};
    $('downloadCodeBtn').onclick=()=>{const mapping={css:'story.css',json:'story.json',html:'story.html'};downloadText($('codeEditor').value,mapping[activeCode]);};
    $('showCodeMobile').onclick=()=>{$('codePanel').classList.add('show-mobile');$('showCodeMobile').classList.add('active');$('showPreviewMobile').classList.remove('active');};
    $('showPreviewMobile').onclick=()=>{$('codePanel').classList.remove('show-mobile');$('showCodeMobile').classList.remove('active');$('showPreviewMobile').classList.add('active');};
    new ResizeObserver(fitPreview).observe($('previewStage'));
    window.addEventListener('hashchange',loadHash);
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();exportProject();}});
  }
  function init(){
    // A saved design still uses the current, official Mindcrafti M logo asset.
    project.story.items ||= deep(defaults.story.items);
    project.story.layout ||= 'editorial';project.story.safeMode ||= 'standard';
    fillColorControls();fillRanges();fillContent();bindEvents();syncStoryTheme();updateControls();renderNow();fitPreview();loadHash();
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !event.data || event.data.type !== 'mindcrafti-studio:hydrate') return;
    if (studioHydrated) return;
    studioHydrated = true;
    const incoming = event.data.payload;
    if (typeof incoming === 'string' && incoming.length && incoming.length < 2000000) {
      try { loadProject(JSON.parse(incoming)); }
      catch (e) { console.warn('Unable to restore studio project', e); renderNow(); }
    } else {
      renderNow();
    }
  });
  init();
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'mindcrafti-studio:ready' }, '*');
  } else {
    studioHydrated = true;
  }
})();
