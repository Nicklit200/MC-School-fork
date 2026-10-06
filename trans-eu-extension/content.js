(() => {
  if (window.__TSUBERA_TRANS_CAPTURE__) return;
  window.__TSUBERA_TRANS_CAPTURE__ = true;

  const COUNTRY_CODES = "DE|PL|GB|BE|NL|FR|CZ|AT|IT|SK|HU|RO|BG|ES|PT|DK|SE|NO|FI|LT|LV|EE|SI|HR|CH|LU";
  const LOCATION_RE = new RegExp("\\b(?:" + COUNTRY_CODES + ")\\s+[A-Z0-9-]{2,10}(?:\\s+[^\\n]{1,80})?", "g");
  let scanTimer = null;
  let intervalId = null;
  let badge = null;
  let running = false;

  function clean(text) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function lines(text) {
    return clean(text).split("\n").map(s => s.trim()).filter(Boolean);
  }

  function numberOf(value) {
    if (value == null) return null;
    const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < Math.max(420, window.innerWidth * 0.45) || r.height < 34 || r.height > 220) return false;
    const st = getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && Number(st.opacity || 1) > 0;
  }

  function locationMatches(text) {
    const out = [];
    const re = new RegExp(LOCATION_RE.source, "g");
    for (const m of text.matchAll(re)) {
      const v = clean(m[0]);
      if (v && !out.includes(v)) out.push(v);
    }
    return out;
  }

  function looksLikeOffer(text) {
    if (!text || text.length < 45 || text.length > 6000) return false;
    const locs = locationMatches(text);
    if (locs.length < 2) return false;
    if (/LADEORT.*ENTLADEORT/i.test(text)) return false;
    return /\b(?:EUR|PLN|GBP|CHF)\b|\b\d+(?:[.,]\d+)?\s*t\b|\b\d[\d .]*\s*km\b|\b\d{1,3}\s*Tage\b/i.test(text);
  }

  function candidateRows() {
    const selectors = [
      "tbody tr",
      "[role='row']",
      "[class*='offer']",
      "[class*='freight']",
      "[class*='result']",
      "[class*='row']"
    ];
    const nodes = [];
    const seenNodes = new Set();

    function consider(el) {
      if (!el || seenNodes.has(el)) return;
      seenNodes.add(el);
      if (!visible(el)) return;
      const text = clean(el.innerText || el.textContent || "");
      if (!looksLikeOffer(text)) return;
      nodes.push({ el, text });
    }

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) consider(el);
    }

    // Trans.eu currently renders the freight table with generic virtualized divs.
    // If semantic/class selectors did not find enough rows, inspect visible div-like
    // containers and keep only compact elements that contain two route locations.
    if (nodes.length < 5) {
      for (const el of document.querySelectorAll("div,li,article,section")) {
        consider(el);
      }
    }

    // Keep the most compact DOM element for duplicated nested representations.
    nodes.sort((a, b) => a.text.length - b.text.length);
    const unique = [];
    const signatures = new Set();
    for (const item of nodes) {
      const locs = locationMatches(item.text);
      const price = item.text.match(/(?:^|\s)(\d[\d .]*(?:[.,]\d+)?)\s*(EUR|PLN|GBP|CHF)\b/i);
      const published = item.text.match(/\b\d{2}\.\d{2}\.\d{4}\b(?:\s+\d{1,2}:\d{2})?/);
      const company = pickCompany(item.text);
      const sig = (
        locs.slice(0, 2).join("|") + "|" +
        (price?.[0] || "") + "|" +
        company + "|" +
        (published?.[0] || "")
      ).toLowerCase();
      if (signatures.has(sig)) continue;
      signatures.add(sig);
      unique.push(item);
    }
    return unique.slice(0, 250);
  }

  function pickCompany(text) {
    const ls = lines(text);
    const legal = /(GmbH|UG\b|AG\b|KG\b|Sp\.\s*z\s*o\.\s*o\.|Sp\.\s*z\.o\.o\.|S\.A\.|s\.r\.o\.|a\.s\.|B\.V\.|BV\b|SRL\b|S\.R\.L\.|LTD\b|Limited|Logistics|Transport|Cargo|Spedition)/i;
    const skip = /^(DE|PL|GB|BE|NL|FR|CZ|AT|IT|SK|HU|RO|BG|ES|PT|DK|SE|NO|FI|LT|LV|EE|SI|HR|CH|LU)\b|\b(?:EUR|PLN|GBP|CHF|km|Tage|t)\b|^\d{2}\.\d{2}\./i;
    const hit = ls.find(x => legal.test(x) && !skip.test(x));
    return hit ? hit.slice(0, 300) : "";
  }

  function parseOffer(text) {
    const locs = locationMatches(text);
    const weight = text.match(/\b(\d+(?:[.,]\d+)?)\s*t\b/i);
    const km = text.match(/\b(\d[\d .]{0,8})\s*km\b/i);
    const price = text.match(/(?:^|\s)(\d[\d .]*(?:[.,]\d+)?)\s*(EUR|PLN|GBP|CHF)\b/i);
    const payment = text.match(/\b(\d{1,3})\s*Tage\b/i);
    const rating = text.match(/\b([0-5](?:[.,]\d)?)\s*\(\s*\d+\s*\)/);
    const published = text.match(/\b\d{2}\.\d{2}\.\d{4}\b(?:\s+\d{1,2}:\d{2})?/);
    const rawLines = lines(text);
    let vehicleText = "";
    const vehicleLine = rawLines.find(x => /\b(Standard|Mega|Jumbo|Tautliner|Koffer|Plane|Kühl|Isotherm|offen|Solo|Sattel|Anhänger|FTL|LTL|ldm)\b/i.test(x));
    if (vehicleLine) vehicleText = vehicleLine.slice(0, 1000);

    return {
      loadText: locs[0] || "",
      unloadText: locs[1] || "",
      vehicleText,
      weightT: weight ? numberOf(weight[1]) : null,
      distanceKm: km ? Math.round(numberOf(km[1]) || 0) : null,
      priceAmount: price ? numberOf(price[1]) : null,
      currency: price ? price[2].toUpperCase() : "",
      paymentDays: payment ? Number(payment[1]) : null,
      company: pickCompany(text),
      companyRating: rating ? numberOf(rating[1]) : null,
      publishedText: published ? published[0] : "",
      rawText: text.slice(0, 8000)
    };
  }

  function looksLikeActiveTransport(text) {
    if (!text || text.length < 35 || text.length > 6000) return false;
    const locs = locationMatches(text);
    if (locs.length < 2) return false;
    if (/START DER ROUTE.*ENDE DER ROUTE/i.test(text)) return false;
    return /Auf dem Weg|Beladung|Entladung|Route|ETA|\b\d{2}\.\d{2}\.\d{4}\b/i.test(text);
  }

  function activeCandidateRows() {
    const selectors = [
      "tbody tr",
      "[role='row']",
      "[class*='transport']",
      "[class*='route']",
      "[class*='result']",
      "[class*='row']"
    ];
    const nodes = [];
    const seenNodes = new Set();

    function consider(el) {
      if (!el || seenNodes.has(el)) return;
      seenNodes.add(el);
      if (!visible(el)) return;
      const text = clean(el.innerText || el.textContent || "");
      if (!looksLikeActiveTransport(text)) return;
      nodes.push({ el, text });
    }

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) consider(el);
    }
    if (nodes.length < 2) {
      for (const el of document.querySelectorAll("div,li,article,section")) consider(el);
    }

    nodes.sort((a,b) => a.text.length - b.text.length);
    const unique = [];
    const signatures = new Set();
    for (const item of nodes) {
      const parsed = parseActiveTransport(item.text);
      const sig = [parsed.startText, parsed.endText, parsed.partner, parsed.vehiclePlate].join("|").toLowerCase();
      if (!parsed.startText || !parsed.endText || signatures.has(sig)) continue;
      signatures.add(sig);
      unique.push(item);
    }
    return unique.slice(0, 100);
  }

  function dateTimes(text) {
    const out = [];
    const re = /\b\d{2}\.\d{2}\.\d{4}(?:,?\s+\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?)?/g;
    for (const m of text.matchAll(re)) if (!out.includes(m[0])) out.push(m[0]);
    return out;
  }

  function pickVehiclePlate(text) {
    const ls = lines(text);
    for (const line of ls) {
      const m = line.match(/\b([A-ZÄÖÜ]{1,3})[-\s]+([A-ZÄÖÜ]{1,3})[-\s]+(\d{1,4})\b/);
      if (m) return (m[1] + " " + m[2] + " " + m[3]).toUpperCase();
    }
    return "";
  }

  function pickActivePartner(text) {
    const ls = lines(text);
    const skip = /^(Auf dem Weg|Beladung|Entladung|Angeben|ETA|DE\b|PL\b|GB\b|BE\b|NL\b|FR\b|CZ\b|AT\b|IT\b|SK\b|HU\b|RO\b|BG\b|ES\b|PT\b|DK\b|SE\b|NO\b|FI\b|LT\b|LV\b|EE\b|SI\b|HR\b|CH\b|LU\b|\d{2}\.\d{2}\.\d{4})/i;
    const legal = /(Transport|Logistik|Logistics|Spedition|Cargo|GmbH|Sp\.\s*z\.?\s*o\.?\s*o\.?|s\.r\.o\.|B\.V\.|LTD|Limited)/i;
    return (ls.find(x => legal.test(x) && !skip.test(x)) || "").slice(0,400);
  }

  function parseActiveTransport(text) {
    const locs = locationMatches(text);
    const times = dateTimes(text);
    const ls = lines(text);
    const statusLine = ls.find(x => /Auf dem Weg|bei der Beladung|bei der Entladung|Beladen|Entladen|unterwegs|Route/i.test(x) && !/^START DER ROUTE|^ENDE DER ROUTE/i.test(x)) || "";
    const statusDetails = ls.find(x => x !== statusLine && /Beladung|Entladung|Verspät|Warn|Warten|angekommen|gestartet/i.test(x)) || "";
    return {
      statusText: statusLine.slice(0,300),
      statusDetails: statusDetails.slice(0,600),
      startText: locs[0] || "",
      endText: locs[1] || "",
      etaText: times[1] || times[0] || "",
      nextEtaText: times[2] || "",
      partner: pickActivePartner(text),
      vehiclePlate: pickVehiclePlate(text),
      rawText: text.slice(0,8000)
    };
  }

  function setBadge(text, state = "idle") {
    if (!badge) {
      badge = document.createElement("button");
      badge.type = "button";
      badge.id = "tsubera-trans-capture-badge";
      badge.title = "Tsubera Trans.eu Capture - нажмите для обновления";
      Object.assign(badge.style, {
        position: "fixed",
        right: "18px",
        bottom: "18px",
        zIndex: "2147483647",
        border: "0",
        borderRadius: "999px",
        padding: "9px 13px",
        font: "600 12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif",
        boxShadow: "0 4px 18px rgba(0,0,0,.18)",
        cursor: "pointer",
        color: "#fff",
        background: "#0b6bcb"
      });
      badge.addEventListener("click", () => scanAndPush(true));
      document.documentElement.appendChild(badge);
    }
    badge.textContent = text;
    badge.style.background = state === "ok" ? "#168a4b" : state === "error" ? "#b83232" : state === "wait" ? "#876600" : "#0b6bcb";
  }

  async function scanAndPush(force = false) {
    if (running) return;
    const pageText = clean(document.body?.innerText || "");
    const activePage = /START DER ROUTE|ENDE DER ROUTE|NÄCHSTE VORGANGS-ETA|Auf dem Weg zur Beladung/i.test(pageText);
    const freightPage = /Fracht suchen/i.test(pageText);

    if (!activePage && !freightPage) {
      setBadge("Tsubera: открой Fracht suchen или Laufende Transporte");
      return;
    }

    running = true;
    setBadge("Tsubera: сканирую…", "wait");
    try {
      if (activePage) {
        const rows = activeCandidateRows();
        const transports = rows.map(r => parseActiveTransport(r.text)).filter(x => x.startText && x.endText);
        if (!transports.length) {
          setBadge("Tsubera: маршруты не найдены", "error");
          return;
        }
        const response = await chrome.runtime.sendMessage({
          type: "tsubera:pushActiveTransports",
          payload: {
            pageUrl: location.href,
            scannedAt: new Date().toISOString(),
            transports
          }
        });
        if (response?.ok) {
          setBadge("Tsubera: " + transports.length + " маршрутов ✓", "ok");
        } else if (response?.needsPassword) {
          setBadge("Tsubera: укажи пароль", "error");
        } else if (response?.disabled) {
          setBadge("Tsubera: выключено");
        } else {
          setBadge("Tsubera: ошибка отправки", "error");
          console.warn("[Tsubera Active Capture]", response);
        }
        return;
      }

      const rows = candidateRows();
      const offers = rows.map(r => parseOffer(r.text)).filter(x => x.loadText && x.unloadText);
      if (!offers.length) {
        setBadge("Tsubera: предложения не найдены", "error");
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: "tsubera:pushCapture",
        payload: {
          pageUrl: location.href,
          scannedAt: new Date().toISOString(),
          offers
        }
      });
      if (response?.ok) {
        setBadge("Tsubera: " + offers.length + " рейсов ✓", "ok");
      } else if (response?.needsPassword) {
        setBadge("Tsubera: укажи пароль", "error");
      } else if (response?.disabled) {
        setBadge("Tsubera: выключено");
      } else {
        setBadge("Tsubera: ошибка отправки", "error");
        console.warn("[Tsubera Capture]", response);
      }
    } catch (error) {
      setBadge("Tsubera: ошибка", "error");
      console.error("[Tsubera Capture]", error);
    } finally {
      running = false;
    }
  }

  function scheduleScan(delay = 1800) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scanAndPush(false), delay);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "tsubera:scanNow") {
      scanAndPush(true).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });

  const observer = new MutationObserver(() => scheduleScan(2200));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  intervalId = setInterval(() => scanAndPush(false), 30000);
  scheduleScan(2500);
})();
