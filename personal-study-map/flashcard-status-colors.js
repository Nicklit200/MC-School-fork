/* Dashboard presentation: total review inventory is separate from today's queue.
 * Reuse the rendered package inventory and topicStats.unseen so hidden/invalid
 * cards and the current subject/topic filter keep exactly the core's semantics.
 * No changes to saved answers, due dates or the scheduled-session engine.
 */
(() => {
  "use strict";
  const styleId = "quiz-package-stat-colors";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
#flashcard-app .quiz-package > summary > .quiz-package-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 6px;
  margin-top: 7px;
  font-size: 12px;
  line-height: 1.4;
}
#flashcard-app .quiz-package-stat {
  display: inline-block;
  padding: 3px 7px;
  border-radius: 6px;
  font-weight: 600;
  white-space: nowrap;
}
#flashcard-app .quiz-package-stat b { font-weight: 750; }
#flashcard-app .quiz-package-stat--errors { color: #b42318; background: #fff0ee; }
#flashcard-app .quiz-package-stat--due { color: #975000; background: #fff4df; }
#flashcard-app .quiz-package-stat--known { color: #187047; background: #eaf8ef; }
#flashcard-app .quiz-package-stat--new { color: #205cc2; background: #edf3ff; }
#flashcard-app .quiz-review-today { display: block; color: #64748b; font-size: 12px; line-height: 1.4; margin-top: 5px; }
`;
    document.head.append(style);
  }
  const labels = [
    ["errors", "\u041e\u0448\u0438\u0431\u043a\u0438"],
    ["due", "\u041a \u043f\u043e\u0432\u0442\u043e\u0440\u0435\u043d\u0438\u044e"],
    ["known", "\u041e\u0441\u0432\u043e\u0435\u043d\u043e"],
    ["new", "\u041d\u043e\u0432\u044b\u0435"]
  ];
  const todayLabel = "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u043e \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u044e";
  const oldTotalLabel = "\u041d\u0443\u0436\u043d\u043e \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c";
  const reviewHelp = "\u0412\u0441\u0435 \u0443\u0436\u0435 \u043d\u0430\u0447\u0430\u0442\u044b\u0435 \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438, \u043d\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e \u043e\u0442 \u0434\u0430\u0442\u044b \u043f\u043e\u0432\u0442\u043e\u0440\u0435\u043d\u0438\u044f. \u0412\u043a\u043b\u044e\u0447\u0430\u044f \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u0441 \u043e\u0448\u0438\u0431\u043a\u0430\u043c\u0438 \u0438 \u043e\u0441\u0432\u043e\u0435\u043d\u043d\u044b\u0435 \u043d\u0430 \u0438\u043d\u0442\u0435\u0440\u0432\u0430\u043b\u044c\u043d\u043e\u043c \u043f\u043e\u0432\u0442\u043e\u0440\u0435\u043d\u0438\u0438. \u041d\u043e\u0432\u044b\u0435 \u0441\u0447\u0438\u0442\u0430\u044e\u0442\u0441\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e.";
  const statsPattern = new RegExp("^" + labels.map(([, label]) => label + ":\\s*(\\d+)").join("\\s*\u00b7\\s*") + "$", "u");

  function colorCardStats() {
    const host = document.getElementById("flashcard-app");
    if (!host) return;
    const packages = [...host.querySelectorAll(".quiz-package")];
    for (const pack of packages) {
      const summary = pack.querySelector(":scope > summary");
      if (!summary) continue;
      for (const line of summary.querySelectorAll(":scope > small")) {
        if (line.classList.contains("quiz-package-stats")) continue;
        const match = line.textContent.trim().match(statsPattern);
        if (!match) continue;
        const questions = pack.querySelector(":scope > .quiz-package-questions");
        if (!questions) continue;
        const total = questions.querySelectorAll(".quiz-package-question").length;
        const values = match.slice(1).map(Number);
        const unseen = values[3];
        // Do not invent a count if the core's markup ever changes.
        if (unseen > total) continue;
        const dueToday = values[1];
        // topicStats.unseen means neither saved progress nor answer history.
        // Its complement is the entire started inventory, not just due today.
        values[1] = total - unseen;
        line.dataset.reviewTotal = String(values[1]);
        line.dataset.reviewToday = String(dueToday);
        const badges = labels.map(([kind, label], index) => {
          const badge = document.createElement("span");
          badge.className = "quiz-package-stat quiz-package-stat--" + kind;
          const value = document.createElement("b");
          value.textContent = String(values[index]);
          badge.append(label + ": ", value);
          if (kind === "due") {
            badge.title = reviewHelp + " " + todayLabel + ": " + dueToday + ".";
            badge.setAttribute("aria-label", label + ": " + values[index] + ". " + badge.title);
          }
          return badge;
        });
        line.classList.add("quiz-package-stats");
        line.replaceChildren(...badges.flatMap((badge, index) => index ? [" ", badge] : [badge]));
      }
    }

    // The overview total follows the same definition. Keep the actual daily
    // queue visible separately, without changing its button or eligibility.
    const counters = packages.map(pack => pack.querySelector(".quiz-package-stats[data-review-total]"));
    if (counters.some(line => !line)) return;
    const totalReview = counters.reduce((sum, line) => sum + Number(line.dataset.reviewTotal), 0);
    for (const box of host.querySelectorAll(".quiz-stat")) {
      const label = box.querySelector(":scope > span");
      const value = box.querySelector(":scope > strong");
      if (!label || !value) continue;
      const isDailyCount = label.textContent.trim() === oldTotalLabel;
      if (!isDailyCount && box.dataset.reviewOverview !== "true") continue;
      if (isDailyCount) box.dataset.dueToday = value.textContent.trim();
      box.dataset.reviewOverview = "true";
      label.textContent = labels[1][1];
      value.textContent = String(totalReview);
      box.title = reviewHelp;
      let note = box.querySelector(".quiz-review-today");
      if (!note) {
        note = document.createElement("small");
        note.className = "quiz-review-today";
        box.append(note);
      }
      note.textContent = todayLabel + ": " + box.dataset.dueToday;
    }
  }

  window.addEventListener("study-home-rendered", colorCardStats);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", colorCardStats, { once: true });
  } else {
    colorCardStats();
  }
})();
