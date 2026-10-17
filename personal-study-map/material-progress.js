(function () {
  const materials = [
    { title: "Analyse und Anwendungsfälle", pages: 15, status: "reviewed", date: "2026-10-17", source: "Vorlesung 3" },
    { title: "Zustands- und Aktivitätsdiagramm", pages: 11, status: "not-confirmed", source: "Vorlesung 3" },
    { title: "Stereotypen", status: "not-confirmed", source: "Vorlesung 3" }
  ];
  const style = document.createElement("style");
  style.textContent = ".material-progress{margin:16px 0 24px;padding:20px;border:1px solid #d3dbe6;border-radius:16px;color:inherit;background:var(--panel-bg,transparent)}.material-progress h3{margin:0 0 12px;font-size:21px}.material-progress .material-meter{height:9px;border-radius:9px;background:#a4a4a440;overflow:hidden;margin:12px 0}.material-progress .material-meter span{display:block;height:100%;background:#299369;width:33.333%}.material-progress details{padding:12px 0;border-top:1px solid #a4a4a42c}.material-progress summary{cursor:pointer;font-weight:650}.material-progress small{display:block;opacity:.75;margin:6px 0}.material-progress .material-note{font-size:13px;opacity:.7}";
  document.head.appendChild(style);
  function render() {
    const list = document.getElementById("list");
    if (!list || list.hidden || list.querySelector(".material-progress")) return;
    const section = document.createElement("section");
    section.className = "material-progress";
    section.innerHTML = '<h3>Учебные материалы · Vorlesung 3</h3><div>Разобрано вместе: <strong>1 из 3 PDF</strong></div><div class="material-meter"><span></span></div>';
    for (const item of materials) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = (item.status === "reviewed" ? "✓ " : "○ ") + item.title;
      details.appendChild(summary);
      const description = document.createElement("small");
      description.textContent = item.status === "reviewed" ? "15 слайдов — разобраны и повторены 17.10.2026" : "Изучение не подтверждено";
      details.appendChild(description);
      const note = document.createElement("div");
      note.className = "material-note";
      note.textContent = "Источник: " + item.source + ". Прогресс материала не равен освоению навыков.";
      details.appendChild(note);
      section.appendChild(details);
    }
    list.prepend(section);
  }
  const observer = new MutationObserver(() => { if (!document.getElementById("list")?.hidden) render(); });
  document.addEventListener("DOMContentLoaded", () => { observer.observe(document.getElementById("list") || document.body, { attributes:true,childList:true,subtree:false }); render(); });
})();