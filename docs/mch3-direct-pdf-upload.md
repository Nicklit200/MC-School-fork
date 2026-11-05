# Direct PDF input for MCH3 1.29.1

For PDFs already created or attached in ChatGPT, prefer the direct file input.
Do NOT upload to Google Drive as an intermediate step.
Use Google Drive only when the source file already lives there.

## Supported tools

| Tool | Direct file field | Existing sources retained |
| --- | --- | --- |
| `prepare_lesson` | `workbookFile`, `answersFile` | `workbookBase64`, `answersBase64`, `driveWorkbookFileId`, `driveAnswersFileId` |
| `upload_personal_lesson_workbook` | `pdfFile` | `pdfBase64`, `driveFileId` |
| `upload_personal_lesson_answers` | `pdfFile` | `pdfBase64`, `driveFileId` |
| `execute_site_function` for `lesson_preparation.uploadWorkbook` | top-level `file` | `arguments.file = { filename, contentType, base64 }` |
| `execute_site_function` for `lesson_preparation.uploadAnswers` | top-level `file` | `arguments.file = { filename, contentType, base64 }` |

File fields use the ChatGPT file-parameter contract from the
[official OpenAI documentation](https://developers.openai.com/plugins/reference#define-file-inputs).
Their tool descriptors declare `_meta["openai/fileParams"]`. The host supplies an
object with required `download_url` and `file_id`, plus optional `mime_type` and
`file_name`. All four properties are declared in the schema. A local path is not
a backend file capability. Do not put `/mnt/data/...`, a Windows path, or
`file://...` in a base64 field or a download URL.

The host handles the transfer of its authorized file input. The server receives
a short-lived HTTPS capability and resolves the PDF bytes directly. It does not
read the client's local path and needs no Google Drive or OpenAI API key.

After deployment, use ChatGPT Settings > Plugins > MCH3 > Manage > Refresh tools,
then start a NEW chat so it discovers the new schemas and file-parameter metadata.
An already active chat can retain the old catalog even after tools are refreshed. If the host does not
offer file transfer for a particular local/generated file, do not invent a
download URL or claim that passing a local path worked.

The advertised file-tool schemas are flat objects so host normalization cannot
make source alternatives overlap. The backend still checks exactly one populated
source per PDF before downloading or writing; blank legacy source strings are
ignored, and conflicting nonblank sources return `exactly_one_source_required`.

## Workflow

1. Create and inspect the PDF documents in the ChatGPT runtime.
2. Obtain the teacher's instruction to upload them.
3. Identify the exact teacher and event using `find_lessons`; preserve their IDs.
4. Call `prepare_lesson` with the two runtime file inputs and a stable
   `idempotencyKey`. Send explicit filenames when they differ from the runtime's
   original names. Do not manually construct a large base64 string.
5. Read `get_lesson_preparation` for the same teacher/event and verify both
   filenames, flags, byte lengths and versions.

Example server-side JSON-RPC arguments after the host resolves its files:

```json
{
  "teacherId": "<verified teacher UUID>",
  "eventId": "<verified event ID>",
  "idempotencyKey": "lesson-pdfs-reviewed-upload-001",
  "workbookFile": {
    "file_id": "<runtime-issued workbook file ID>",
    "download_url": "<temporary trusted HTTPS download URL>",
    "mime_type": "application/pdf",
    "file_name": "Рабочий_лист.pdf"
  },
  "answersFile": {
    "file_id": "<runtime-issued answers file ID>",
    "download_url": "<temporary trusted HTTPS download URL>",
    "mime_type": "application/pdf",
    "file_name": "Ответы_к_уроку.pdf"
  }
}
```

For a generic upload, inspect `get_site_function` first, then use:

```json
{
  "functionId": "lesson_preparation.uploadWorkbook",
  "teacherId": "<verified teacher UUID>",
  "arguments": { "eventId": "<verified event ID>" },
  "file": {
    "file_id": "<runtime-issued file ID>",
    "download_url": "<temporary trusted HTTPS download URL>",
    "mime_type": "application/pdf",
    "file_name": "Рабочий_лист.pdf"
  },
  "confirm": true,
  "idempotencyKey": "workbook-reviewed-upload-001"
}
```

The generic top-level file mapping is fixed to these two preparation operations.
Other website functions cannot use it to fetch arbitrary URLs or write files.
The same `PdfInput` and `ChatGptPdfResolver` can be reused by future PDF tools
after their own operation-specific authorization has been implemented.

## Compatibility and mutation guarantees

- Exactly one source per supplied PDF: attachment, base64 or existing Drive ID.
  Two sources return a validation error containing `exactly_one_source_required`.
  A notes-only `prepare_lesson` may omit both PDF slots.
- Existing base64 and Drive inputs remain available. New shared attachment
  uploads require OAuth and `idempotencyKey`; legacy shared callers without a
  key retain their earlier interface.
- The shared pair is fully resolved and validated before one database
  transaction updates it. A failed second download or invalid PDF cannot leave
  the first PDF or notes partially replaced.
- Omitted PDF slots and note fields remain unchanged. Explicit empty notes can
  clear that field. Transcripts, homework, personal materials, annotations and
  schedule identities are not deleted by a shared PDF replacement.
- The saved receipt uses the stable file ID and normalized metadata, never the
  signed URL. Retrying the same action with a refreshed or expired URL returns
  its stored result without another download or version increment. Different
  source identities under the same key return a conflict.
- Personal upload access and pilot restrictions remain in force. Their previous
  base64/Drive receipt identities are preserved for compatibility.
- Saving shared answers no longer implicitly calls Drive. Archiving remains an
  explicit `archiveToDrive` action.

Shared upload/read responses include `success`, `eventId`, `hasWorkbook`,
`workbookFilename`, `workbookSizeBytes`, `workbookVersion`, `hasAnswers`,
`answersFilename`, `answersSizeBytes` and `answersVersion`. Each document has an
independent version. Migration V99 backfills existing nonempty documents to
version 1, without changing their bytes or notes.

## File validation and deployment settings

- Attachment and MCP upload limit: 15 MiB per PDF. Existing generic aggregate
  limits and native website upload limits remain unchanged.
- Declared MIME, when provided, must be `application/pdf`. A trusted binary
  HTTP response may use `application/octet-stream`; `%PDF-` and PDFBox checks
  still verify a readable, unencrypted PDF with at least one page.
- Empty, malformed, oversized and unreadable files are rejected. Filenames
  retain Unicode while removing path components and unsafe characters.
- Only HTTPS on port 443 to exact trusted hostnames is accepted. No local paths,
  userinfo, redirects or encoded/compressed responses. DNS answers are checked
  for public addresses again at the actual connection to prevent rebinding.
- HTTP uses bounded streaming and connection/read/request timeouts. No school,
  Google or incoming OAuth credentials are forwarded to the file host. Errors
  and receipt payloads do not expose signed URLs or file bytes.
- `MINDCRAFTI_CHATGPT_FILE_HOSTS` defaults to `files.oaiusercontent.com`.
  The OpenAI file-input specification does not promise a fixed hostname.
  If the actual host supplies another origin, an administrator must verify and
  explicitly add that exact trusted hostname before the live test. Do not allow
  arbitrary domains, wildcard cloud-storage domains or private destinations.

## Tests

Unit tests cover real generated PDFs, metadata, source conflicts, signature,
MIME, size, filename safety, SSRF, ownership, receipt replay and pair preservation.
`McpSiteFunctionsTransportIntegrationTest` exercises actual JSON-RPC dispatch,
authorization, migrated PostgreSQL storage, replacement and readback. Its file
transport is mocked so no student PDFs or credentials go to external services.

CI uses Testcontainers PostgreSQL. For a local Windows review without Docker,
set `MCH3_TEST_DATABASE_URL` to a dedicated database matching
`jdbc:postgresql://127.0.0.1:<port>/mch3_pdf_test<suffix>` and optional
`MCH3_TEST_DATABASE_USER` / `MCH3_TEST_DATABASE_PASSWORD`. The fixture tests
truncate that dedicated database. They refuse arbitrary remote database URLs.

```text
mvn -Dtest=ChatGptPdfResolverTest,LessonPreparationMaterialsTest,NativeLessonPdfCompatibilityTest,McpDirectPdfToolsTest,McpPersonalLessonWorkbookToolsTest,McpSiteFunctionsServiceTest,McpSiteFunctionsTransportIntegrationTest test
```

Before calling the complete hosted workflow verified, deploy the change,
refresh MCH3 in the actual host, upload two inspected neutral test PDFs to an
explicit test lesson using real runtime file inputs, then read that lesson back.
An isolated HTTP/database test alone does not prove the host transferred its
generated local file successfully. Do not overwrite a real pupil's materials
just to test this connector change.

## Shared board refresh behavior

The classroom revision probe uses the independent workbook version, not the optimistic-lock version of the entire preparation row. Saving notes, private answers, a transcript attachment, or a live Soniox transcript therefore leaves the shared board revision unchanged. Replacing or appending the workbook increments the revision and still refreshes the board. This prevents the four-second polling fallback from reopening an unchanged PDF during a call.
