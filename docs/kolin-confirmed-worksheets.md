# Confirmed Kolyn worksheets

The teacher's private chat can return a text answer or a saved PDF draft. A request
such as "дай пару заданий" means five exercises; an explicit supported count wins.
Follow-up edits retain the last draft's count unless the teacher requests another.
Kolyn uses the current lesson's saved final transcript and its last generated draft.
It does not read the pupil's source PDF or handwriting in this version.

The UI shows a cropped, clickable preview and one action naming the exact recipient.
Clicking the preview opens a larger full PDF. Only pressing Add changes the pupil's
workbook. Even a message saying "create and add" produces a draft first. The artifact's
recipient is fixed and cannot change when the teacher switches boards. The button
becomes disabled after confirmation, and lost responses can be retried safely.

## Rendering and mathematics

The existing MathJax/SVG/WeasyPrint generator has a plain mode with no Brand Guide,
logo, cover, progress bars or decorative footer. Up to five short conditions share
one A4 page; its remaining area is blank for solving. A cached PNG crops the empty
bottom area so the chat preview remains readable. Opening or confirming reuses the
saved bytes and never calls the model or renderer again.

One structured call uses the existing Kolyn model, credential and HTTP transport.
The model supplies conditions only. The existing bounded symbolic engine computes
private reference answers from each exact visible expression or affine equation;
model-suggested answers are never trusted. Every task must pass that checker and the
measured PDF layout checks. Expressions can use fractions, roots and polynomial
algebra. Equation PDFs currently require one-variable affine equations with exactly
one real solution. Visual tasks use closed numeric specifications and the same
SVG diagram engine. The compiler derives the visible question, givens and private
reference answer from those parameters; it accepts no model-written SVG or answer.
Graphs support values and construction for constant, linear, quadratic, polynomial,
trigonometric, absolute, reciprocal, square-root, exponential, logarithmic and rational
functions. Zeros/intersections use the existing polynomial/rational root isolation,
are bounded to the visible range and are explicitly approximate.
Geometry supports convex coordinate polygons (including triangles and rectangles),
areas, perimeters, sides and angles; circles; cube/cuboid/cylinder/cone/sphere volumes
and full surface areas; and equal circular fraction sectors. Solids are schematic.
Numeric reference values are rounded to six decimals, not symbolic geometry proofs.
Unsupported constructions, theorem proofs, general word problems, inequalities or nonlinear
equations stay text assistance rather than being labelled automatically verified.
Mixed/visual sheets place at most two tasks on each page with blank working space.
Five visual tasks therefore use three pages; pure short algebra remains one page.
These checks verify the encoded mathematics, not the entire pedagogical suitability
or the correctness of speech recognition. The teacher can inspect the draft before adding.

## Persistence and append

V100 stores private generation results and durable confirmation receipts keyed by
teacher, classroom and client message UUID. A stable request fingerprint rejects
reusing a key with another request. No model/network transaction holds a database
lock. Failed attempts may retry; stale workers cannot overwrite a newer attempt.
The last generated tasks are available privately for follow-up edits in that room.

Authenticated host-only PDF/PNG GET routes never mutate the workbook. Every read and
confirmation rechecks classroom ownership and current pupil membership. Confirmation
locks the artifact and appends in the same transaction as its ADDED receipt.

The personal append preserves original PDF pages and places new pages after both
the PDF and any existing blank-page annotation extent. On first personal assignment
it keeps the inherited shared background and promotes the pupil's existing annotation
documents without changing document IDs, events or snapshots. Shared class barriers
allow concurrent annotation writes; the short exclusive append barrier serializes
the background/scope transition. Old in-flight document IDs remain usable, and old
surface opens resolve to the promoted target. Other pupils and shared files are untouched.

An ended/cancelled classroom cannot receive a new append. A repeated confirmation
of an already-added artifact returns the original page range. Existing version probes
and the workbook-updated event refresh the pupil's live document.

## Checks before release

Run focused Kolyn, append, document authorization and renderer tests; real PostgreSQL
tests must cover row locks, rollback, legacy annotation promotion and repeated confirmation.
Run the frontend suite plus desktop/mobile browser cases. Render the plain fixtures
with the production WeasyPrint runtime and visually review the PDF and cropped PNG.
Keep deployment separate until the owner approves the final tested PR.
