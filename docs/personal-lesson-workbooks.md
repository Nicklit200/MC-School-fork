# Personal lesson worksheets pilot

The classroom has two pupil buttons: **Общая доска** and **Моя доска**.
The shared board always uses the lesson's shared PDF. My board uses that pupil's
personal PDF when one is assigned, otherwise the shared PDF, otherwise a blank
board. A personal upload does not replace the shared file, create homework, or
copy the worksheet to other pupils.
Each pupil's worksheet can also have a separate private PDF answer key for the
teacher. Answers are stored and served separately from the pupil's worksheet.

The pilot is enabled only for lessons owned by teacher
`14e3c7c1-1fc8-41bd-858a-6c20efdd957a`. Other teachers keep their existing behavior.
The owning teacher sees the per-pupil upload controls on the lesson preparation
page. A pupil opens both shared and individually assigned work through **Моя
доска**, without a third worksheet button. The teacher selects each pupil once
in the classroom selector and can upload a shared file for everyone or a file
for that pupil.

Document routing follows the same rule throughout preparation, the classroom,
and connector uploads:

| Uploaded documents | Shared board | My board |
|---|---|---|
| No PDFs | Blank background | Blank background |
| Shared PDF only | Shared PDF | Shared PDF for each pupil |
| Personal PDFs only | Blank background | Own PDF when assigned, otherwise blank |
| Shared and personal PDFs | Shared PDF | Own PDF when assigned, otherwise shared PDF |

Each pupil's annotations remain independent. Existing personal files, blank
pages and handwriting open through My board. Earlier handwriting associated
with a shared document stays in its original scope and remains separately
available to lesson exports. A blank background does not clear saved handwriting
from the same lesson.

The classroom upload action explicitly names a shared document for everyone,
including when the teacher opens a pupil's My board. The individual upload
explicitly names the selected pupil. The selected destination is captured when
the file picker opens, so switching surfaces cannot silently change recipients.

## Connector tools (MCP 1.26.0)

All personal worksheet and answer tools require a current active OAuth identity: the pilot teacher, or an
administrator exercising existing lesson-management authority. The selected
`teacherId` must always be the exact pilot teacher. Other teachers, anonymous
clients and the legacy PDF-import API key cannot discover or invoke these tools.
An administrator cannot enable personal worksheets for a different teacher.
After the server deployment, a connected client may need to refresh or reconnect
MCH3 to load the new tool catalog and input schemas cached by that client.

First find the exact calendar lesson using `find_lessons`, then invoke
`list_personal_lesson_workbooks`:

```json
{
  "teacherId": "14e3c7c1-1fc8-41bd-858a-6c20efdd957a",
  "eventId": "<exact eventId from find_lessons>"
}
```

The staff-only response is `{enabled, students}`. Each current pupil has
`studentId`, `studentName`, `hasWorkbook`, `filename`, `version`, `hasAnswers`,
`answersFilename` and `answersVersion`. These IDs
are persisted student user UUIDs, the same identity used for their personal
board. The answer fields describe availability and revision only. This response
does not contain PDF bytes, answer contents or transcripts and is never returned
through student classroom routes.

Upload only on the user's concrete instruction, selecting an exact `studentId`
from that response. Invoke `upload_personal_lesson_workbook`:

```json
{
  "teacherId": "14e3c7c1-1fc8-41bd-858a-6c20efdd957a",
  "eventId": "<exact eventId from find_lessons>",
  "studentId": "<studentId from list_personal_lesson_workbooks>",
  "filename": "personal-worksheet.pdf",
  "pdfBase64": "<base64-encoded PDF bytes>",
  "idempotencyKey": "personal-worksheet-request-001"
}
```

Provide exactly one file source: `pdfBase64` or `driveFileId` (a Google Drive ID
or URL readable by the selected teacher). The connector limit is 15 MB. Reuse
the same key and arguments when retrying an identical request. A changed file,
recipient or lesson is a new requested upload and needs a new key. Durable
operation receipts prevent a successful retry from applying the upload again;
each replay rechecks the current actor, teacher and lesson roster. Receipts store
only bounded response metadata, never the PDF. Successful upload returns the
selected pupil's worksheet metadata.

Existing `prepare_lesson` workbook uploads continue to update the shared file.
They do not overwrite any personal worksheet. Use the current school prompt and
Brand Guide when the user requests newly generated Mindcrafti teaching material.

### Private teacher answers for one personal worksheet

Invoke `upload_personal_lesson_answers` only for the exact pupil and lesson
identified above:

```json
{
  "teacherId": "14e3c7c1-1fc8-41bd-858a-6c20efdd957a",
  "eventId": "<exact eventId from find_lessons>",
  "studentId": "<studentId from list_personal_lesson_workbooks>",
  "filename": "personal-teacher-answers.pdf",
  "pdfBase64": "<base64-encoded teacher-answer PDF bytes>",
  "idempotencyKey": "personal-answers-request-001"
}
```

The same direct-upload/Drive choice, 15 MB connector limit, current roster
validation and stable retry-key rules apply. The answer upload has its own
operation receipt and returns `{studentId, hasAnswers, answersFilename, version}`
only. Private answer bytes are never returned by this tool, included in worksheet
uploads, or written to receipts. The selected pupil's worksheet and every other
pupil's answer file are preserved.

The teacher's answer panel reads the selected pupil's private answer key when
that pupil's My board is selected. Shared `prepare_lesson` answer
uploads and `attach_lesson_answers` continue to update the lesson's shared
teacher-answer file; they do not update a personal answer key.

## Privacy and persistence

Personal PDFs are keyed by teacher, calendar event and pupil. A class's host or
that particular admitted pupil may read the PDF and its revision through the
classroom document API using `boardId=personal-workbook-<studentUserId>`. A different
pupil cannot read either the file or its revision; waiting-room membership alone
does not grant access. Every request checks current lesson membership. A successful
private version probe of `0` confirms that My board may use the shared file;
pending requests, network failures and access errors do not grant that fallback.
For a non-pilot lesson the version probe also returns `0`, after admission,
ownership and current-roster checks; private bytes and annotations stay closed.

My board is a single UI choice backed by separate existing storage scopes.
Without a private assignment its real target is `personal-<studentUserId>` and
its background is the shared PDF. With a private assignment its real target is
`personal-workbook-<studentUserId>`, retaining that file's pages and handwriting.
The UI resolves the source live and remounts the paper panel when the source
changes. Page hints, pupil-view telemetry and teacher following use that real
target. Notebook camera annotations remain in their existing camera scope.
Legacy REST requests for the ordinary personal target still return the shared
PDF, so earlier shared-background notes and private notes can be exported
separately without overlaying them on a different worksheet.

Replacing the shared workbook preserves every personal file. Replacing one
personal file preserves all other pupils' files and the shared workbook.
Uploading identical bytes with the same stored filename is also a no-op at the
storage layer. Personal answer keys use a separate private table and authenticated
teacher-only endpoints, keyed by the same teacher, event and pupil. No student
classroom endpoint exposes their bytes or metadata. Shared answers and transcripts
keep their existing teacher-only routes.

## Completed lesson documents

For a calendar-linked lesson, the teacher's Leave and End actions wait for local
annotation writes, export every shared and personal source separately, save the
PDFs, and verify their IDs in the lesson archive before leaving. Manual Save uses
the same in-flight operation. Local board input pauses while this runs; failed
writes or archive requests keep the room open with a retry message. Student exits
and standalone test rooms do not trigger the teacher's archive.

Export replays all operation batches, including appended blank pages and ink past
the first 5,000 operations. A first archive may create lesson preparation only
after validating the exact owned room/event and the PDF. Historical ended rooms
retain their annotation rows, so a missing archive can be reconstructed from the
stored background PDF and operations. Closing the browser does not run an awaited
PDF export; use the lesson's Leave or End control to complete the archive.
