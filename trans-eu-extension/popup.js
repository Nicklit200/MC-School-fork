const DEFAULT_API = "https://tsubera-doc-tracker-production.up.railway.app";
const $ = id => document.getElementById(id);

async function load() {
  const data = await chrome.storage.local.get(["apiBase","sitePassword","enabled","lastPushAt","lastPushCount","lastPushResult"]);
  $("password").value = data.sitePassword || "";
  $("enabled").checked = data.enabled !== false;
  renderStatus(data);
}

function renderStatus(data) {
  const status = $("status");
  if (!data.sitePassword) {
    status.className = "bad";
    status.textContent = "Нужно один раз указать пароль Tsubera.";
    return;
  }
  if (data.lastPushAt) {
    const t = new Date(data.lastPushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nРейсов в последнем скане: " + (data.lastPushCount || 0);
  } else {
    status.className = "";
    status.textContent = "Настроено. Открой Trans.eu → Fracht suchen.";
  }
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiBase: DEFAULT_API,
    sitePassword: $("password").value.trim(),
    enabled: $("enabled").checked
  });
  await load();
});

$("scan").addEventListener("click", async () => {
  $("status").className = "";
  $("status").textContent = "Запускаю сканирование…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    $("status").className = "bad";
    $("status").textContent = "Не вижу активную вкладку.";
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "tsubera:scanNow" });
    if (!result?.ok) throw new Error(result?.error || "Не удалось запустить");
    setTimeout(load, 1200);
  } catch (e) {
    $("status").className = "bad";
    $("status").textContent = "Открой страницу Trans.eu → Fracht suchen и попробуй снова.";
  }
});

$("enabled").addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: $("enabled").checked });
});

load();
