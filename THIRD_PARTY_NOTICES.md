# Third-party notices

Third-party components used by MC-School, with the licence each is used under
and the scope of what is reused. Versions are pinned in `backend/pom.xml` and
`frontend/package.json` / `package-lock.json`.

This file covers components introduced for the online-class feature. Components
that predate it are governed by the dependency manifests themselves.

---

## LiveKit server SDK (Kotlin/Java)

- **Source:** https://github.com/livekit/server-sdk-kotlin
- **Artifact:** `io.livekit:livekit-server`
- **Version:** `0.16.0` (pinned via `${livekit-server.version}` in `backend/pom.xml`)
- **Licence:** Apache-2.0 — permits commercial use
- **Reused as:** a package dependency. No source is vendored.
- **Scope used:** `AccessToken` (participant token minting), `VideoGrant`
  subclasses (`RoomJoin`, `RoomName`, `CanPublish`, `CanSubscribe`,
  `CanPublishData`, `CanPublishSources`), `RoomServiceClient` (room and
  participant administration), and `WebhookReceiver` (webhook signature
  verification, used from P5).
- **Local integration:** wrapped behind `LiveClassMediaProvider` so no
  LiveKit-specific type reaches controllers or services. URL scheme conversion,
  per-source grant mapping, error translation and Retrofit `Call` unwrapping are
  maintained locally in `LiveKitMediaProvider`.
- **Verification performed:** latest version confirmed against
  `repo1.maven.org/maven2/io/livekit/livekit-server/maven-metadata.xml`
  (the Maven Central *search* API returned a stale `0.10.0`). API surface
  confirmed by reading `AccessToken.kt`, `VideoGrant.kt`, `RoomServiceClient.kt`
  and `WebhookReceiver.kt` at `main`, not from documentation alone —
  `AccessToken.ttl` is in **milliseconds**, and the emitted JWT carries
  `iss/exp/sub/name/video` with no `nbf` or `iat`.
- **Transitive dependencies reviewed:** `retrofit 3.0.0`, `okhttp 4.12.0`
  (+ `okhttp-jvm 5.3.2` at runtime), `protobuf-java 4.34.2`,
  `protobuf-java-util 4.34.2`, `kotlin-stdlib 2.3.21`, `com.auth0:java-jwt 4.6.0`.
  All Apache-2.0 or MIT, all actively maintained.

---

## Planned front-end components (P2 onward)

Versions verified against the npm registry on 2026-09-18; recorded here so the
pins are reviewable before installation.

| Package | Version | Licence | Reuse scope |
|---|---|---|---|
| `livekit-client` | 2.22.3 | Apache-2.0 | browser realtime client |
| `@livekit/components-react` | 2.9.24 | Apache-2.0 | room primitives and hooks |
| `@livekit/components-styles` | 1.2.0 | Apache-2.0 | base styles, overridden by MC-School styling |
| `konva` | 10.5.0 | MIT | whiteboard/annotation canvas rendering |
| `react-konva` | **18.2.16** | MIT | React bindings for Konva |

**`react-konva` pin rationale:** the current major (`19.3.0`) declares peers
`react ^19.3.0` / `react-dom ^19.3.0`. This project is on React **18.3.1**, so
adopting it would force a React 19 upgrade well outside this feature's scope.
`18.2.16` declares `react >=18.0.0` and `konva ^8 || ^9 || ^10`, so it is
compatible with the pinned `konva 10.5.0`.

`@livekit/components-react@2.9.24` declares peers `react >=18` and
`livekit-client ^2.20.1`; both are satisfied by the pins above.

LiveKit's open-source Meet example (https://github.com/livekit-examples/meet,
Apache-2.0) is consulted as a **reference** for room layout composition. Any
code adapted from it will be recorded here with the specific commit and the
modifications made.

---

## Transcription agent dependencies (`services/transcription-agent`)

Verified against PyPI on 2026-09-19. Pinned exactly in `requirements.txt` /
`requirements-dev.txt`; these are **not** on the backend's classpath.

| Package | Version | Licence | Reuse scope |
|---|---|---|---|
| `livekit-agents` | 1.8.2 | Apache-2.0 | agent worker framework and job dispatch |
| `livekit-plugins-soniox` | 1.8.2 | Apache-2.0 | official Soniox STT plugin |
| `aiohttp` | 3.14.3 | Apache-2.0 AND MIT | health server and backend ingestion calls |
| `pytest` | 9.1.1 | MIT | tests only |
| `pytest-asyncio` | 1.4.0 | Apache-2.0 | tests only |

Every version I first guessed was wrong (`livekit-agents` 1.2.19 vs. the actual
1.8.2), which is why these were checked against the registry before pinning.

## AWS SDK for Java v2 — S3

- **Artifact:** `software.amazon.awssdk:s3` **2.55.1**, Apache-2.0
- Verified against `repo1.maven.org/.../s3/maven-metadata.xml`.
- **Reused as:** a package dependency behind the `ClassArtifactStorage` port; no
  AWS type reaches application services.
- Used for S3-compatible storage generally (AWS S3, Cloudflare R2, MinIO) via
  path-style addressing and an endpoint override.
