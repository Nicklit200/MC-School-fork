const DEFAULT_API = "https://tsubera-doc-tracker-production.up.railway.app";
const CAPTURE_TOKEN = "tecap_7ce84b1f6a3d4e8bb6fcd3a2a94e51c0a8f64b29d0c74f4388f6b0c2e39d5a71";

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["apiBase", "enabled"]);
  const patch = {};
  if (!current.apiBase) patch.apiBase = DEFAULT_API;
  if (current.enabled === undefined) patch.enabled = true;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
});

async function settings() {
  const data = await chrome.storage.local.get(["apiBase", "enabled"]);
  return {
    apiBase: String(data.apiBase || DEFAULT_API).replace(/\/+$/, ""),
    enabled: data.enabled !== false
  };
}

async function pushCapture(payload) {
  const cfg = await settings();
  if (!cfg.enabled) return { ok: false, disabled: true, message: "Capture disabled" };
  const res = await fetch(cfg.apiBase + "/api/trans/freights/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tsubera-capture-token": CAPTURE_TOKEN
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
