/* Presentation only: reuse the card dashboard's render event and counts. */
(() => {
  "use strict";
  const styleId = "quiz-package-stat-colors";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
/* The same status colors in every package in the card overview. */
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
`;
    document.head.append(style);
  }
  const labels = [
    ["errors", "\u041e\u0448\u0438\u0431\u043a\u0438"],
    ["due", "\u041a \u043f\u043e\u0432\u0442\u043e\u0440\u0435\u043d\u0438\u044e"],
    ["known", "\u041e\u0441\u0432\u043e\u0435\u043d\u043e"],
    ["new", "\u041d\u043e\u0432\u044b\u0435"]
  ];
  const statsPattern = new RegExp("^" + labels.map(([, label]) => label + ":\\s*(\\d+)").join("\\s*\u00b7\\s*") + "$", "u");

  function colorCardStats() {
    const host = document.getElementById("flashcard-app");
    if (!host) return;
    for (const line of host.querySelectorAll(".quiz-package > summary > small")) {
      if (line.classList.contains("quiz-package-stats")) continue;
      const match = line.textContent.trim().match(statsPattern);
      if (!match) continue;
      const badges = labels.map(([kind, label], index) => {
        const badge = document.createElement("span");
        badge.className = "quiz-package-stat quiz-package-stat--" + kind;
        const value = document.createElement("b");
        value.textContent = match[index + 1];
        badge.append(label + ": ", value);
        return badge;
      });
      line.classList.add("quiz-package-stats");
      // Spaces keep the labels readable when copied or read without CSS.
      line.replaceChildren(...badges.flatMap((badge, index) => index ? [" ", badge] : [badge]));
    }
  }

  window.addEventListener("study-home-rendered", colorCardStats);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", colorCardStats, { once: true });
  } else {
    colorCardStats();
  }
})();
