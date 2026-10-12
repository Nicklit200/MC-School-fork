const API = "https://personal-life-api-production.up.railway.app/api/german-words";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "add-german-word", title: "Добавить «%s» в немецкий словарь", contexts: ["selection"] });
});
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "add-german-word") return;
  const word = (info.selectionText || "").trim().slice(0, 160);
  if (!word) return;
  try {
    const response = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, sourceUrl: info.pageUrl || "" })
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    chrome.notifications.create({type:"basic",iconUrl:"icon.png",title:"Мой словарь",message:"Добавлено: "+word});
  } catch (error) {
    console.error("German dictionary:", error);
    chrome.notifications.create({type:"basic",iconUrl:"icon.png",title:"Не удалось добавить слово",message:"Проверь доступность сайта и попробуй снова."});
  }
});
