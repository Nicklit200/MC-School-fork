# MCH3 website capability catalog

The connector keeps its dedicated preparation, homework, analytics, skills, BrandGuide,
Stories and owner-only tools. Scheduling has dedicated `create_lesson`,
`create_lesson_series`, `update_lesson`, `delete_lesson` and `assign_lesson` tools.
The owner-lesson personal worksheet pilot has dedicated
`list_personal_lesson_workbooks` and `upload_personal_lesson_workbook` tools;
see [Personal lesson worksheets](personal-lesson-workbooks.md) for access,
upload and retry rules. The shared workbook remains a separate common material.
The finite website catalog adds explicitly reviewed administrative and teacher operations below.
It does not claim to reproduce device interaction, credentials or student study sessions.

## Discovery and invocation

1. `list_site_functions` accepts optional `domain`, `offset` and `limit` (1–100).
   The response contains the caller's permitted catalog, mutation/destructive metadata,
   pagination and explicit exceptions. Teachers never discover ADMIN-only functions.
2. `get_site_function` accepts the exact `functionId` and returns its argument schema,
   scope, file limits, write requirements and any preferred dedicated tool.
3. `read_site_function` runs only catalog functions marked `readOnly=true`.
4. `execute_site_function` runs only mutations. Every mutation requires `confirm=true`
   for the user's concrete requested action and a stable printable `idempotencyKey`
   of 8–128 characters. Reuse the key only when retrying identical arguments.

`arguments` is a JSON object. Path/query parameters use their declared names. A JSON
request DTO is always `body`. The schema rejects unknown fields and identifies nested
DTO fields and validation limits. Uploads use `{filename, contentType, base64}`; no URL
or local filesystem path is fetched.

For a teacher, the selected teacher defaults to the caller. An administrator must supply
an explicit top-level `teacherId` for `TEACHER` functions. The account is reloaded and
must still be an active teacher. An administrator's original identity remains in the audit
context while controller method security sees that selected teacher. A teacher cannot
select another teacher. `ADMIN` functions run as the administrator; a path parameter
such as `arguments.teacherId` is an ordinary target, not an identity switch.

Example read:

```json
{
  "functionId": "students.listStudents",
  "teacherId": "00000000-0000-0000-0000-000000000001",
  "arguments": {}
}
```

Example user-requested mutation:

```json
{
  "functionId": "groups.create",
  "teacherId": "00000000-0000-0000-0000-000000000001",
  "arguments": {
    "body": {
      "name": "Math group",
      "studentIds": ["00000000-0000-0000-0000-000000000002"]
    }
  },
  "confirm": true,
  "idempotencyKey": "create-math-group-request-001"
}
```

## Capability matrix

The exact IDs are `domain.method` below. This is an explicit source-code allowlist;
adding a new HTTP endpoint does not make it available through MCH3.

| Domain | Scope | Permitted methods / boundaries |
|---|---|---|
| `students` | TEACHER | `createStudent`, `listStudents`, `getStudent`, `updateStudentName`, `updateLearningProfile`, `updateDriveFolder`, `updateHomeworkDriveFolder`, `updateTranscriptDriveFolder`, `reviewHistory`, `deleteStudent`, `deactivate`, `reactivate`, `updateChatGptProject`. Creation returns the public profile; invitation credentials are removed before any receipt is stored. |
| `groups` | TEACHER | `list`, `get`, `create`, `addMembers`, `updateTranscriptFolder`, `createCard`, `importCards`, `createPdfHomework`. Each supplied member is checked against the teacher's current students. |
| `cards` | TEACHER | `createCardInHomework`, `listCards`, `listCardsForHomework`, `summary`, `previewImport`, `importCardsIntoHomework`, `updateCard`, `deleteCard`. Import preview is read-only despite its HTTP POST method. |
| `homework` | TEACHER | `createHomework`, `createPdfHomework`, `listForTeacher`, `deleteHomework`, `uploadWorksheet`, `downloadWorksheet`, `teacherWorksheetPage`, `submissionPageCount`, `teacherSubmissionPage`, `downloadSubmission`. Existing dedicated homework tools remain preferred. |
| `monthly_plans` | TEACHER | `get`, `save`, `uploadDocument`, `downloadDocument`, with current student/group ownership. |
| `lessons` | TEACHER | `listGroupLessons`; schedule mutations use the dedicated scheduling tools. |
| `lesson_preparation` | TEACHER | `get`, `update`, `uploadWorkbook`, `appendWorkbook`, `workbook`, `uploadAnswers`, `uploadTranscript`, `transcript`, `answers`, `archiveToDrive`, `assignHomeworkSeries`. Dedicated PDF/preparation tools remain preferred. `get` creates a row when absent, so it is classified as a mutation. |
| `lesson_transcripts` | TEACHER | `get` reads saved automatic Soniox text, manual teacher text, or extracted uploaded PDF text as separate sources, with Unicode pagination and pinned content revisions. It does not create a preparation or generate/OCR a PDF. See [Reading saved lesson transcripts](lesson-transcripts-mcp.md). |
| `completed_documents` | TEACHER | `list`, `save`, `uploadManual`, `download`. The underlying controllers validate lesson/class/document ownership and PDF contents. |
| `lesson_history` | TEACHER | `list`, `detail`, `completedDocuments`, `completedDocument`, `document`. Former-teacher materials remain governed by the dedicated transferred-history access policy. |
| `ai_pilot` | CALLER | `status`, `settings`, `updateSettings`, `prepare`, `analyze`; original-actor private owner and controller role checks are preserved. Administrators cannot delegate into the owner's pilot access. Settings accept only `enabled` and `preparationTime`. |
| `meet_events` | TEACHER | `status`, `ensureSubscription`; the current teacher's configured Google Meet subscription is managed without returning OAuth credentials. |
| `online_classes` | TEACHER | Materialization/test class, discovery/detail, lobby/start/end/cancel, diagnostics; admission list/approve/reject/approveAll; participants/attendance/mute/unmute request/remove/permissions/muteAll; screen-share/waiting-room settings; chat list/send/edit/delete; recording start/stop/list; transcription start/stop/list/text/VTT; annotation document/open/list/append/replay/snapshot. Room connection-token issuance, pupil knock/leave and recording-consent actions are excluded. |
| `class_documents` | TEACHER | `homework`, `documentVersion`, `document`; actual classroom access service is preserved. |
| `lesson_board` | TEACHER | `read`, `start`, `append`; actual board validation and global classroom feature switch are enforced. This is structured board control, not simulated Pencil input. |
| `notebook_camera` | TEACHER | `list`, `revoke`; global feature gate and current ownership are checked. QR pairing/phone/viewer credentials stay in the lesson browser. |
| `parents`, `parent_accounts` | TEACHER | `managedParents` / `list`. Password-bearing creation/reset and invitation flows are excluded. |
| `parent_messages` | CALLER | `list`, `send`, `image`. Current student access is checked. `send` requires the user's explicit requested action, confirmation and receipt. |
| `teachers` | ADMIN | `listTeachers`, `deleteTeacher`, `updateTrialTranscriptFolder`; password-bearing creation is excluded. |
| `admin_accounts` | ADMIN | `listAccounts`, `teacherOptions`, `assignStudentTeacher`, `transferStudents`; transfer uses the same website service and validations. |
| `admin_lessons` | ADMIN | `lessons`, `preparation`, `workbook`, `answers`, `transcript`. `preparation` creates a row when absent and is classified as a mutation. OAuth connection-state creation is excluded. |
| `trial_lessons`, `trial_leads` | ADMIN | Trial lesson `list`; leads `list`, `setStatus`, `delete`. Public lead submission/update tokens are excluded. |
| `site_visits` | ADMIN | `analytics`, `list`, `deleteVisit`; public tracking/telemetry endpoints are excluded. |
| `learning_time` | ADMIN/CALLER | School summary is ADMIN-only; per-student report uses the caller's actual access policy. Activity is never fabricated. |
| `drive` | ADMIN | `listSharedDrives`, `listFolders`, `listPdfFiles`, `download`, `upload`. These raw Drive IDs use the school service account and have no per-teacher folder guard, so the adapter exposes them only to administrators. Teachers use the existing scoped lesson/PDF tools. |
| `school_prompts`, `brand_guide` | CALLER/ADMIN | Staff reads; administrator updates. BrandGuide also provides `pdf`. Dedicated tools remain preferred. |
| `stories_template` | ADMIN | `info`, `upload`, `download`; approved master only, no public download-token entry point. |
| `skill_boards`, `skill_mastery` | CALLER/ADMIN | Board read and administrator revision-checked save; existing student/group mastery reads/history/update under the same service access policy. Always read the fresh board before editing it; existing dedicated tools remain preferred. |
| `account` | CALLER | `updateSettings` (own language settings); passwords excluded. |

`CALLER` means the current OAuth administrator or teacher, without automatic delegation.
The controller/service may impose stricter ownership checks. Read-only flags describe
actual behavior rather than assuming every HTTP GET is free of mutation.

## Intentional exceptions

- Account login/activation/passwords, impersonation, OAuth grant/callback/state/secret flows,
  public phone/session pairing and LiveKit connection credentials are excluded.
- Browser microphone/camera permission, actual media publishing, QR scanning, screen sharing,
  push-device subscription and live stylus gestures remain browser actions.
- Recording controls and metadata are available. Signed recording playback URLs are removed
  from catalog results and receipts; playback remains in the authenticated lesson browser.
- Student answering/study/submission, activity tracking, provider webhooks and internal
  transcript ingestion are not staff connector actions.
- Test-only account/reminder/card/Drive-export hooks stay outside the production catalog.
- Owner-only workbook generation and personal nutrition retain their dedicated access rules.
- Binary transport accepts PDF/PPTX/PNG/JPEG uploads with matching content markers,
  up to 15 MiB per file, 16 files and 30 MiB total. Downloads are capped at 15 MiB.
  Larger files and other upload formats must use the website. Normal DTO size limits still apply.

## Security and verification contract

Only school OAuth ADMIN/TEACHER identities can use these four tools. A legacy lesson-import
API key adds no privileges. Unknown functions, parameters, DTO fields, unsupported parameter
types and file sources fail closed. The adapter binds supported annotations to typed DTOs,
checks Jakarta validation, invokes the actual Spring proxy, and restores the original
SecurityContext in a `finally` block through `McpAccessService`.

External-effect functions are labeled explicitly. Drive provisioning/uploads, Push notifications,
AI/provider work, LiveKit controls, transcription/recording and object-storage snapshots use a
separate durable preclaim committed before the external action begins. If completion is uncertain,
the pending claim blocks automatic execution on retry. The caller must inspect current website state;
a new key is allowed only for a newly explicitly requested action. The generic mutation tool has
`idempotentHint=false`; database-only mutations still use atomic database receipts.

The board/notebook/classroom master switch and active-account gate are enforced explicitly;
direct controller invocation cannot bypass the HTTP-only authorization gate. Teacher-scoped
student/group/homework/card/class/camera/event targets are queried freshly, including before
returning an existing durable receipt. The real controllers continue to perform their own
resource/member/document validation. Credential fields are recursively removed from results
before persistence. Transport errors retain useful HTTP categories while discarding raw
SQL/provider/conversion messages. Writes returning large snapshots store bounded success
metadata; the matching read operation retrieves the full result.

Tests cover finite catalog exclusions, role visibility and explicit delegation, strict binding,
DTO validation, whitespace import separators, files/paths, safe errors, secret removal,
feature gates and fresh ownership before replay. The MCP transport integration test additionally
verifies actual JSON-RPC routing, school OAuth authority and persistent idempotency.
