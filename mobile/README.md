# Mindcrafti Mobile

Minimal iOS / Android application powered by Expo SDK 58, isolated from the school website.

## Source and Expo settings
- Expo account: `mindcraftide`
- Expo project: `mindcrafti-mobile`
- GitHub repository: `Nicklit200/MC-School-fork`
- Work branch: `feature/mindcrafti-mobile-app`
- Expo GitHub Base directory: `/mobile`

## Implemented in the first commit
- Native single-screen layout
- Existing school account sign-in via `/api/v1/auth/login`
- Encrypted device storage of access token via Expo SecureStore
- Notification permission request
- Local test notification
- Attempt to acquire an Expo push token in a signed build

## Important: remote push is NOT ready
The backend currently implements browser Web Push, not Expo-native push tokens. The first release requires:
1. Link `app.json` with the exact Expo project UUID in `expo.extra.eas.projectId`.
2. Set up Apple APNs and Google FCM credentials for signed builds.
3. Add authenticated user-scoped device registration and removal to the Mindcrafti backend.
4. Implement server-to-Expo push sender and an authenticated own-device test endpoint.
5. Generate a lockfile using `npm install`, validate with `npx expo install --check` and `npm run check`, and commit it.
6. Build and test signed apps on real devices before distributing to parents and teachers.

## Safety
Do not modify Railway production deployment branches or enable automatic publishing of unreviewed code. Do not store access tokens or API keys in GitHub files.

## Parent dashboard in native iOS build

The mobile shell now embeds the existing school UI using the Expo SDK 58 compatible
`react-native-webview@14.0.1`. The app signs in via the existing school API,
then opens `https://mc-school-production.up.railway.app/parent` with the same
account session. Native notification controls remain in the app header.

This feature requires a NEW iOS EAS build because WebView is a native dependency.
On the computer that previously cloned the `feature/mindcrafti-mobile-app` branch:

```powershell
cd "$HOME\mindcrafti-app\mobile"
git pull
npm.cmd install
npx.cmd expo install --check
npx.cmd eas-cli@latest build --platform ios --profile preview
```

The installed preview app will not update automatically until the new signed
build is installed. The production Railway website is unchanged. For eventual
App Store review, a WebView-only shell may not meet Apple's minimum-functionality
requirements; build richer native features before public release.

Security: The access token is injected into WebView's origin-scoped localStorage
only on the known school host. External HTTPS navigation opens in the system browser.


## Live editing on a physical iPhone (Expo Development Client)

The `development` profile in `eas.json` uses `developmentClient: true` and
`distribution: internal`. Expo SDK 58 uses `expo-dev-client@~58.0.21`.
This is different from the `preview` profile: install a development build
**once** to preview TypeScript/React Native changes with Fast Refresh.

On Windows PowerShell:

```powershell
cd "$HOME\mindcrafti-app\mobile"
git pull
npm.cmd install
npx.cmd eas-cli@latest build --platform ios --profile development
```

When it finishes, open the new **development** build link on the registered
iPhone and install it. If the Expo launcher is shown, this is expected.
Keep Developer Mode enabled on iOS.

Start the dev server on the Windows PC and leave the terminal running:

```powershell
npm.cmd run dev:phone
```

Connect the iPhone to the Expo dev server using the QR code or by choosing
the development server inside the Mindcrafti Development Client. The tunnel
works even if the devices are on different networks. Then TypeScript, JSX,
styles, and React Native screen logic update with Fast Refresh.

When changes are made on GitHub, run `git pull` **in a second terminal**;
the running Metro process will pick up changes. A change to native modules,
`app.json` native settings, iOS entitlements, or config plugins requires
a new development build.

The parent dashboard itself is a WebView of the production school site.
Changes to the web frontend must be deployed to the website to appear in that
WebView; Fast Refresh does **not** hot-reload the website source through Metro.

Do not launch `eas build --profile preview` when you only want to iterate
on JavaScript screens. Do not run `npm audit fix --force` without inspecting
the dependency impact.

## Teacher iPad mode (27 November 2026)

The iOS app opens the existing teacher web dashboard inside the native app after
a teacher signs in. The role landing routes are:
- TEACHER: `/students` (teacher workspace)
- ADMIN: `/teachers`
- STUDENT: `/today`
- PARENT: `/parent`

The iPad already has `supportsTablet: true` and the default orientation allows
portrait and landscape. The website's responsive teacher shell is used rather
than creating a second, divergent teacher interface.

### iPad classroom capabilities
- The embedded classroom uses the existing LiveKit online lesson and whiteboard.
- The web whiteboard already has an iPadOS-specific native Touch Events path
  for Apple Pencil, including pressure samples, palm rejection and two-finger
  pan/zoom. It is reused by the WebView; this is not a separate native drawing
  canvas.
- The iOS WebView is configured for inline media and same-host camera/microphone
  capture prompts. The app declares the camera and microphone usage descriptions.
- Teacher lesson preparation, group/one-off participants, personal workbooks,
  answers, homework and student progress are opened from the existing website
  inside the app.

### TestFlight build
Run from the `mobile/` directory:
```bash
npm install
npm run check
npx expo install --check
npm run build:testflight
```

After EAS finishes and the iOS build is available in App Store Connect:
```bash
npm run submit:testflight
```

This starts a new signed store-distributed iOS build for TestFlight; it does not
change the live Railway website. A native dependency, Info.plist permission or
WebView setting change requires a new build, not just an OTA update.

### Physical iPad acceptance checklist
1. Install the new build from TestFlight and sign in with a TEACHER account.
2. Confirm the app opens `/students` and the teacher navigation works in both
   portrait and landscape.
3. Open an existing lesson, check the prejoin camera/microphone preview and
   grant iOS permissions when asked.
4. Join the LiveKit room; verify two-way audio, camera, waiting room, participant
   controls and reconnect after briefly disabling Wi-Fi.
5. Write with Apple Pencil on the shared and personal boards. Verify quick short
   strokes, pressure, palm rejection, undo and saved annotations.
6. Use two fingers to pan/zoom without creating ink. Confirm keyboard/text input
   still works.
7. Open the shared and personal PDFs, answers and completed lesson documents.
   Check file preview/download behavior on the physical iPad.
8. Create or review homework and confirm the correct student/group is selected.
9. End a test lesson only after saved documents are visible; verify the teacher
   returns to the lesson page and the room is ended.

A successful EAS build is not proof of camera, microphone, LiveKit or Pencil
behavior. Those items must be checked on the actual iPad.
