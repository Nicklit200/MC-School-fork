# Private Stories Studio project saves through MCH3

MCP 1.28.0 adds `stories_studio.save` to the existing dynamic site catalog.
Discover it with `get_site_function`; no new top-level MCP tool is needed.
Only a current active OAuth administrator can use it. The project owner is
always that administrator. There is no owner selector or teacher delegation.
Teachers, students, parents, anonymous callers and the import API key cannot save.

## Read, back up, save and verify

1. Call `read_site_function` with `functionId=stories_studio.info`, `arguments={}`.
2. Read every `stories_studio.chunk` using that exact `version`, and verify the
   reconstructed UTF-8 bytes against the returned SHA-256. Keep this original
   backup, every existing template, unknown story fields and embedded logo.
3. Prepare the exact edited JSON. Obtain the user's approval for the concrete
   change. Saving updates the private editor project and does not publish or
   schedule content.
4. Call `execute_site_function` with the current version and a stable key:

```json
{
  "functionId": "stories_studio.save",
  "arguments": {
    "body": {
      "expectedVersion": 7,
      "projectJson": "EXACT_APPROVED_PROJECT_JSON_AS_A_STRING"
    }
  },
  "confirm": true,
  "idempotencyKey": "stories-add-approved-results-template-001"
}
```

Use the actual current version in place of 7. Version zero is accepted only
when this administrator has no saved project. The example string is a
placeholder, not a valid project. Inspect `get_site_function` for the exact schema.

The response contains bounded metadata, version, hash, size and chunk count.
For an identical retry reuse the same key and arguments. A changed payload with
the same key is rejected. A stale `expectedVersion` returns 409, so retain the
local draft, read the latest project and reconcile the change before another
explicitly approved save. Two concurrent saves with one expected version have
one winner. Never replace a key just to bypass an uncertain result.

After saving, read fresh `info`, all chunks and their SHA-256 again. Verify the
expected version and exact approved bytes. A replayed receipt describes the
original successful save; a later save can have advanced the live version.

## Supported documents and bounds

Legacy v1 remains accepted with `story`, nonblank `css` and `html`, and
`assets.logoSrc`, optionally `schema= mindcrafti.story-studio/1`.
The service stores the exact submitted string, without migrating or reformatting it.

The collection format is:

```json
{
  "schema": "mindcrafti.story-studio/2",
  "activeTemplateId": "template-2",
  "assets": { "logoSrc": "data:image/webp;base64,YQ==" },
  "templates": [
    { "id": "template-1", "name": "Новости", "story": {}, "css": ".story{}", "html": "<div>Original</div>" },
    { "id": "template-2", "name": "Результаты", "story": {}, "css": ".story{}", "html": "<div>Progress</div>" }
  ]
}
```

The short logo value above only illustrates the existing accepted data-URL
syntax. Preserve the user's actual embedded logo and do not replace it with this
example or a remote URL. The existing MIME/base64 rule accepts PNG, WebP or JPEG.

Collections contain 1 to 20 templates. IDs are unique, stable and match
`[A-Za-z0-9_-]{1,80}`. Names are nonblank strings of at most 80 characters,
including surrounding whitespace. The active ID must exist. Every template
contains a story object and nonblank CSS and HTML. Unknown story, template and
asset fields remain stored exactly, including photos and custom copy fields.

The complete project keeps the existing limits of 1,900,000 characters and
4 MiB of UTF-8 bytes. Only `stories_studio.save`'s declared `body.projectJson`
gets this larger text budget. Other site-function fields keep the generic
200,000-character budget. Download chunks remain 64 KiB and version-pinned.
The HTML/CSS/JSON is saved as project data; embedded text does not authorize
additional actions. The legacy PPTX master and publishing remain separate.
