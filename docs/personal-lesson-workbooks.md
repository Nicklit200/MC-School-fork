# Personal lesson worksheets pilot

The lesson keeps one shared workbook for everyone and an optional additional PDF
for each pupil. A personal upload does not replace the shared workbook, create
homework, or copy the worksheet to other pupils.

The pilot is enabled only for lessons owned by teacher
`14e3c7c1-1fc8-41bd-858a-6c20efdd957a`. Other teachers keep their existing behavior.
The owning teacher sees the per-pupil upload controls on the lesson preparation
page. Pupils see a third **Персональный лист** button beside **Общая доска** and
**Моя доска** in the classroom. The PDF and its annotations open in this separate
worksheet tab; the existing **Моя доска** keeps its previous behavior. The teacher
can inspect a pupil's personal worksheet independently of that pupil's board.

## Connector tools (MCP 1.24.0)

Both tools require a current active OAuth identity: the pilot teacher, or an
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

The response is `{enabled, students}`. Each current pupil has
`studentId`, `studentName`, `hasWorkbook`, `filename` and `version`. These IDs
are persisted student user UUIDs, the same identity used for their personal
board. Metadata does not contain PDF bytes, private teacher answers or transcripts.

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

## Privacy and persistence

Personal PDFs are keyed by teacher, calendar event and pupil. A class's host or
that particular admitted pupil may read the PDF and its revision through the
classroom document API using `boardId=personal-workbook-<studentUserId>`. A different
pupil cannot read either the file or its revision; waiting-room membership alone
does not grant access. Every request checks current lesson membership. Personal
worksheet tabs without an uploaded PDF return no personal document. Shared board,
My board (`personal-<studentUserId>`) and Personal worksheet
(`personal-workbook-<studentUserId>`) render and store annotations in separate scopes.

Replacing the shared workbook preserves every personal file. Replacing one
personal file preserves all other pupils' files and the shared workbook.
Uploading identical bytes with the same stored filename is also a no-op at the
storage layer. PDF answers and transcripts stay on their existing teacher-only
routes.
