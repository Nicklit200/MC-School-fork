# First release checklist

- [ ] Commit the locally generated Expo SDK 58 starter inside `mobile/`
- [ ] Connect project to `mindcraftide/mindcrafti-mobile` via `eas init`
- [ ] Add login using the existing Mindcrafti API and secure token storage
- [ ] Set app identifiers for Android and iOS
- [ ] Set up Expo notifications, Android FCM and Apple APNs credentials
- [ ] Add authorized push-token registration and de-registration endpoints to the school backend
- [ ] Allow a signed-in user to send only a test push to their own registered phone
- [ ] Test notifications in development builds on physical phones
- [ ] Add CI for tests and approved EAS Update publishing
- [ ] Prepare privacy disclosure and distribution via TestFlight / Google Play testing

Do not enable automatic production publication on each commit.
