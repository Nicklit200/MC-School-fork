const DEFAULT_API = "https://tsubera-doc-tracker-production.up.railway.app";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["apiBase", "enabled"]);
  const patch = {};
  if (!current.apiBase) patch.apiBase = DEFAULT_API;
  if (current.enabled === undefined) patch.enabled = true;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

async function settings() {
  const data = await chrome.storage.local.get(["apiBase", "capturePassword", "enabled"]);
  return {
    apiBase: String(data.apiBase || DEFAULT_API).replace(/\/+$/, ""),
    capturePassword: String(data.capturePassword || ""),
    enabled: data.enabled !== false
  };
}

async function pushCapture(payload) {
  const cfg = await settings();
  if (!cfg.enabled) return { ok: false, disabled: true, message: "Capture disabled" };
  if (!cfg.capturePassword) return { ok: false, needsPassword: true, message: "Set capture password" };
  const res = await fetch(cfg.apiBase + "/api/trans/freights/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tsubera-capture-token": cfg.capturePassword
    },
    body: JSON.stringify(payload)
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data?.error || ("HTTP " + res.status));
  await chrome.storage.local.set({
    lastPushAt: new Date().toISOString(),
    lastPushCount: Number(data?.received || 0),
    lastPushResult: data
  });
  return { ok: true, ...data };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "tsubera:pushCapture") {
    pushCapture(msg.payload || {})
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  if (msg?.type === "tsubera:getSettings") {
    settings().then(sendResponse);
    return true;
  }
});
