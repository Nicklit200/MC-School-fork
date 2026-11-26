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
