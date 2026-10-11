# Mindcrafti production: Meta CRM outcomes

This PR targets the **production Railway branch** `integration/railway-and-ux`, not the separate staging branch or MyDomm.

## Current deployment state

- The user saved `META_CAPI_ACCESS_TOKEN` as an environment variable on the **mindcrafti-school** backend service in Railway project **pure-vitality**, environment **production**. Never put the token in GitHub.
- The Meta dataset is **Mindcrafti School Pixel / 1391828005920802**.
- Data transmission is blocked by default through `META_CAPI_SENDING_ENABLED=false` (implicit default). The mere presence of the token does NOT enable transmission.
- The migration is **V60**, not V56: production already contains V56 through V59 used by other features.
- No event is sent when a lead becomes CONTRACT; only a separately confirmed admin action can call CAPI.
- Audit table `trial_lead_meta_conversions` de-duplicates by lead ID and event name and persists the actual signature date.

## Legal and product gates before enabling

1. Complete a **GDPR/ePrivacy** review and correct the current Mindcrafti site's Pixel consent logic and Datenschutzerklärung. The site repository currently loads Pixel while its privacy text says no Meta Pixel is used. A SHA-256 hash of a phone number remains personal data when it can be matched by Meta. A checkbox by an admin does not in itself create a valid legal basis.
2. Verify both confirmed contract dates and whether each parent has an appropriate documented legal basis for Meta ads measurement; do not upload any child details or education history.
3. Confirm the production frontend/backend build and Flyway migration on a safe test environment.
4. Use Meta Test Events where feasible without processing real parent data, and verify the dataset and access token. Never paste access tokens in chat.
5. Only after approval, set `META_CAPI_SENDING_ENABLED=true` on the **backend** in Railway. The admin `/admin/leads` form will then allow a manual `ContractSigned` CAPI event for leads in status `CONTRACT`; repeated sends are de-duplicated.
6. Do not falsify dates. Events older than seven days are rejected by the controller. The first known contract was signed 6 October 2026.
7. Keep optimizing campaigns for verified `Lead` until enough CRM feedback has accumulated; two signed contracts are not a reliable optimization sample.

## Implementation details

- Spring endpoint `GET /api/v1/admin/trial-lead-meta/status` reports feature gate for admin UI.
- Spring endpoint `GET /api/v1/admin/trial-lead-meta` lists existing transmissions for audit.
- Spring endpoint `POST /api/v1/admin/trial-lead-meta/{leadId}/signed` requires admin role, CRM status `CONTRACT`, actual recent contract instant, legal-basis confirmation, nonblank token, and enabled feature gate.
- CAPI event name `ContractSigned`, browser pixel/event ID **1391828005920802**, source `system_generated`, CRM metadata. Only normalized, server-hashed parent phone goes to Meta; no child, school, class, or pedagogical data.
- No automatic send on application startup or variable change.
