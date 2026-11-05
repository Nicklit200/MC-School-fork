# Mindcrafti Workbook Generator

Version `2026-11-05-v4-fast-shared`. The backend creates a Student Workbook PDF and a separate Teacher Answers PDF. AI produces structured lesson JSON. Code produces layout, MathJax SVG, graphs, geometry and PDFs. Text, formulas and coordinate systems are never generated as AI images.

Teachers should use the server-side workbook generation tool. The source-code retrieval endpoint remains owner/admin only. The implementation becomes available in MCH3 after the backend containing this version is deployed; a Git push alone does not verify deployment.

## Teacher workflow

1. Find the exact lesson with `find_lessons`.
2. Call `generate_lesson_workbook_draft` with `eventId`, optional `instruction`, and a stable `idempotencyKey`. Teachers may omit `teacherId`; ADMIN must select the accessible teacher explicitly.
3. Download both unpublished PDFs with `download_lesson_draft_pdf` and review them.
4. After the user's explicit publication instruction, call `publish_lesson_draft` with `draftId`, `confirm:true`, and a stable publication `idempotencyKey`.

Server AI configuration is optional. If unavailable, ChatGPT first calls `prepare_workbook_context`, prepares content-only `lessonJson` from its declarative `rendererContract`, then supplies `lessonJson` and the fresh `contextToken` to the same `generate_lesson_workbook_draft` tool. Rendering and QA still run on the server, without exposing generator source. The token binds the lesson, prompts, Brand Guide and available student evidence; stale context is rejected.

Generation reads current school prompts, the current Brand Guide, the available monthly plan, exact lesson and student/group, prior notes/transcript, profile facts and documented recent card/homework evidence. Missing information remains missing. A handwritten submission is not classified as wrong without actual analysis. A plan's candidate lesson is not proof that a topic has been taught.

Active OAuth teachers may generate, download and publish only their own lessons. ADMIN may select an accessible teacher. Students, parents and API keys cannot use server generation. The `generate_workbook` and v3 `create_lesson_draft` compatibility routes accept teachers with fresh context tokens and idempotency keys. Source access through `get_owner_workbook_generator` remains owner/admin only.

Draft creation does not change lesson materials. Publication replaces the approved common workbook/answers slots and reads back event ID, flags, filenames and sizes. It preserves schedule, transcript, homework, status, other pupils' private worksheets and annotations. Personal workbooks take priority on My board; Shared board uses the common workbook. Personal answers stay staff-only.

For PDFs generated or attached in ChatGPT, prefer direct file input. Do not upload to Google Drive as an intermediate step. Use Google Drive only when the source document already exists there. Each supplied PDF slot accepts exactly one of direct file, legacy base64, or existing Drive file ID. Omitted slots remain unchanged. See [INTEGRATION.md](INTEGRATION.md).

## Runtime and verification

The server reuses an immutable renderer runtime and caches the extracted logo until the current Brand Guide revision changes. Both PDFs render in one warm Python process, with independent geometry and hash checks. A bounded preflight rejects clearly excessive page layouts before PDF rendering. At most two generation jobs run per server instance.

Requirements: Node 20+, Python 3.10+, system Pango/Cairo libraries and fonts. Production geometry inspection is pinned to **WeasyPrint 70.0**. Install the committed npm lockfile and `requirements.txt`.

```sh
npm ci --ignore-scripts
python3 -m pip install -r requirements.txt
npm test
python3 -m unittest algebra_qa_test pdf_qa_test
node generate.mjs --lesson=lesson.sample.json --out=out/sample --basename=Mindcrafti_Sample
```

Generation automatically runs algebra and PDF QA. Outputs include separate `*_Arbeitsheft_<minutes>min.pdf` and `*_Lehrerloesungen_<minutes>min.pdf`, HTML masters, `<base>_math-qa.json`, `<base>_layout-qa.json`, and a SHA-256-bound geometry report beside each PDF. `meta.durationMinutes` must be an integer from 30 to 240. Use a distinct output folder per lesson. Supply the current official logo through `--logo=/path/current-logo.png`; the sample logo is for anonymized fixtures.

```sh
node generate.mjs --lesson=/path/lesson.json --out=/path/draft --basename=Mindcrafti_Lesson --logo=/path/current-logo.png
python3 verify_pdf.py /path/lesson.json /path/draft --basename=Mindcrafti_Lesson
```

`PYTHON_BIN` selects Python. `--html-only` creates review HTML and math QA. Chromium remains a development option, but production PDF verification requires the pinned WeasyPrint geometry report and rejects exports without it. CI runs math/layout/diagram/algebra and QA rejection tests and renders all five legacy/current fixtures. A separate Docker smoke job extracts only known renderer resources from the packaged JAR and renders a current and legacy fixture using the installed MathJax/WeasyPrint runtime, as the non-root app user with networking disabled. Human review remains necessary for teaching suitability and visual details beyond automated checks.

## Math and rich text

[lesson-schema.d.ts](lesson-schema.d.ts) describes the input. New math uses `{ "latex": "..." }`. `{ "tokens": [...] }` and legacy token arrays remain supported. JSON LaTeX uses an escaped backslash:

```json
{"latex":"\\frac{x+2}{x-3}"}
```

Rich text supports inline formulas in descriptions, subtitles, callouts, examples, explanations, solutions, given/find facts and answer labels:

```json
{
  "type":"richText",
  "content":[
    {"text":"Bestimme den Schnittpunkt von "},
    {"math":"y=2x-1"},
    {"text":" und "},
    {"math":{"latex":"y=5-x"}},
    {"text":"."}
  ]
}
```

MathJax 4 renders formulas to SVG and rejects error nodes. Inline line breaking is disabled so each expression is a complete SVG. Text is escaped; lesson data cannot supply HTML, SVG, JavaScript or resource URLs. The PDF renderer denies network and local-file resource fetching.

## Layout

Reusable blocks: `row`, `column`, `grid`, `split`, `stack`, `taskCard`, `answerLines`, `answerBox`, `coordinateGrid`, `matching`, `studentHeader`, `conclusionBox`, `spacer`, `divider`. Existing exercises, callouts, facts, examples, solutions, geometry and schedules remain compatible.

```json
{
  "type":"split", "columns":["42%","58%"], "gap":"6mm",
  "left":[{"type":"taskCard","title":"Zeichne die Gerade.","children":[{"type":"answerLines","lines":3}]}],
  "right":[{"type":"coordinateGrid","xRange":[-5,5],"yRange":[-5,5],"gridStep":1,"showAxisLabels":true}]
}
```

Use `grid` with `columns:2` and `children` for adjacent tasks. `matching` takes `left`/`right` arrays and optional zero-based `matches`; connections appear only in teacher output with `showConnections:true`. `studentHeader` defaults to Name/Klasse/Datum. Layout dimensions accept bounded `mm`, `px` and `em`; split percentages total 100% and account for the gap.

The Mindcrafti design uses A4, the original official logo on every page, Inter with Arial fallback, navy `#070A20`, orange `#FF6A00`, light orange `#FF8A1D`, soft orange `#FFF3E8`, gray `#6B7280`, line `#E5E7EB` and white. Student text is German. Geometry defaults to A/B/C vertices, a/b/c sides and Greek angle labels; numerical givens belong separately in `facts`.

## Graphs

Axes share one physical scale. `coordinateGrid` uses the same scale without functions. Graphs support up to three series:

| Kind | Parameters |
|---|---|
| `linear` | `m`, `b` |
| `quadratic` | `a`, `b`, `c` |
| `polynomial` | constant-first `coefficients`, degree at most 4 |
| `sine`, `cosine` | `amplitude`, `frequency`, optional `phase`, `offset` |
| `absolute` | `a * abs(x-h) + k` |
| `reciprocal` | `a / (x-h) + k` |
| `sqrt` | `a * sqrt(x-h) + k`, real domain only |
| `exponential` | `a * base^(x-h) + k`, default base e |
| `logarithmic` / `log` | `a * log_base(x-h) + k`, default base 10 |
| `constant` | `value` (or `c`) |
| `rational` | constant-first `numerator`/`denominator`, each degree at most 4 |
| `piecewise` | `pieces:[{domain:[min,max],function:{...},includeStart:true,includeEnd:false}]` |

For translated functions, `a`, `h`, `k` default to 1, 0, 0. Piecewise intervals cannot overlap. Curves split at poles and branch/domain boundaries; removable holes are open circles. Legends derive from coefficients. Manual labels produce QA warnings when they differ from the canonical formula.

```json
{
  "type":"graph", "xRange":[-5,5], "yRange":[-5,5], "showIntersections":true,
  "series":[{"kind":"linear","m":2,"b":-1},{"kind":"linear","m":-1,"b":5}]
}
```

`computeIntersections(graph)` returns in-range `{x,y,seriesIndices}` and excludes poles. Teacher `intersectionResult` blocks take the same graph definition and reuse its calculation. Polynomial/rational intersections use derivative root isolation; other families use numerical sampling, bisection and minimization. Their coordinates are estimates: high frequencies or narrow features can require a tighter range. Coincident curves have no isolated intersection output.

## Algebra and visual QA limits

Assertions for actual tasks/answers go in `qa.algebra` or an item's `validation`:

```json
{
  "qa":{"algebra":[
    {"kind":"equivalence","expression":"(x+3)^2","answer":"x^2+6*x+9","restrictions":[]},
    {"kind":"solution","equation":"2*x-1=5-x","solution":{"x":2},"restrictions":[]},
    {"kind":"equivalence","expression":"(x^2-9)/(x-3)","answer":"x+3","restrictions":["x != 3"]}
  ]}
}
```

The bounded parser builds SymPy expressions without evaluating source code. It verifies supplied equivalences and candidate solutions by substitution, including denominator exclusions. It does not prove a solution list is complete or validate unrelated free-text answers. Reports disclose assertion count/coverage; a legacy document with no assertions has no algebra coverage. Server-generated content must include an assertion matching actual content.

PDF QA checks readable A4 pages/count, branding presence, raw LaTeX/MathJax errors, painted bounds, footer clearance, task fragmentation, answer minimums, SVG/container overflow, accidental blank pages and the PDF/report hash. Structural QA cannot verify every word problem, theorem or diagram-label collision. Review both PDFs before publication.

Never add real names, transcripts, private educational histories or real-lesson PDFs to regression fixtures. Canonical source: `Nicklit200/MC-School-fork`, branch `integration/railway-and-ux`, this resource directory.
