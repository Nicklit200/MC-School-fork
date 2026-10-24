# Original v3 classroom board

The classroom now uses the supplied `Mindcrafti_Whiteboard_Original_v3` visual
reference: dark lesson chrome, orange selection, a compact floating tool island,
context settings underneath, a light page and independent teacher solutions.
The reference HTML's demonstration handlers and example school data are not
part of the application.

The island keeps undo, redo, pan, pen, eraser and highlighter immediately
available. The additional-tools menu contains selection, text, shapes, laser,
layer clearing, follow controls and PDF export. Authorized workbook upload,
answers and save actions use the existing APIs. The teacher's separate
solutions-upload entry remains available for the first answers PDF.

Tool settings close on repeated selection, Escape or a board touch. The canvas
reserves both tool rows, so closing settings during pointer-down never changes
the coordinate system midway through a stroke. The light page is drawn in the
existing background Konva layer, using the same letterbox and transforms as its
marks. PDF and video content retain their own aspect ratios and colors.

The footer occupies its own row. Teacher solutions remain on the left at desktop
and tablet sizes and move above the board on phones. The mixed pupil overview
uses its full tile area and has no editing toolbar. The phone-camera QR flow,
private camera annotation documents and persistent media subscriptions remain
unchanged.

Validation includes the frontend suite, a production build, keyboard/menu and
per-tool interaction tests, real annotation operations over synthetic video,
and real two-page PDF/answers previews at desktop, tablet and phone widths,
including 320-pixel individual camera and mixed-overview checks.
