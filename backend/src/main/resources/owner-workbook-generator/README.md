# Mindcrafti School — Workbook Generator v4

**Status:** server-side canonical workbook renderer with reusable vector geometry/graph components. Source retrieval remains owner/admin-only, while signed-in TEACHER accounts may generate unpublished drafts for their own exact lessons. Publication still requires explicit approval.

## Roles and intended workflow

- Only signed-in **ADMIN** or the explicitly allowed owner account can retrieve generator source through `get_owner_workbook_generator`; an API key cannot access source.
- Signed-in **TEACHER** accounts can use the server-side renderer only for lessons they own; ADMIN can select an accessible teacher.
- Generation saves an **unpublished draft** containing student workbook + teacher answers. It never modifies the live lesson until `publish_lesson_draft` is explicitly confirmed.
- Never include pupil names, emails, class transcripts, or private education histories in the public GitHub sample. `lesson.sample.json` is anonymized and illustrative.
- Every new real Mindcrafti document must first use the **current** school prompt, monthly plan and Brand Guide. When the logo is updated, extract the original M from the current Guide and supply it as `--logo=...` instead of relying on the bundled pilot asset.

## Files

- `generate.mjs`: HTML/SVG/print generator; rational math checks (no external npm modules).
- `diagrams.mjs`: coordinate-grid/function plotting and geometrically consistent SVG for 2D and 3D figures. Triangle vertices A/B/C, sides a/b/c, angles α/β/γ are the default; values are separate.
- `diagrams.test.mjs`: no-dependency tests for functions, dimensions, safety, and exact geometry.
- `examples/graphs-geometry-demo.json`: legacy illustrated graph/geometry test.
- `examples/clean-tasks-demo.json`: current **approved clean-diagram** sample with `Gegeben / Gesucht`, A/B/C, a/b/c, α/β/γ, parabola, cube and cuboid; anonymized.
- `styles.css`: fixed A4 design (official school colors; answer areas and vector graphics).
- `lesson.sample.json`: **anonymized** six-page math worksheet and three-page teacher answer plan, using a reusable, typed content structure.
- `render_pdf.py`: WeasyPrint HTML → A4 PDF rendering.
- `verify_pdf.py`: PDF structure, logo and overflow checks.
- `assets/logo-m.png`: source image from the approved school Brand Guide at pilot creation time.

## Local / ChatGPT execution

Requirements: Node 20+, Python 3.10+, `weasyprint`, `pymupdf`.

```sh
python3 -m pip install 'weasyprint>=60' pymupdf
node diagrams.test.mjs
node generate.mjs --lesson=lesson.sample.json --basename=Mindcrafti_Pilot_20261019
python3 verify_pdf.py lesson.sample.json out
```

For a new lesson, write a new JSON file in the same schema with original, checked schoolwork and teacher answers. Use a **new output folder** per lesson so filenames never accidentally mix. Use optional flags:

```sh
node generate.mjs --lesson=/tmp/new-lesson.json --out=/tmp/workbook-2026-10-26 --basename=Mindcrafti_Gruppe1_20261026 --logo=/tmp/current-official-logo.png
python3 verify_pdf.py /tmp/new-lesson.json /tmp/workbook-2026-10-26
```

Expected output: `*_Arbeitsheft_90min.pdf` and `*_Lehrerloesungen_90min.pdf` plus the corresponding HTML files. A non-90-minute lesson requires adapting its `time` labels and filename suffix in the data/template; don't simply relabel an incorrectly timed lesson.

Use `node generate.mjs --html-only` to inspect/edit source HTML without PDF conversion. `node generate.mjs --engine=chromium` is an alternate renderer when Chromium is installed; the approved pilot default remains WeasyPrint to preserve visual parity with the reference.

## Design contract

- Page size A4; official palette: navy `#070A20`, orange `#FF6A00`.
- One original official M logo per page; no fabricated logo.
- Student worksheets are in German; teacher answer key is a **separate PDF**.
- Math expressions are vector SVG; fractional rectangles are vector SVG.
- A4 layout must not overlap footer or crop mathematical notation, even on iPad zoom.
- Never auto-publish student material; never expose teacher answers to students.

## Scope / limitations

Pilot v3 supports fractions and fraction bars, **equal-scale coordinate grids**, function graphs of types `linear`, `quadratic`, `polynomial` (degree ≤ 4), `sine`, and `cosine`, plus `triangle`, `rectangle`, `quadrilateral`, `circle`, `cube`, and `cuboid` figures. The image is precise vector SVG, not a generated bitmap. Geometry side labels and angle arcs are computed from input coordinates, and rectangle constraints are checked. **Not yet supported:** arbitrary expression parsing, 3D perspective/measurement validation for arbitrary solids, constructions with compasses, advanced geometric theorem validation. The rational-answer checker verifies numeric chains, not free-text or algebraic answers; human review is still required.

## Backend pilot endpoint

Call the owner-only MCP tool `get_owner_workbook_generator` without parameters for version/file metadata. Then request `file="generate.mjs"`, `file="diagrams.mjs"`, `file="styles.css"`, `file="lesson.sample.json"`, and `file="examples/graphs-geometry-demo.json"` as needed. The tool does **not** execute code or publish; code runs in ChatGPT's working environment. Fetch current Brand Guide fresh before making new school documents.


## New SVG component format (v2)

Embed each diagram directly as one `blocks[]` entry (in student or teacher page):

```json
{
  "type":"graph", "label":"KOORDINATENSYSTEM", "xRange":[-5,5], "yRange":[-4,6], "gridStep":1,
  "series":[{"kind":"linear","m":1,"b":1,"label":"f(x) = x + 1"}]
}
```

```json
{
  "type":"geometry", "figure":"triangle", "unit":"cm", "showSides":true, "showAngles":true,
  "vertices":[{"label":"A","x":0,"y":0},{"label":"B","x":6,"y":0},{"label":"C","x":0,"y":8}]
}
```

See `examples/graphs-geometry-demo.json` for tested quadratic, circle, rectangle and point examples. To generate a preview:

```sh
node generate.mjs --lesson=examples/graphs-geometry-demo.json --out=/tmp/mindcrafti-diagrams --basename=Mindcrafti_Diagram_Pilot
```

The function coefficients and geometry vertices are **data**; every rendered path is computed, no unsafe `eval` and no user-supplied SVG markup. Every new PDF gets mandatory page-layout QA. Run diagram unit tests before changing plotting logic. Plot function legends are human-specified strings, so always cross-check them against coefficients before publication. If the user asks for a non-90-minute lesson, adapt pagination/timing conventions with deliberate QA.

## Geometry standard (2026-10-19, v3)

**Default rendering**: Use clean vector geometry, vertices A/B/C, conventional side letters `c` on AB, `a` on BC, `b` on CA, and angle labels α/β/γ. No lengths or angle-degree measurements inside the figure. For circle, show the symbolic radius `r` but not its numeric value. For cube/cuboid, never show numeric measures on edges by default. Supply task values separately using a `facts` block with `given` and `find`, displayed as **GEGEBEN** and **GESUCHT** cards below the diagram.

```json
{
  "type": "geometry", "figure": "triangle",
  "vertices": [{"label":"A","x":0,"y":0},{"label":"B","x":7,"y":0},{"label":"C","x":2,"y":5}],
  "showVertexLabels": true, "showSideLabels": true, "showAngleLabels": true,
  "showSides": false, "showAngles": false
}
```

```json
{
  "type": "facts", "label": "AUFGABENDATEN",
  "given": ["AB = 7 cm", "∠A ≈ 68,2°"],
  "find": ["Berechne den Umfang."]
}
```

Numeric measures can be explicitly requested (`showSides: true`, `showAngles: true`, `showRadiusMeasureOnFigure: true`, `showMeasuresOnFigure: true`) but should be exceptional. Values in `given` and free-text teacher answers are **not** derived or fully validated by the current code: manually review these against coordinates and computed outputs. The verifier catches page overflow but not every possible label collision or erroneous word problem; visual review remains mandatory.

### Permanent source of truth and future teacher rollout

- **Canonical storage:** `Nicklit200/MC-School-fork` → `integration/railway-and-ux` → `backend/src/main/resources/owner-workbook-generator/`. This is a **Git-versioned master**; the ChatGPT container and generated PDFs are temporary outputs, never the source of truth.
- **Current access:** source retrieval by `get_owner_workbook_generator` is for admin/owner only. Existing teachers still receive normal school prompts. No teacher-visible button, no automatic PDF publication.
- **Future rollout:** after testing, add a teacher-authorized connector workflow for creating draft workbooks from school lesson data, run the versioned renderer and checks, return student and teacher PDFs separately, and require teacher preview/approval before publication. Add role-based authorization on the backend. Do **not** merely expose the owner's source-fetch endpoint to teachers; that endpoint does not run PDF generation.
- **Validation gate:** run `node diagrams.test.mjs` and `python3 verify_pdf.py ...`, render and inspect representative A4 pages. Match lesson context with the current school prompt, learning plan and student needs; do not publish if numeric given data disagree with geometry or answers.
