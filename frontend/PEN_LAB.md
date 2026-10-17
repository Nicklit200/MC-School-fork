# Mindcrafti Pen Lab — live stylus testing

This is a **development-only** handwriting page. It is not included in the production Vite HTML entry and does not require a school login, backend, or Railway deployment.

## Quick start — Windows / VS Code

1. Clone `Nicklit200/MC-School-fork` (or open an existing local clone).
2. In VS Code terminal, run:

   ```powershell
   git fetch origin
   git switch feature/pen-lab-live-preview-20261017
   cd frontend
   npm ci
   npm run dev:pen-lab
   ```

3. On your computer, open `http://localhost:5173/pen-lab.html`.
4. Connect your iPad / Android tablet to the same Wi-Fi network.
5. Read **Network** from the Vite terminal, e.g. `http://192.168.178.25:5173/`, and open `http://192.168.178.25:5173/pen-lab.html` on your tablet. To find your Windows computer's IP use `ipconfig` (look for **IPv4 Address**).
6. Edit `frontend/src/lib/homeworkInk.ts` in VS Code and **save**. Vite HMR updates the pen renderer on both browsers in seconds, without any Railway build.

**Tablet diagnostics:** Pointer type, pressure, event count, cancellations and lost pointer captures are shown on the page. Apple Pencil / supported pen devices are recognized by pointer type `pen`. Two fingers zoom and move the page; toggle “Писать пальцем” to test ordinary finger-based input. Drawing is cached per-browser in `localStorage` so most Vite reloads don't erase it.

The lab's testing canvas and the homework worksheet use the same **Perfect Freehand renderer** (`src/lib/homeworkInk.ts`). They do not yet share the complete pointer-input controller: changes to the worksheet's touch controller must be tested in homework as well before production.

**Troubleshooting**
- If the tablet cannot connect, check that the Windows Firewall permits Node.js / Vite on the **private** Wi-Fi network, and make sure both devices use the same Wi-Fi. Disable guest Wi-Fi client isolation, if enabled.
- If tablet Safari/Chrome fails to refresh after a save, reload the page once, or check the Vite HMR connection in developer tools. Vite HMR normally updates immediately, but browser restarts or network drops can interrupt it.
- Access is on your local Wi-Fi. **Do not expose this development server to the public internet**.
- Always test actual school homework/PDF submission separately before shipping. The lab does not submit anything to the real backend.

## Integration

Once verified, open a pull request from `feature/pen-lab-live-preview-20261017` to `integration/railway-and-ux`. Merge only after running `npm run typecheck`, `npm test`, and `npm run build`, plus real iPad and Android writing tests.


## Full iPad Pencil diagnostic recording

When you open \`/pen-lab.html\` in **Vite development mode**, diagnostics start automatically without any login. The recorder is **separate from main.tsx**: changes made to the live drawing code in VS Code / Codex do not replace it.

Recorded data (timestamps in milliseconds and wall-clock ISO-8601):
- Pointer down, move, up, cancel and capture-lost/capture-restored events; stylus pressure, coordinates, buttons and tilt where the browser exposes them
- Number of coalesced input events, elapsed time between pen events, time spent in the lightweight telemetry observer
- Safari/iPad frame gaps, event-loop stalls, supported browser long tasks, JavaScript errors, visibility changes
- An explicit \`FREEZE_MARKED_BY_USER\` event when you press **Отметить сбой** after noticing that the pen stopped drawing

**Automatic local storage on the computer:** each iPad session sends batches over the same local Vite Wi-Fi connection. The Vite server writes append-only JSON lines to:

\`frontend/.pen-lab-logs/penlab-<session-id>.ndjson\`

The whole directory is ignored by Git. It is not uploaded to GitHub, Railway or ChatGPT automatically. Only the local Vite development server can collect those events. Keep your home Wi-Fi private, because a user on the same trusted LAN may be able to access these local diagnostic endpoints.

**Usage:**
1. Start \`npm.cmd run dev:pen-lab\` in VS Code and open the local Network URL on your iPad.
2. Write until the Apple Pencil briefly stops responding. Immediately press **Отметить сбой** in the bottom-right diagnostic panel.
3. Continue writing; the recorder saves data every second automatically.
4. On the computer open \`frontend/.pen-lab-logs/\` in VS Code. The newest \`.ndjson\` file is the session log. Ask Codex to inspect it; logs are never included in Git commits.
5. To send a diagnostic report to ChatGPT, press **Скачать лог** on the iPad, then attach the downloaded \`.ndjson\` file in this chat. This is a manual transfer; ChatGPT cannot directly read the files on your computer.

**Updating the lab when Codex already modified main.tsx:** first commit or stash your local work, then run \`git pull\` on \`feature/pen-lab-live-preview-20261017\`. This update adds standalone files and edits \`vite.config.ts\`, \`pen-lab.html\`, and \`.gitignore\`; it intentionally does not overwrite \`src/pen-lab/main.tsx\`. Restart Vite after pulling because the server middleware configuration changed. On Windows use \`npm.cmd run dev:pen-lab\`.
