# Mindcrafti Mobile

Native iOS and Android client for Mindcrafti School.

## Expo project
- Expo organization: `mindcraftide`
- Project slug: `mindcrafti-mobile`
- This folder is separate from the existing website in `frontend/` and API in `backend/`.
- Never deploy this feature branch to the production Railway services.

## First milestone
- Sign in with an existing Mindcrafti account
- Ask for push-notification permission
- Register the device against a secured, user-scoped endpoint
- Test push delivery on physical iOS and Android devices

## Bootstrap
The Expo SDK 58 starter has already been generated locally using:
`npx.cmd create-expo-app@latest mindcrafti-mobile`

To preserve the exact generated dependency lockfile and starter assets, copy or push that folder into `mobile/` on this feature branch rather than recreating it manually.

## Delivery model
GitHub holds source code. Expo EAS Build produces signed native app builds. EAS Update can publish compatible JavaScript/assets updates, but is not a replacement for native builds or store review. Production updates should be triggered only after tests and approval.

## Security
Do not commit Expo tokens, API credentials, passwords, or signing keys. Do not expose a push broadcast API without authentication and recipient authorization.
