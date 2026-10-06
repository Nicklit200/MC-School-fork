const DEFAULT_API = "https://tsubera-doc-tracker-production.up.railway.app";
const $ = id => document.getElementById(id);

async function load() {
  const data = await chrome.storage.local.get(["apiBase","capturePassword","enabled","lastPushAt","lastPushCount","lastPushResult","lastActivePushAt","lastActivePushCount","lastActivePushResult"]);
  $("password").value = data.capturePassword || "";
  $("enabled").checked = data.enabled !== false;
  renderStatus(data);
}

function renderStatus(data) {
  const status = $("status");
  if (!data.capturePassword) {
    status.className = "bad";
    status.textContent = "Укажи пароль подключения и нажми Сохранить.";
    return;
  }
  if (data.lastActivePushAt && (!data.lastPushAt || new Date(data.lastActivePushAt) > new Date(data.lastPushAt))) {
    const t = new Date(data.lastActivePushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nМаршрутов в пути: " + (data.lastActivePushCount || 0);
  } else if (data.lastPushAt) {
    const t = new Date(data.lastPushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nРейсов в последнем скане: " + (data.lastPushCount || 0);
  } else {
    status.className = "";
    status.textContent = "Настроено. Открой Trans.eu → Fracht suchen или Laufende Transporte.";
  }
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    apiBase: DEFAULT_API,
    capturePassword: $("password").value.trim(),
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
    $("status").textContent = "Открой Trans.eu → Fracht suchen или Laufende Transporte и попробуй снова.";
  }
});

$("enabled").addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: $("enabled").checked });
});

load();
