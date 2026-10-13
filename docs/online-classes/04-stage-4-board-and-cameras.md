# Stage 4 — board, cameras, answers panel

Spec: «ТЗ для разработчика — Онлайн-доска, этап 4». Branch
`feature/online-board-stage-4` (branched from `feature/online-classes`).

**Verification status.** Automated checks (unit, component and backend
integration tests, type-check, production build) pass. Everything that needs two
real browsers, a LiveKit server, a tablet or a stylus is **not executed** and is
listed in section 3 for the joint test pass.

---

## 1. What was built, against the spec

| Spec | Where | State |
|---|---|---|
| §1/§6 Camera column on the right, teacher first, fixed size, no scroll | `CameraColumn.tsx`, `cameraOrder.ts`, `cameraCard.ts` | built, unit-tested; **visual check needs a real room** |
| §6 Speaker highlighted, never reordered; late joiner appended; leaver closes the gap | `mergeCameraOrder` | built, unit-tested |
| §6 Camera off → initials + name; connection loss → «Переподключение…» | `CameraCard` | built; remote reconnect is inferred from LiveKit's `ConnectionQuality.Lost` — confirm on a real drop |
| §6 Mic/camera indicators, read-only | `CameraCard` | built (no controls on cards, asserted by test) |
| §2 GoodNotes-style toolbar: click selects, active highlighted, second click opens settings | `BoardToolbar.tsx`, `boardTools.ts` | built, tested |
| §3 Board fills the window; compact toolbar; page switcher bottom-left «1 / 24», ‹ › + | `OnlineClassRoom.tsx`, `PageNavigator.tsx`, CSS | built |
| §3 Per-page marks and per-page zoom/pan; instant switching, no reload | `useAnnotationBoard.ts` (page cache), `boardView.ts` | built, tested |
| §3 PDF document | `pdfDocument.ts`, `usePdf.ts`, `useBoardDocument.ts`, backend `GET /online-classes/{id}/document` | built; serves the **workbook** to participants, never the answers |
| §5 «Ответы» panel, teacher only, left overlay, fixed width, × on border, remembers page/scroll/zoom | `AnswersButton/Panel.tsx`, `useAnswersPanel.ts` | built; uses the lesson's already-bound answers file |
| §5 Student gets no button, URL or content | hook requests nothing for non-hosts; backend 403 | tested at HTTP level |
| §7 Stylus mode / finger mode, palm rejection, two-finger pan+zoom | `gestureController.ts`, `inputPolicy.ts` | state machine unit-tested; **needs a real tablet + stylus** |
| §7 Eraser: part of a line / whole stroke | `BoardToolbar` menu, `hitTest.ts`, `useAnnotationBoard.eraseShape` | built; whole-stroke deletes **own** marks only |
| §7 Toolbar always visible | not collapsible | built |
| §8 «Следовать за учителем» on the shared board only; student navigation locked | `useFollowTeacher.ts`, `followTeacher.ts` | built, tested; **needs two browsers** |
| Realtime drawing, selection, pointer | `useClassEvents.ts`, `useLaserPointers.ts`, `events.ts` | built; **the data channel was not used anywhere before this stage** |

### Things the spec assumed that were not in the code

1. **Personal boards for students did not exist.** §8 says they were "already
   implemented"; the code had only the shared board. They are now built: target
   id `personal-<studentId>`, **private on the server** (only the owner and the
   teacher can open, read, write or list them; others get not-found), never
   broadcast over the data channel, excluded from follow mode, polled every 2 s
   while the teacher is viewing one. Students switch between «Общая доска» and
   «Моя доска»; the teacher picks any student from a drop-down. If you already
   have a different personal-board design elsewhere, this needs reconciling.
2. **Realtime sync did not exist.** Annotation operations were saved over REST
   only; other participants never saw them live. This stage adds the data-channel
   layer (`mc.class.annotation.v1`, `mc.class.view.v1`, `mc.class.pointer.v1`).
3. **Selecting/moving objects did not exist.** Added as a targeted `UPDATE`
   operation (backward compatible: an `UPDATE` without a target behaves as
   before).

---

## 2. Trust model for «Следовать за учителем»

Any participant can publish data over LiveKit (students hold `canPublishData`),
so a view packet is advisory. Students accept it only when the sender's identity
(`<userId>|<device>`) carries the **host's user id**, taken from the roster. A
forged packet from another student is ignored (test:
`WhiteboardPanel.test.tsx`, `useFollowTeacher.test.tsx`). A forged packet can at
worst move a view; it never carries content. Annotation packets are likewise
only a "something was saved" hint: peers re-fetch from the server and never
apply packet contents, so a student cannot fake a teacher's stroke or a
«clear all» over the data channel. If the teacher goes silent for 6 s
the student is unlocked.

---

## 3. Manual test script (NOT EXECUTED)

Use two browsers (teacher, student) in the same class, plus a tablet if you have
one. Online classes must be enabled and a LiveKit server reachable
(see `03-testing-instructions.md` §2.2).

### Cameras (§1, §6, §9)
1. Teacher and 2 students join. Teacher card is first; students below in join order.
2. Make a student speak. Their card gets a green inner border; **order does not change**.
3. A third student joins late → appears at the bottom, others unmoved.
4. A student turns the camera off → card stays, shows initials and name.
5. Throttle a student's network (DevTools → Offline for ~5 s) → «Переподключение…» on their card.
6. A student leaves → card disappears, the ones below move up, order kept.
7. Click a card → nothing happens (no enlarging, no mute controls).
8. With 5 cameras, no scrollbar appears in the column.

### Toolbar (§2)
1. Click the pen → it is clearly highlighted. Click it again → colour/size menu next to it.
2. Pick a colour and immediately draw → no confirmation step, menu closes on touching the board.
3. Eraser → second click shows «Стирать участок» / «Удалять штрих»; test both.
4. Select tool → click a shape, drag it; the student sees it move. (Own shapes only.)

### Pages (§3)
1. Draw on page 1, press «+», draw on page 2, go back → page 1 marks unchanged.
2. Zoom page 1, go to page 2 (unzoomed), back → page 1 still zoomed.
3. Pinch/scroll-zoom never flips the page.
4. A lesson with a workbook PDF: pages show under the marks; count = PDF pages.

### Answers (§5, §9)
1. Lesson **without** an answers file: teacher sees a disabled «Ответы не добавлены».
2. Bind an answers PDF to the lesson beforehand (lesson preparation) → button active.
3. Open → fixed-width panel on the left; camera column fully visible; keep drawing on the board.
4. Flip answers to page 3, zoom, scroll, close with ×, reopen → same page, zoom, scroll.
5. Flip board pages while the answers are open → answers state unchanged; the board's page switcher moves to the panel's right edge.
6. Student: **no** button. `GET /api/v1/lesson-preparations/<eventId>/answers` with the student's token → 403.

### Stylus and touch (§7) — tablet
1. Stylus mode: pen draws; one finger moves the canvas; two fingers pinch; resting a palm leaves no line.
2. Finger mode: one finger draws; a second finger cancels the stroke and pans/zooms.
3. The switch is visible in the toolbar and remembered.

### Personal boards (§8)
1. Student switches to «Моя доска», draws; the teacher picks that student in the
   board drop-down and sees the marks within ~2 s.
2. A second student never sees the first student's board or its marks, and the
   drop-down does not exist for students.
3. Teacher on a student's board: other students stay on the shared board and do
   not move; follow keeps working for the shared board in the background.

### Follow the teacher (§8)
1. Teacher: «Следовать за учителем» on. Teacher changes page, zooms, pans → student mirrors all three.
2. Student tries to flip/zoom/pan → blocked; notice shown; arrows disabled.
3. Teacher draws → student sees it live.
4. Turn follow off → student can navigate freely again.
5. Student joins while follow is on → catches up within ~2 s.
6. Teacher opens a student's personal board → others do **not** move.

---

## 4. Known limits

- Whole-stroke eraser and the select tool act only on the user's **own** marks
  (the fold already enforces this for undo; a teacher cannot delete a student's
  stroke with it, but the partial eraser still cuts through everything).
- A student may navigate the shared board when follow is off; only the teacher
  can add pages.
- Camera column is sized for ~5 cameras and clips beyond that (spec: no scroll yet).
- The chat/participants/waiting-room panels moved into a drawer behind the
  «Чат и участники» button (waiting count shown on it).
- `pdfjs-dist` was added (pinned 4.10.38, lazy-loaded). Its worker is ~1.3 MB
  and only downloads when a PDF is opened.
