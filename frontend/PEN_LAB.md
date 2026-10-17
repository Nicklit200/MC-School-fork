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
