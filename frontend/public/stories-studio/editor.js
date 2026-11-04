'use strict';
(() => {
  const boot = JSON.parse(document.getElementById('bootstrap-data').textContent);
  const deep = o => JSON.parse(JSON.stringify(o));
  const defaults = {story:deep(boot.story), css:boot.storyCSS, html:boot.storyHTML};
  const progressDefaults = JSON.parse(document.getElementById('progress-template-data').textContent);
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
  const progressFields = [
    ['pill_text','Рубрика',1],['student_label','Имя или подпись ученика',1],
    ['headline_2','Тема результата',1],
    ['problem_text','Сложность в начале',3],['narrative','История работы и результат',5],['period_text','Период',1],
    ['footer_text','Нижняя подпись',1],['brand_subtitle','Текст под логотипом',1]
  ];
  const contentFields = () => project.story.kind==='progress'?progressFields:textFields;
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
  const plainDashes = value => String(value ?? '').replace(/[\u2013\u2014]/g, '-');
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
  const validLogo = value => typeof value === 'string' && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(value);
  const validSource = value => isRecord(value) && isRecord(value.story) && typeof value.css === 'string' && value.css.trim() && typeof value.html === 'string' && value.html.trim();
  function collectionOf(value) {
    if (!isRecord(value)) throw new Error('Нужен проект Stories Studio');
    const logo = value.assets?.logoSrc ?? boot.logoSrc;
    if (!validLogo(logo)) throw new Error('В проекте должен быть встроенный исходный логотип');
    if (value.schema === 'mindcrafti.story-studio/2') {
      const ids = new Set();
      if (!isRecord(value.assets) || !Array.isArray(value.templates) || !value.templates.length || value.templates.length > 20) throw new Error('Неверная коллекция шаблонов');
      for (const template of value.templates) {
        if (!validSource(template) || typeof template.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(template.id) || ids.has(template.id)
          || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80) throw new Error('Неверный шаблон');
        ids.add(template.id);
      }
      if (!ids.has(value.activeTemplateId)) throw new Error('Не найден выбранный шаблон');
      return deep(value);
    }
    if ((value.schema && value.schema !== 'mindcrafti.story-studio/1') || !validSource(value)) throw new Error('Неверный формат проекта');
    return { schema:'mindcrafti.story-studio/2', activeTemplateId:'template-1', assets:{...(value.assets || {}), logoSrc:logo}, templates:[
      {id:'template-1',name:'Новости образования',story:deep(value.story),css:value.css,html:value.html},
      {id:'template-2',name:'Результаты учеников',...deep(progressDefaults)}
    ] };
  }
  let collection = collectionOf(defaults);
  let project = collection.templates[0];
  const initialTemplates = new Map();
  const codeTabs = new Map();
  const photoVersions = new Map();
  let codeDirty = false;
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
      collection=collectionOf(p);
      project=collection.templates.find(template=>template.id===collection.activeTemplateId);
    }
  } catch(e) { console.info('local draft unavailable',e); }
  function rememberInitialTemplates() {
    initialTemplates.clear();
    collection.templates.forEach(template=>initialTemplates.set(template.id,deep(template)));
  }
  rememberInitialTemplates();

  function toCssVar(prop){return '--'+prop;}
  function getCSS(name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp(escaped+'\\s*:\\s*([^;]+);');return project.css.match(re)?.[1]?.trim()||'';}
  function patchCSS(name,value,target=project){
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const re=new RegExp('('+escaped+'\\s*:\\s*)([^;]+)(;)');
    if(re.test(target.css))target.css=target.css.replace(re,(_a,p,_v,t)=>p+value+t);
    else target.css+='\n:root { '+name+': '+value+'; }';
  }
  function syncStoryTheme(){
    if(!isRecord(project.story.theme))project.story.theme={};
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
  function compileBody(template=project,assets=collection.assets){
    const s=template.story;
    const missingScores=[];
    const variables={
      layout_class:'layout-'+(s.layout||'editorial'),
      safe_class:s.showSafe?'show-safe':'',
      logo_src:assets.logoSrc,
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
    for (let index=0;index<2;index++) {
      const skill=s.skills?.[index] || {}, score=value=>value==null||String(value).trim()===''?null:Number.isFinite(Number(value))?Math.max(0,Math.min(100,Number(value))):null;
      const before=score(skill.before), after=score(skill.after);
      variables[`skill_${index+1}_name`]=skill.name || '';
      variables[`skill_${index+1}_before`]=before??'';
      variables[`skill_${index+1}_after`]=after??'';
      if(before===null)missingScores.push([index,'before']);if(after===null)missingScores.push([index,'after']);
      const change=before>0 && after!==null?Math.round((after-before)/before*100):null;
      variables[`skill_${index+1}_change_percent`]=change===null?'Новая оценка':`${change>0?'+':''}${change}%`;
    }
    for (const key of ['student_label','problem_text','narrative','period_text']) variables[key]=s[key] || '';
    const markup=template.html.replace(/\{\{([\w.]+)\}\}/g,(_x,key)=>{
      if(!(key in variables)) return '';
      if(key.endsWith('_svg')||key==='photo_block'||key==='logo_src'||key==='layout_class'||key==='safe_class')return variables[key];
      return escapeHtml(plainDashes(variables[key]));
    });
    // The stored sources remain exact; generated visible copy follows the writing rule.
    const fragment=document.createElement('template');fragment.innerHTML=markup;
    for(const [index,side] of missingScores){
      const row=fragment.content.querySelectorAll('.skill-card')[index]?.querySelector('.tube-row.'+side);if(!row)continue;
      const label=row.querySelector('.tube-value');if(label){label.textContent='?';label.title='Нет оценки';}
      const meter=row.querySelector('[role="meter"]');if(meter){meter.removeAttribute('aria-valuenow');meter.setAttribute('aria-valuetext','Нет оценки');}
      const fill=row.querySelector('.tube-fill');if(fill)fill.style.width='0%';
    }
    const walker=document.createTreeWalker(fragment.content,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) if(!['STYLE','SCRIPT'].includes(walker.currentNode.parentElement?.tagName)) walker.currentNode.textContent=plainDashes(walker.currentNode.textContent);
    return fragment.innerHTML;
  }
  function renderedCSS(template=project){
    const target={css:template.css}, strict=template.story.safeMode==='strict';
    patchCSS('--safe-top',strict?'250px':'125px',target);patchCSS('--safe-bottom',strict?'350px':'125px',target);
    patchCSS('--photo-opacity',template.story.photoEnabled?'0.24':'0',target);
    return target.css;
  }
  function outputDocument(forExport=false,template=project,assets=collection.assets){
    let css=renderedCSS(template);
    if(forExport){css+='\n@page{size:1080px 1920px;margin:0}html,body{width:1080px;height:1920px;padding:0;margin:0}';}
    return `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=1080,initial-scale=1"><style>${css}</style></head><body>${compileBody(template,assets)}</body></html>`;
  }
  function validation(){
    const frame=$('storyFrame');
    try{
      const doc=frame.contentDocument;
      if(!doc || !doc.querySelector('.story'))return;
      const issues=[];
      for(const sel of ['.pill-label','.headlines','.headline','.subheadline','.announcement-text','.section-pill','.item-text','.progress-topic','.progress-narrative','.skill-heading strong','.skill-delta']){
        for(const el of doc.querySelectorAll(sel)){
          if(el.scrollWidth>el.clientWidth+10)issues.push('Текст выходит за границы: '+sel);
          if(el.scrollHeight>el.clientHeight+4)issues.push('Текст не помещается по высоте: '+sel);
        }
      }
      const blocks=['.pill','.headlines','.subheadline','.announcement','.info-card','.progress-intro','.skill-card'];
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
    const frame=$('storyFrame');
    frame.onload=()=>{validation();};
    frame.srcdoc=outputDocument(false);
    refreshCode();
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(collection));$('savedState').innerHTML='<span class="status-dot"></span> Сохранено локально';}catch(e){$('savedState').textContent='Локальное сохранение недоступно';}
    validateColors();
    if (studioHydrated && window.parent !== window) {
      window.parent.postMessage({ type: 'mindcrafti-studio:save', payload: JSON.stringify(collection) }, '*');
    }
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
    $('textControls').innerHTML=contentFields().map(([k,label,rows])=>`<label class="text-field"><span class="control-label">${label}</span>${rows===1?`<input data-content="${k}" type="text"/>`:`<textarea rows="${rows}" data-content="${k}"></textarea>`}</label>`).join('');
    $('itemControls').innerHTML=project.story.kind==='progress'
      ? [0,1].map(i=>`<fieldset class="skill-controls"><legend>Навык ${i+1}</legend><label class="text-field"><span class="control-label">Название навыка ${i+1}</span><input data-skill="${i}" data-skill-field="name" /></label><div class="skill-scores">${['before','after'].map(key=>`<label class="text-field"><span class="control-label">${key==='before'?'До':'После'} (%)</span><input type="number" min="0" max="100" step="1" data-skill="${i}" data-skill-field="${key}" /></label>`).join('')}</div></fieldset>`).join('')
      : [0,1,2].map(i=>`<label class="text-field"><span class="control-label">Пункт ${i+1}</span><textarea rows="2" data-item="${i}"></textarea></label>`).join('');
    $('contentTitle').textContent=project.story.kind==='progress'?'История ученика':'Заголовок и новости';
    $('itemsTitle').textContent=project.story.kind==='progress'?'Навыки: до и после':'Карточки';
  }
  function updateControls(){
    for(const [k] of colours){const value=getCSS(toCssVar(k));if(hexOk(value)){$('color_'+k).value=value;$('hex_'+k).value=value.toUpperCase();}}
    for(const [k] of ranges){let size=parseInt(getCSS(toCssVar(k)),10);if(isFinite(size)){const slider=$('range_'+k);slider.value=String(size);$('display_'+k).textContent=String(size)+'px';}}
    for(const [k] of contentFields()){const el=document.querySelector('[data-content="'+k+'"]');if(el&&document.activeElement!==el)el.value=project.story[k]||'';}
    for(const i of [0,1,2]){const el=document.querySelector('[data-item="'+i+'"]');if(el&&document.activeElement!==el)el.value=project.story.items?.[i]?.text||'';}
    for(const el of document.querySelectorAll('[data-skill]')) if(document.activeElement!==el) el.value=project.story.skills?.[Number(el.dataset.skill)]?.[el.dataset.skillField] ?? '';
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
    if(!flushCode())return false;
    codeTabs.set(project.id,which);
    activeCode=which;for(const b of document.querySelectorAll('.code-tab'))b.classList.toggle('active',b.dataset.code===which);
    $('codeError').classList.add('hidden');
    $('codeEditor').blur();refreshCode();$('codeEditor').scrollTop=0;
    return true;
  }
  function applyCode(){
    if(!codeDirty)return true;
    const value=$('codeEditor').value;
    if(!value.trim()){$('codeError').textContent='Код шаблона не должен быть пустым.';$('codeError').classList.remove('hidden');return false;}
    if(activeCode==='css'){
      project.css=value;
      syncStoryTheme();
      updateControls();
    }else if(activeCode==='html'){
      project.html=value;
    }else{
      let parsed;
      try{parsed=JSON.parse(value);}catch(e){$('codeError').textContent='Неверный JSON: '+e.message;$('codeError').classList.remove('hidden');return false;}
      if(!isRecord(parsed)){
        $('codeError').textContent='В JSON должен быть объект содержания.';$('codeError').classList.remove('hidden');return false;
      }
      project.story=parsed;
      if(parsed.theme&&typeof parsed.theme==='object')for(const [k,v] of Object.entries(parsed.theme)){
        if(typeof v==='string' && (colours.some(x=>x[0]===k)||ranges.some(x=>x[0]===k)))patchCSS(toCssVar(k),v);
      }
      fillContent();updateControls();
    }
    $('codeError').classList.add('hidden');
    codeDirty=false;
    queueRender();
    return true;
  }
  function flushCode(){clearTimeout(editTimer);editTimer=0;return applyCode();}
  function renderTemplateTabs(){
    $('templateTabs').innerHTML=collection.templates.map(template=>`<button type="button" role="tab" id="tab-${template.id}" aria-controls="templateWorkspace" aria-selected="${template===project}" tabindex="${template===project?'0':'-1'}" data-template="${template.id}">${escapeHtml(plainDashes(template.name))}</button>`).join('');
    $('templateWorkspace').setAttribute('aria-labelledby','tab-'+project.id);
    $('templateName').value=project.name;
  }
  function selectTemplate(id){
    if(id===project.id)return true;
    if(!flushCode())return false;
    const selected=collection.templates.find(template=>template.id===id);if(!selected)return false;
    clearTimeout(renderTimer);renderTimer=0;
    project=selected;collection.activeTemplateId=id;activeCode=codeTabs.get(id)||'css';
    $('codeEditor').blur();fillContent();updateControls();renderTemplateTabs();
    document.querySelectorAll('.code-tab').forEach(button=>button.classList.toggle('active',button.dataset.code===activeCode));
    renderNow();return true;
  }
  function templateFilename(extension,template=project){return 'mindcrafti-'+plainDashes(template.name).replace(/[^\p{L}\p{N} _-]/gu,'_').slice(0,80)+'.'+extension;}
  function downloadBlob(blob,filename){
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  }
  function downloadText(text,filename,mime='text/plain;charset=utf-8'){downloadBlob(new Blob([text],{type:mime}),filename);}
  function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3200);}
  function exportProject(){if(!flushCode())return;downloadText(JSON.stringify(collection,null,2),'mindcrafti-story-project.json','application/json;charset=utf-8');toast('Все шаблоны сохранены в проект JSON');}
  function loadProject(obj,hydrate=false,target=project){
    if(!hydrate&&!flushCode())return;
    if(obj?.schema==='mindcrafti.story-studio/2' || (hydrate&&validSource(obj))){
      collection=collectionOf(obj);project=collection.templates.find(template=>template.id===collection.activeTemplateId);codeTabs.clear();photoVersions.clear();rememberInitialTemplates();
    }else if(validSource(obj)){
      if(obj.assets && obj.assets.logoSrc!==collection.assets.logoSrc)throw new Error('Импорт одного шаблона не может заменить общий логотип');
      photoVersions.set(target.id,(photoVersions.get(target.id)||0)+1);
      target.story=deep(obj.story);target.css=obj.css;target.html=obj.html;
    }else if(isRecord(obj)&&(obj.headline_1 || obj.kind==='progress')){
      photoVersions.set(target.id,(photoVersions.get(target.id)||0)+1);target.story=deep(obj);
    }
    else throw new Error('Нужен JSON проекта Mindcrafti или содержания шаблона');
    codeDirty=false;activeCode='css';$('codeEditor').blur();clearTimeout(renderTimer);
    fillContent();updateControls();renderTemplateTabs();changeCodeTab('css');renderNow();toast('Проект загружен');return;
  }
  async function shareLink(){
    if(!flushCode())return null;
    let obj={schema:'mindcrafti.story-studio/1',...deep(project),assets:deep(collection.assets)};
    if(location.protocol==='file:' || location.origin==='null'){downloadText(JSON.stringify(obj,null,2),templateFilename('json'),'application/json;charset=utf-8');toast('Выбранный шаблон скачан как JSON для передачи.');return null;}
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
  async function copyCurrentCode(){if(!flushCode())return;const value=$('codeEditor').value;try{await navigator.clipboard.writeText(value);toast('Код выбранного шаблона скопирован');}catch(e){toast('Выдели и скопируй код вручную');}}
  async function downloadPng(){
    if(!flushCode())return;
    const selected=deep(project), assets=deep(collection.assets), filename=templateFilename('png',selected);
    const button=$('exportPngBtn');button.disabled=true;button.textContent='Готовим PNG…';
    try{
      const content=document.createElement('div');content.style.cssText='width:1080px;height:1920px;';
      const style=document.createElement('style');style.textContent=renderedCSS(selected);content.append(style);
      const body=document.createElement('template');body.innerHTML=compileBody(selected,assets);content.append(body.content.cloneNode(true));
      // SVG foreignObject needs well-formed XHTML, including self-closing images.
      const svgMarkup=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><foreignObject x="0" y="0" width="1080" height="1920">${new XMLSerializer().serializeToString(content)}</foreignObject></svg>`;
      const svgURL='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svgMarkup);
      const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('SVG image could not render'));img.src=svgURL;});
      const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,1080,1920);context.drawImage(img,0,0);
      const png=await new Promise(res=>canvas.toBlob(res,'image/png'));
      if(!png)throw new Error('Не удалось сформировать PNG');
      downloadBlob(png,filename);toast('PNG 1080 × 1920 сохранён');
    }catch(e){console.error(e);downloadText(outputDocument(true,selected,assets),templateFilename('html',selected),'text/html');toast('PNG недоступен в этом браузере. Скачан HTML для печати.');}
    finally{button.disabled=false;button.innerHTML='<span>↧</span> Скачать PNG';}
  }
  function importPhoto(file){
    if(!file)return;
    const target=project, owner=collection, token=(photoVersions.get(target.id)||0)+1;
    photoVersions.set(target.id,token);
    const current=()=>collection===owner&&collection.templates.includes(target)&&photoVersions.get(target.id)===token;
    const reader=new FileReader();reader.onload=()=>{
      if(!current())return;
      const image=new Image();image.onload=()=>{
        if(!current())return;
        const canvas=document.createElement('canvas');const s=Math.min(950/image.width,1200/image.height,1);
        canvas.width=Math.round(image.width*s);canvas.height=Math.round(image.height*s);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        target.story.photoData=canvas.toDataURL('image/jpeg',.83);target.story.photoEnabled=true;updateControls();renderNow();toast('Фотография добавлена');
      };image.src=reader.result;
    };reader.readAsDataURL(file);
  }
  function exportPrompt(){
    if(!flushCode())return;
    const s=project.story;const msg=plainDashes(`Помоги мне настроить выбранный шаблон «${project.name}» генератора Instagram Stories Mindcrafti. Используй фиксированные цвета, размеры и CSS. Не используй длинные тире U+2013 и U+2014: в тексте ставь обычный дефис (-). НЕ публикуй сторис без моего одобрения. ${location.protocol==='file:'?'Сейчас редактор открыт локально, поэтому через облачный браузер ChatGPT эта ссылка недоступна. Для управления через ChatGPT Work требуется HTTPS-размещение.':'Мой редактор доступен по адресу: '+location.href}\n\nТекущий стиль: акцент ${getCSS('--accent')}, текст ${getCSS('--ink')}, заголовок ${getCSS('--title-size')}. Тема: ${s.student_label||s.headline_1} ${s.headline_2} ${s.period_text||s.headline_3}.`);
    navigator.clipboard.writeText(msg).then(()=>toast('Инструкция для ChatGPT скопирована'),()=>window.prompt('Скопируй текст:',msg));
  }
  function bindEvents(){
    $('templateTabs').onclick=e=>{const button=e.target.closest('[data-template]');if(button&&selectTemplate(button.dataset.template))$('tab-'+project.id).focus();};
    $('templateTabs').onkeydown=e=>{
      const index=collection.templates.findIndex(template=>template.id===project.id);
      const next=e.key==='ArrowRight'?(index+1)%collection.templates.length:e.key==='ArrowLeft'?(index+collection.templates.length-1)%collection.templates.length:e.key==='Home'?0:e.key==='End'?collection.templates.length-1:null;
      if(next!==null){e.preventDefault();if(selectTemplate(collection.templates[next].id))$('tab-'+project.id).focus();}
    };
    $('renameTemplateForm').onsubmit=e=>{
      e.preventDefault();if(!flushCode())return;
      const name=plainDashes($('templateName').value).trim();
      if(!name||name.length>80){toast('Название должно содержать от 1 до 80 символов');return;}
      project.name=name;renderTemplateTabs();renderNow();toast('Название шаблона сохранено');
    };
    $('contentControls').addEventListener('input',e=>{
      if(e.target.dataset.content){project.story[e.target.dataset.content]=e.target.value;queueRender();}
      if(e.target.dataset.item!==undefined){project.story.items ||= [];const index=Number(e.target.dataset.item);project.story.items[index] ||= {};project.story.items[index].text=e.target.value;queueRender();}
      if(e.target.dataset.skill!==undefined){
        const index=Number(e.target.dataset.skill), key=e.target.dataset.skillField;
        project.story.skills ||= [];project.story.skills[index] ||= {};
        project.story.skills[index][key]=key==='name'?e.target.value:Math.max(0,Math.min(100,Number(e.target.value)||0));queueRender();
      }
    });
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
    $('resetBtn').onclick=()=>{
      if(!confirm('Вернуть исходные цвета, текст и код выбранного шаблона?'))return;
      clearTimeout(editTimer);codeDirty=false;photoVersions.set(project.id,(photoVersions.get(project.id)||0)+1);
      const original=initialTemplates.get(project.id);project.story=deep(original.story);project.css=original.css;project.html=original.html;
      $('codeEditor').blur();fillContent();updateControls();renderNow();toast('Выбранный шаблон восстановлен');
    };
    $('saveProjectBtn').onclick=exportProject;
    $('importProjectBtn').onclick=()=>$('importFile').click();
    $('importFile').onchange=async e=>{
      const target=project,owner=collection;
      try{const file=e.target.files?.[0];if(file){const imported=JSON.parse(await file.text());if(collection===owner&&collection.templates.includes(target))loadProject(imported,false,target);}}
      catch(err){toast('Ошибка импорта: '+err.message);}finally{e.target.value='';}
    };
    $('shareBtn').onclick=shareLink;
    $('exportPngBtn').onclick=downloadPng;
    $('exportHtmlBtn').onclick=()=>{if(flushCode())downloadText(outputDocument(true),templateFilename('html'),'text/html;charset=utf-8');};
    $('copyPromptBtn').onclick=exportPrompt;
    $('fitBtn').onclick=fitPreview;
    $('copyCodeBtn').onclick=copyCurrentCode;
    for(const b of document.querySelectorAll('.code-tab'))b.onclick=()=>changeCodeTab(b.dataset.code);
    $('codeEditor').oninput=()=>{codeDirty=true;updateGutter();clearTimeout(editTimer);editTimer=setTimeout(()=>{editTimer=0;applyCode();},290);};
    $('codeEditor').onscroll=()=>{$('editorGutter').scrollTop=$('codeEditor').scrollTop;};
    $('codeEditor').onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();const t=e.target;const a=t.selectionStart,b=t.selectionEnd;t.setRangeText('  ',a,b,'end');t.dispatchEvent(new Event('input'));}};
    $('revertCodeBtn').onclick=()=>{clearTimeout(editTimer);codeDirty=false;const original=initialTemplates.get(project.id);if(activeCode==='json')project.story=deep(original.story);else if(activeCode==='css')project.css=original.css;else project.html=original.html;fillContent();updateControls();$('codeEditor').blur();refreshCode();renderNow();toast('Правка этой вкладки выбранного шаблона отменена');};
    $('downloadCodeBtn').onclick=()=>{if(!flushCode())return;const mapping={css:'css',json:'json',html:'html'};downloadText($('codeEditor').value,templateFilename(mapping[activeCode]));};
    $('showCodeMobile').onclick=()=>{$('codePanel').classList.add('show-mobile');$('showCodeMobile').classList.add('active');$('showPreviewMobile').classList.remove('active');};
    $('showPreviewMobile').onclick=()=>{$('codePanel').classList.remove('show-mobile');$('showCodeMobile').classList.remove('active');$('showPreviewMobile').classList.add('active');};
    new ResizeObserver(fitPreview).observe($('previewStage'));
    window.addEventListener('hashchange',loadHash);
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();exportProject();}});
  }
  function init(){
    fillColorControls();fillRanges();fillContent();bindEvents();updateControls();renderTemplateTabs();renderNow();fitPreview();loadHash();
  }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !event.data || event.data.type !== 'mindcrafti-studio:hydrate') return;
    if (studioHydrated) return;
    studioHydrated = true;
    const incoming = event.data.payload;
    if (typeof incoming === 'string' && incoming.length && incoming.length < 2000000) {
      try { loadProject(JSON.parse(incoming),true); }
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
