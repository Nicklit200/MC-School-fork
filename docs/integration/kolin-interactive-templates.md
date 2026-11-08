# Kolyn automatic materials and interactive construction

Kolyn also answers ordinary questions, gives teaching advice and explains previous tasks in text. Material format is inferred from the conversation only when material is requested. Asking `Что ты умеешь?`, `Как объяснить второе задание?` or questioning difficulty does not generate another worksheet. Explicit requests to create or change material still produce a private draft for confirmation. Intent and the answer share one model request. Text responses never have a recipient or an appendable artifact, even if the model returns stale recipient metadata.

The displayed assistant name is Kolyn. Internal `Kolin` classes, API routes and stored identifiers are retained for compatibility.

Kolyn chooses text, PDF or interactive material from the latest request and conversation in one structured model call. There is no format selector. `Дай пару заданий Алисе` requests five PDF tasks; `Покажи пирамиду с высотой` requests an interactive construction; `Как объяснить дробь?` receives a text explanation. An explicit PDF request takes precedence. Edits and transfers preserve the previous artifact format and recipient unless the teacher names another. The server ignores the legacy client format field, retained only for compatibility.

The provider envelope has separate text, worksheet and interactive branches. Static PDF visuals cannot populate an interactive branch, material recipients are limited to the lesson roster or `group`, and generated scenes with numerical answer checking have no displayed metrics. The public chat response remains unchanged. A known unsupported curved-body or general-net request becomes a text explanation instead of a misleading polyhedron, even when the provider tries to create one.

Normal generation uses one model request. If an interactive draft fails structural validation (for example, a height references a missing vertex), the server permits one additional repair request with the original recipient and count locked. A second invalid result is rejected before preview or append. This bounded recovery costs an extra model request only for invalid drafts; controls, rotation and numeric checks still use no AI calls.

A private read-only preview appears first. **Добавить [имя]** appends to the named pupil; **На общую доску** appends to the shared board. Unclear recipients require clarification. PDF defaults to five tasks; interactive defaults to one construction, with a maximum of five. Changes are never appended automatically.

Controls appear directly on the workbook page, with no open-editor button. Teacher and admitted pupil can change personal objects; shared objects use existing shared-board permissions. The graph supports linear and quadratic coefficients from -10 to 10. Triangle vertices stay within [-5, 5] and cannot become degenerate. Fraction circles contain 2 to 24 sectors. The cube has six rigid square faces, continuous folding, yaw and pitch. No model requests run when moving controls. A short model request selects the template and numeric parameters; the existing Kolyn context and transport are reused.

Inline controls share the canvas zoom and page coordinates. Pointer events on the controls do not draw ink. Writing remains available outside the object. Chat previews still open in a dialog. The model does not read workbook handwriting. The saved transcript continues to be used on teacher requests.

## General mathematical scenes

Kolyn remains a conversational teaching assistant in both PDF and interactive formats. The material format is inferred from the conversation. Questions such as `Это такие лёгкие в абитуре?`, requests for advice, explanations and discussion of a previous draft receive a text reply without creating a new artifact. Explicit requests such as `Сделай второе сложнее` still create a replacement draft for review. This intent choice uses the same single provider request, with the previous canonical draft and lesson context available; no separate classification call is added.

The fifth family, `scene`, combines up to 6 parameters, 12 named points and 12 objects on one page. Objects include segments, polygons, circles, function plots and one bar chart with up to 8 values. Coordinates, radii, graph formulas and up to 3 displayed measurements depend on the same parameters. Points can control a parameter by dragging or arrow keys. Example requests:

- `Для Виталины создай интерактивный прямоугольник с диагональю и описанной окружностью. Дай менять стороны и найти площадь.`
- `На общую доску создай интерактив sin(a*x)+b с ползунками a и b и подвижной точкой на графике.`
- `Сделай интерактивную диаграмму значений 2, 4, 6 и задание найти среднее.`

The model returns a bounded declarative description, never executable source. The local expression parser supports numbers, parameters, pi, arithmetic, powers, sin/cos/tan, sqrt, abs, ln and exp. Trigonometry uses radians. Expressions have length, token and depth limits; unknown symbols and references fail validation. Geometry uses equal axis scales; bar-only scenes can scale axes independently. Graph sampling is bounded and breaks at undefined or out-of-range values.

An optional numerical answer expression is evaluated locally for the current parameters, with absolute tolerance 0.000500001 (rounding to 3 decimal places). This is practice feedback, not a protected assessment or a proof checker. Undefined expressions do not produce a correct result. The teacher should review the proposed mathematical construction before adding it: structural validation cannot prove that every model-generated formula matches the intended question.

During board interaction, only parameter values can change. Task structure, formulas and answer expressions are immutable; requesting a different construction creates a new draft. All existing confirmation, ownership, revision and PDF export paths are reused. A normal draft uses one model call, with the single validation-repair exception described above; dragging, sliders and answer checking make no model calls. Arbitrary proofs and unsupported operators remain outside this constructor; the existing six-face cube with its folding net is retained.

## General 3D constructions

The `solid` family supports closed convex polyhedra described by 4-24 vertices, 4-24 planar convex faces (3-8 vertices each), up to 6 parameters and 6 auxiliary segments. Vertex coordinates are bounded mathematical expressions using the same parser as 2D scenes. The server and browser reject open, nonplanar, self-intersecting, nonconvex and degenerate constructions. These checks validate geometry, not the pedagogical interpretation of an arbitrary prompt.

Examples include square and pentagonal pyramids, triangular prisms and tetrahedra. Height/side controls change the actual coordinates. Yaw and pitch rotate the view. Only parameter values and camera angles can change on an added page; pupils cannot rewrite formulas, faces, task text or answer configuration. Invalid parameter combinations are rejected, preserving the previous valid state.

Volume and surface area are calculated from the actual mesh. Optional numerical answer checking uses these measurements directly with rounding tolerance 0.000500001; the requested measurement cannot also be displayed as a hint. Auxiliary height-foot points are excluded from the vertex count. Shared SVG/canvas primitives keep the board and PDF snapshot consistent. Rotation and controls do not call the model.

Curved surfaces, concave solids, arbitrary sections and general folding nets are not supported. The existing cube net remains available. No executable HTML, JavaScript, arbitrary shaders or external assets are generated.

## Persistence and privacy

Drafts reuse `kolin_worksheets` with result type `interactive` and validated canonical task content. No database migration is needed. Confirmation transactionally appends blank PDF pages, teacher-owned annotation objects and the durable receipt; repeated confirmation returns the existing receipt. Original PDF pages and annotation documents are preserved.

Objects live in personal workbook annotation documents or `board-1`. Shared destinations are stored explicitly as `studentId="group"` in canonical content, with a null database pupil reference and `targetType="group"` in response metadata. Null pupil IDs alone never authorize shared append. Shared appends preserve inherited annotation extents as well as existing PDF pages. Existing admission and ownership checks remain in force. Updates include the last accepted operation ID and are serialized under the document lock. A concurrent stale edit is rejected; an inline reload action adopts the refreshed state. No arbitrary JavaScript, SVG or HTML is accepted. Number bounds and the template family are checked on the server.

The board's PDF export includes the current rendered object and annotations. The underlying workbook PDF alone contains the page backgrounds; interactive parameters live in the annotation log.

## Verification

- `MathSolidSpecTest` and browser `mathSolid.test.tsx`: shared mesh fixtures, independent geometric measurements, invalid meshes, immutable construction and controls.
- Optional captured-provider validation: pass `-Dkolin.generatedFixtureDir=/path/to/generated` when running `MathSolidSpecTest`. The fixtures are synthetic live responses, excluded from the repository and normal CI; no model calls or keys are needed for replay.
- `InteractiveTemplateSpecTest`: closed schemas, numeric limits and revision payloads.
- `MathSceneSpecTest` and `mathScene.test.tsx`: shared geometry/function/data fixtures, bounded expression grammar, dependent coordinates, answer tolerance and immutable construction. PostgreSQL integration also covers scene replay and rejection of pupil formula edits.
- `KolinOpenAiPayloadTest`: one structured request, no attachments, automatic format selection, unified closed schema and 6500-token output ceiling (charged output remains the actual response).
- `KolinTaskServiceTest`: private draft with no PDF renderer or automatic append.
- `KolinWorkbookAppendIntegrationTest`: real PostgreSQL, confirmation idempotency, teacher/pupil replay, stale and concurrent edits, access restrictions and atomic rollback.
- Frontend tests cover independent mathematics, strict parsing, controls, revisions, read-only previews and confirmation.
- `node e2e/interactive-start-vite.mjs` serves `/e2e/interactive-templates.html` locally on port 4185. This visual fixture shares state in memory between teacher/pupil views; server persistence is covered separately by integration tests.

Before production release, run CI and obtain the owner's approval. After deployment, verify generation, explicit append, reconnect and PDF export in a separate synthetic lesson.
