# Tsubera Trans.eu Capture

Chrome/Chromium Manifest V3 extension for capturing freight offers already rendered on the authenticated Trans.eu **Fracht suchen** page and sending them to Tsubera.

## Install
1. Download this folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this folder.
5. Open the extension, enter the same Tsubera site password, and save.
6. Open Trans.eu → **Fracht suchen**. A small Tsubera badge appears in the bottom-right corner.

The extension scans the currently rendered results every 30 seconds and after result-table changes. It does not store or transmit Trans.eu login credentials/cookies.

Backend:
`https://tsubera-doc-tracker-production.up.railway.app/api/trans/freights/import`

Captured offers are queryable from the Tsubera backend and MCP tools.
