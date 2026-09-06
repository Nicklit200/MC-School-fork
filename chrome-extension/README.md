# Mindcrafti Soniox Reminder

Chrome extension for Mindcrafti teachers.

It does two things:

1. On Mindcrafti, clicking **Начать урок / Unterricht starten** tries to open the installed Soniox desktop app.
2. On `meet.google.com`, after Google Meet shows that the teacher left the meeting, it displays a large **Останови Soniox** reminder directly over the Meet page.

## Install the extension

1. Download or clone this repository branch.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `chrome-extension` folder.

## One-time Windows setup for opening Soniox

Chrome extensions cannot directly execute an arbitrary `.exe`. For Windows, this folder includes a small one-time setup script that registers a local URL protocol for the installed Soniox app.

1. Make sure the Soniox desktop app is installed.
2. Right-click `register-soniox-protocol.ps1` and run it with PowerShell.
3. The script searches for `Soniox.exe`. If it cannot find it, paste the full path to `Soniox.exe` when asked.
4. Reload the extension in `chrome://extensions`.

After that, clicking **Начать урок** in Mindcrafti opens Soniox through:

`mindcrafti-soniox://open`

Chrome may ask once whether it is allowed to open the external application. Allow it and, if Chrome offers the option, remember the choice.

The lesson flow itself is not blocked if Soniox cannot be opened.

## Meet reminder

After leaving a Google Meet call, when Meet displays the post-call screen, the extension shows **Останови Soniox** directly over the page.

No student data is read or stored by the extension. It only checks the visible Mindcrafti button text and the visible Google Meet page state.
