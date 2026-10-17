(() => {
  // Materials are tracked separately from skill mastery.
  const materials = [
    {title:"Analyse und Anwendungsfälle", status:"reviewed", detail:"15 слайдов — разобраны, повторены 17.10.2026"},
    {title:"Zustands- und Aktivitätsdiagramm", status:"unconfirmed", detail:"Изучение не подтверждено"},
    {title:"Stereotypen", status:"unconfirmed", detail:"Изучение не подтверждено"}
  ];
  const style=document.createElement("style");
  style.textContent=`
    .material-progress{margin:22px 0 28px;padding:20px;border:1px solid #dfe6ef;border-radius:15px;background:#fff;color:#20334e;box-sizing:border-box}
    .material-progress h3{font-size:20px;margin:0 0 14px;color:#20334e}
    .material-progress .material-count{display:flex;justify-content:space-between;gap:12px;font-size:14px}
    .material-progress .material-meter{height:9px;background:#e8edf3;border-radius:9px;overflow:hidden;margin:12px 0}
    .material-progress .material-meter span{display:block;height:100%;width:33.333%;background:#269568;border-radius:9px}
    .material-progress .material-item{padding:15px 0;border-top:1px solid #e8edf3}
    .material-progress .material-item:first-of-type{border-top:0}
    .material-progress .material-item summary{cursor:pointer;display:flex;align-items:center;gap:12px;font-size:16px;font-weight:650;list-style:none}
    .material-progress .material-item summary::-webkit-details-marker{display:none}
    .material-progress .material-dot{font-size:20px;color:#a3abb6;flex:none}
    .material-progress .material-dot.done{color:#20946a}
    .material-progress .material-detail{font-size:13px;color:#667b95;margin:5px 0 0 31px}
    .material-progress .material-extra{font-size:13px;color:#667b95;margin:12px 0 0 31px}
    @media(max-width:720px){.material-progress{padding:15px;margin:16px 0}.material-progress h3{font-size:18px}.material-progress .material-item summary{font-size:14px}}
  `;
  document.head.append(style);
  function update(){
    const host=document.getElementById("list");
    if(!host||host.hidden)return;
    const examSelect=document.getElementById("exam-select");
    const selected=examSelect?.selectedOptions?.[0]?.textContent||"";
    // Only show this course's materials, never attach them to another exam.
    if(selected && !/software engineering/i.test(selected)){
      host.querySelector(".material-progress")?.remove();return;
    }
    if(host.querySelector(".material-progress"))return;
    const section=document.createElement("section");
    section.className="material-progress";
    section.innerHTML='<h3>Vorlesung 3 — Material</h3><div class="material-count"><span>Разобрано вместе</span><strong>1 из 3 PDF</strong></div><div class="material-meter"><span></span></div>';
    for(const item of materials){
      const el=document.createElement("details");
      el.className="material-item";
      const summary=document.createElement("summary");
      const dot=document.createElement("span");
      dot.className="material-dot"+(item.status==="reviewed"?" done":"");
      dot.textContent=item.status==="reviewed"?"✓":"●";
      const title=document.createElement("span");
      title.textContent=item.title;
      summary.append(dot,title);
      const detail=document.createElement("div");
      detail.className="material-detail";
      detail.textContent=item.detail;
      el.append(summary,detail);
      const extra=document.createElement("div");
      extra.className="material-extra";
      extra.textContent="Источник: Vorlesung 3. Прогресс изучения материала не изменяет оценку навыков.";
      el.append(extra);
      section.append(el);
    }
    host.append(section);
  }
  document.addEventListener("DOMContentLoaded",()=>{
    const host=document.getElementById("list");
    if(!host)return;
    const observer=new MutationObserver(()=>{if(!host.hidden && !host.querySelector(".material-progress"))update()});
    observer.observe(host,{childList:true});
    observer.observe(host,{attributes:true,attributeFilter:["hidden"]});
    update();
  });
})();