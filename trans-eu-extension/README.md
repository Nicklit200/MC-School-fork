# Tsubera Trans.eu Capture

Chrome/Chromium Manifest V3 extension for capturing freight offers rendered on Trans.eu, open freight detail cards, active transports, and Trans.eu Aufträge/Archiv, then sending them to Tsubera.

## Install
1. Download this folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this folder.
5. Open the extension, enter the capture password `tsubera2026`, and save.
6. Open Trans.eu → **Fracht suchen**. A small Tsubera badge appears in the bottom-right corner.

The extension scans the currently rendered results every 30 seconds and after result-table changes. It does not store or transmit Trans.eu login credentials/cookies.

Backend:
`https://tsubera-doc-tracker-production.up.railway.app/api/trans/freights/import`

Captured offers are queryable from the Tsubera backend and MCP tools.


## Active transports
Open Trans.eu -> Laufende Transporte (running transports). The extension also captures the currently rendered active route rows (status, route start, route end, ETA text, partner and vehicle plate when visible) and sends them to the Tsubera "В пути" view.

This lets Tsubera and ChatGPT use the vehicle's next unloading area as the starting point for finding the next freight.


## Open freight cards
Open any freight offer. When the drawer/card contains **Ladeort**, **Entladung**, and the negotiation/route panel, Tsubera captures the card automatically.

It stores the Trans.eu publication/account IDs plus the visible route, loading/unloading windows, tariff, EUR/km, payment term, vehicle/cargo data when visible, contact/company data, and the currently opened Route / Details / company / ratings / negotiations view. Opening another tab in the same card enriches the same publication record instead of creating a separate load.

Backend detail endpoint:
`https://tsubera-doc-tracker-production.up.railway.app/api/trans/freights/detail/import`


## Aufträge archive and invoice reconciliation
Open Trans.eu -> **Aufträge** and click **Собрать Archiv Aufträge с 11.08** in the extension popup.

The extension switches to **Archiv** when possible, captures the visible order rows, and automatically advances through pages until it reaches orders from 11.08.2026 or there are no more pages. Captured fields include the Trans.eu Auftragsnummer, status, vehicle, tariff, distance, route and visible customer data.

Backend order endpoint:
`https://tsubera-doc-tracker-production.up.railway.app/api/trans/orders/import`

Tsubera's **Сверка** view combines the captured Trans.eu orders with CMR/POD already stored in Tsubera and Fakturownia invoices:
- Auftrag + CMR/POD + Rechnung -> complete
- CMR/POD but no Rechnung -> invoice action
- Auftrag but no CMR/POD -> ask Dawid whether the transport was actually performed
- ambiguous invoice match -> manual check

The Fakturownia connection requires `FAKTUROWNIA_BASE_URL` and `FAKTUROWNIA_API_TOKEN` in Railway. The token is never exposed to the browser extension.
