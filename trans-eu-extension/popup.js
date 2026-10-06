const DEFAULT_API = "https://tsubera-doc-tracker-production.up.railway.app";
const $ = id => document.getElementById(id);

async function load() {
  const data = await chrome.storage.local.get(["apiBase","capturePassword","enabled","lastPushAt","lastPushCount","lastPushResult","lastDetailPushAt","lastDetailPublicationId","lastDetailPushResult","lastActivePushAt","lastActivePushCount","lastActivePushResult","lastOrderPushAt","lastOrderPushCount","lastOrderPushResult"]);
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
  const latest = [
    data.lastPushAt ? { type: "freights", at: data.lastPushAt } : null,
    data.lastDetailPushAt ? { type: "detail", at: data.lastDetailPushAt } : null,
    data.lastActivePushAt ? { type: "active", at: data.lastActivePushAt } : null,
    data.lastOrderPushAt ? { type: "orders", at: data.lastOrderPushAt } : null
  ].filter(Boolean).sort((a,b) => new Date(b.at) - new Date(a.at))[0];
  if (latest?.type === "orders") {
    const t = new Date(data.lastOrderPushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nAufträge в последнем скане: " + (data.lastOrderPushCount || 0);
  } else if (latest?.type === "detail") {
    const t = new Date(data.lastDetailPushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nКарточка груза: " + (data.lastDetailPublicationId || "сохранена");
  } else if (latest?.type === "active") {
    const t = new Date(data.lastActivePushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nМаршрутов в пути: " + (data.lastActivePushCount || 0);
  } else if (data.lastPushAt) {
    const t = new Date(data.lastPushAt).toLocaleString();
    status.className = "ok";
    status.textContent = "Последняя отправка: " + t + "\nРейсов в последнем скане: " + (data.lastPushCount || 0);
  } else {
    status.className = "";
    status.textContent = "Настроено. Открой Fracht suchen, карточку груза или Laufende Transporte.";
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
    $("status").textContent = "Открой Trans.eu → Fracht suchen, карточку груза или Laufende Transporte и попробуй снова.";
  }
});

$("archive").addEventListener("click", async () => {
  $("status").className = "";
  $("status").textContent = "Собираю Aktiv + Archiv Aufträge с 11.08.2026… Не закрывай вкладку Trans.eu.";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    $("status").className = "bad";
    $("status").textContent = "Не вижу активную вкладку.";
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "tsubera:scanAllOrders", since: "2026-08-11" });
    if (!result?.ok) throw new Error(result?.error || "Не удалось собрать Aufträge");
    $("status").className = "ok";
    $("status").textContent = "Готово: Aktiv " + (result.active?.sent || 0) + " + Archiv " + (result.archive?.sent || 0) + " = " + (result.sent || 0) + " Aufträge.";
    setTimeout(load, 1200);
  } catch (e) {
    $("status").className = "bad";
    $("status").textContent = "Открой Trans.eu → Aufträge и попробуй снова. " + (e?.message || "");
  }
});

$("enabled").addEventListener("change", async () => {
  await chrome.storage.local.set({ enabled: $("enabled").checked });
});

load();
