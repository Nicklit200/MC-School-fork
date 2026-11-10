package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * On-demand, server-authorized lesson-document context for the private teacher assistant.
 *
 * <p>Indexes saved text-layer PDFs once per verified document version, then sends only
 * query-relevant pages. It does NOT infer handwritten content from annotation revisions.
 * Nothing here performs background OCR, calls an AI model, or exposes answer-key PDFs.
 */
@Service
public class KolinLessonContextService {
    static final int MAX_PUPILS = 8;
    static final int MAX_PDF_BYTES = 10_000_000;
    static final int MAX_INDEX_PAGES = 60;
    static final int MAX_PAGE_CHARS = 3400;
    static final int MAX_PROMPT_CHARS = 18000;
    static final int MAX_SELECTED_PAGES = 7;
    private static final int MAX_CACHE_ENTRIES = 48;
    private static final Pattern TOKEN = Pattern.compile("[\\p{L}\\p{N}]{3,}", Pattern.UNICODE_CHARACTER_CLASS);
    private final OnlineClassDocumentService documents;
    private final KolinTaskRoster roster;
    private final OnlineClassAnnotationDocumentRepository annotations;

    private record Key(UUID classId, String boardId, long version) {}
    private record Page(int number, String text) {}
    private record Parsed(int totalPages, List<Page> pages, List<KolinExerciseIndex.Exercise> exercises, boolean truncated, String status) {}
    private record Source(String name, String boardId, boolean shared, Parsed parsed, long version) {}
    private record Ink(long revision, Instant updated) {}
    private record Candidate(Source source, Page page, int score) {}
    private record IndexedExercise(Source source, KolinExerciseIndex.Exercise task) {}
    private record TaskResolution(String state, Integer number, IndexedExercise resolved, List<IndexedExercise> candidates) {}

    /** Parsed text only, no PDF bytes. Old versions become unreachable after a version change. */
    private final Map<Key, Parsed> cache = Collections.synchronizedMap(new LinkedHashMap<Key, Parsed>(32, .75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<Key, Parsed> eldest) {
            return size() > MAX_CACHE_ENTRIES;
        }
    });

    public KolinLessonContextService(OnlineClassDocumentService documents, KolinTaskRoster roster,
                                     OnlineClassAnnotationDocumentRepository annotations) {
        this.documents = documents;
        this.roster = roster;
        this.annotations = annotations;
    }

    /**
     * Caller must have already passed requireHost for THIS room. Document access is
     * independently authorized for every board, and pupil IDs come only from the server roster.
     */
    public Map<String, Object> read(AuthenticatedUser teacher, OnlineClass room,
                                    String question, KolinChatService.Context requested) {
        List<KolinTaskRoster.Pupil> pupils = roster.read(room).stream().limit(MAX_PUPILS).toList();
        var sources = new ArrayList<Source>();
        sources.add(source(teacher, room, "Общая доска", "board-1", true));
        for (var pupil : pupils) {
            String board = PersonalBoard.workbookTargetIdFor(pupil.id());
            sources.add(source(teacher, room, pupil.name(), board, false));
        }
        // Reading the annotation list never sends strokes to the model. It only indicates
        // which saved pages have newer ink and need a visual review to judge correctness.
        Map<String, Map<Integer, Ink>> ink = new HashMap<>();
        Set<String> allowed = new HashSet<>();
        for (var source : sources) allowed.add(source.boardId());
        for (var pupil : pupils) allowed.add(PersonalBoard.targetIdFor(pupil.id()));
        try {
            for (var annotation : annotations.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())) {
                if (annotation.getTargetType() != AnnotationTargetType.WHITEBOARD ||
                    !allowed.contains(annotation.getTargetId()) ||
                    annotation.getRevision() <= 0) continue;
                String canonical = annotation.getTargetId();
                if (PersonalBoard.isPersonal(canonical)) {
                    UUID owner = PersonalBoard.ownerOf(canonical).orElse(null);
                    if (owner == null || pupils.stream().noneMatch(p -> p.id().equals(owner))) continue;
                    canonical = PersonalBoard.workbookTargetIdFor(owner);
                }
                ink.computeIfAbsent(canonical, k -> new HashMap<>())
                   .merge(annotation.getPageIndex() + 1,
                          new Ink(annotation.getRevision(), annotation.getUpdatedAt()),
                          (old, next) -> old.revision() >= next.revision() ? old : next);
            }
        } catch (RuntimeException failure) {
            LoggerFactory.getLogger(getClass()).warn("Kolyn annotations metadata unavailable: classId={} errorType={}",
                room.getId(), failure.getClass().getSimpleName());
        }

        String selected = selectedBoard(question, requested, pupils);
        int currentPage = requested != null && requested.currentWorkbookPage() != null
            ? requested.currentWorkbookPage() : 1;
        // Exercise numbers refer to document content, NOT physical PDF page indices.
        // Resolve against the server-authorized, version-keyed text index before
        // selecting model-visible pages so a task on a later page is not lost.
        TaskResolution task = resolveTask(KolinExerciseIndex.requestedNumber(question),sources,selected,currentPage);
        List<Map<String, Object>> catalog = new ArrayList<>();
        List<Candidate> candidates = new ArrayList<>();
        for (var source : sources) {
            var parsed = source.parsed();
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("name", source.name());
            item.put("kind", source.shared() ? "shared" : "personal");
            item.put("state", parsed.status());
            item.put("pageCount", parsed.totalPages());
            item.put("indexedPageCount", parsed.pages().size());
            item.put("truncated", parsed.truncated());
            item.put("savedInkPageCount", ink.getOrDefault(source.boardId(), Map.of()).size());
            item.put("indexedExerciseCount",parsed.exercises().size());
            item.put("exerciseLocations",parsed.exercises().stream().limit(40).map(exercise ->
                Map.of("number",exercise.number(),"pageNumber",exercise.pageNumber(),
                    "taskId",KolinExerciseIndex.id(source.boardId(),source.version(),exercise))).toList());
            catalog.add(item);
            for (var page : parsed.pages()) {
                if (page.text().isBlank()) continue;
                // A numbered question about a selected pupil must not accidentally
                // show the same exercise number from somebody else's workbook.
                if (task.number()!=null && !"board-1".equals(selected)
                    && !source.boardId().equals(selected) && !source.shared()) continue;
                if (task.resolved()!=null &&
                    !source.boardId().equals(task.resolved().source().boardId())) continue;
                if ("ambiguous".equals(task.state()) && task.candidates().stream()
                    .noneMatch(hit -> hit.source().boardId().equals(source.boardId()))) continue;
                int rank = relevance(question, page.text(), page.number(), currentPage);
                // Explicitly selected recipient takes precedence. Shared sheet remains
                // available because personal boards can inherit the group PDF.
                rank += Objects.equals(selected, source.boardId()) ? 100 :
                    source.shared() ? 45 : 0;
                if (task.resolved()!=null
                    && Objects.equals(task.resolved().source().boardId(),source.boardId())
                    && task.resolved().task().pageNumber()==page.number()) rank += 2000;
                else if (task.candidates().stream().anyMatch(hit ->
                    Objects.equals(hit.source().boardId(),source.boardId()) && hit.task().pageNumber()==page.number()))
                    rank += 600;
                candidates.add(new Candidate(source, page, rank));
            }
        }
        candidates.sort(Comparator.comparingInt(Candidate::score).reversed()
            .thenComparing(c -> c.source().name())
            .thenComparingInt(c -> c.page().number()));

        var selectedPages = new ArrayList<Map<String, Object>>();
        Set<String> seen = new HashSet<>();
        int used = 0;
        for (var candidate : candidates) {
            if (selectedPages.size() >= MAX_SELECTED_PAGES || used >= MAX_PROMPT_CHARS) break;
            String id = candidate.source().boardId() + ":" + candidate.page().number();
            if (!seen.add(id)) continue;
            int roomLeft = MAX_PROMPT_CHARS - used;
            if (roomLeft < 250) break;
            String text = candidate.page().text();
            if (text.length() > roomLeft) text = text.substring(0, roomLeft);
            var page = new LinkedHashMap<String, Object>();
            page.put("source", candidate.source().name());
            page.put("kind", candidate.source().shared() ? "shared" : "personal");
            page.put("pageNumber", candidate.page().number());
            page.put("text", text);
            page.put("textTruncated", text.length() < candidate.page().text().length());
            page.put("exerciseReferences",candidate.source().parsed().exercises().stream()
                .filter(ex -> ex.pageNumber()==candidate.page().number()).limit(40)
                .map(ex -> Map.of("number",ex.number(),
                    "taskId",KolinExerciseIndex.id(candidate.source().boardId(),candidate.source().version(),ex)))
                .toList());
            Ink saved = ink.getOrDefault(candidate.source().boardId(), Map.of()).get(candidate.page().number());
            page.put("savedHandwritingPresent", saved != null);
            if (saved != null) {
                page.put("handwritingRevision", saved.revision());
                if (saved.updated() != null) page.put("handwritingSavedAt", saved.updated().toString());
            }
            selectedPages.add(page);
            used += text.length();
        }
        boolean anyPdf = sources.stream().anyMatch(s -> s.parsed().totalPages() > 0);
        boolean anyText = !selectedPages.isEmpty();
        var result = new LinkedHashMap<String, Object>();
        result.put("state", !anyPdf ? "no_saved_documents" : anyText ? "text_context_available" : "image_only_or_empty");
        result.put("catalog", catalog);
        result.put("relevantPages", selectedPages);
        result.put("taskReference", taskReference(task));
        result.put("exerciseIndexFormat","text_layer_only; stable per authorized document version and page");
        result.put("selectedPageCount", selectedPages.size());
        result.put("totalAvailablePageCount", sources.stream().mapToInt(s -> s.parsed().totalPages()).sum());
        result.put("handwritingContentReadable", false);
        result.put("pageSelection", "Relevant saved PDF text pages only, not a complete copy of every document");
        result.put("limitations", "Only embedded PDF text was extracted. Image-only PDF text and handwritten ink were NOT read. " +
            "Saved ink revisions show activity, not whether a solution is right. Use a fresh authorized board image " +
            "when the teacher asks to inspect handwriting. Never claim to see unprovided pages or live speech.");
        return result;
    }

    private Source source(AuthenticatedUser teacher, OnlineClass room, String name, String boardId, boolean shared) {
        try {
            long version = documents.workbookVersion(teacher, room.getId(), boardId);
            if (version <= 0) return new Source(name, boardId, shared, empty("no_document"), version);
            Key key = new Key(room.getId(), boardId, version);
            Parsed cached = cache.get(key);
            if (cached != null) return new Source(name, boardId, shared, cached, version);
            byte[] bytes = documents.workbook(teacher, room.getId(), boardId).orElse(null);
            // Another teacher action may replace the workbook during extraction.
            // Never cache/show text under a revision that no longer owns those bytes.
            Parsed parsed = bytes == null ? empty("no_document") : extract(bytes);
            if (documents.workbookVersion(teacher, room.getId(), boardId) != version)
                return new Source(name, boardId, shared, empty("changed_during_read"), version);
            cache.put(key, parsed);
            return new Source(name, boardId, shared, parsed, version);
        } catch (RuntimeException ex) {
            // A teacher may not have the personal-workbook pilot enabled for every pupil.
            // Do not expose exception details or cross-room material to the model/logs.
            return new Source(name, boardId, shared, empty("unavailable"), 0);
        }
    }

    private static Parsed empty(String state) { return new Parsed(0, List.of(), List.of(), false, state); }

    private static Parsed extract(byte[] bytes) {
        if (bytes.length == 0 || bytes.length > MAX_PDF_BYTES) return empty("too_large");
        try (var pdf = Loader.loadPDF(bytes)) {
            int total = pdf.getNumberOfPages(), count = Math.min(total, MAX_INDEX_PAGES);
            var stripper = new PDFTextStripper();
            var pages = new ArrayList<Page>(count);
            var exercises = new ArrayList<KolinExerciseIndex.Exercise>();
            for (int page = 1; page <= count; page++) {
                stripper.setStartPage(page);
                stripper.setEndPage(page);
                String extracted = stripper.getText(pdf);
                if (extracted == null) extracted = "";
                extracted = extracted.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", " ").strip();
                if (extracted.length() > MAX_PAGE_CHARS) extracted = extracted.substring(0, MAX_PAGE_CHARS);
                pages.add(new Page(page, extracted));
                if (exercises.size()<120) {
                    var pageTasks=KolinExerciseIndex.fromPage(page,extracted);
                    exercises.addAll(pageTasks.subList(0,Math.min(120-exercises.size(),pageTasks.size())));
                }
            }
            boolean readable = pages.stream().anyMatch(p -> !p.text().isBlank());
            return new Parsed(total, List.copyOf(pages), List.copyOf(exercises), total > count || exercises.size()>=120,
                readable ? "text_indexed" : "no_embedded_text");
        } catch (IOException | RuntimeException failure) {
            return empty("unreadable_pdf");
        }
    }

    /** Restrict named pupils to their own document; only the common sheet may be a fallback. */
    private static TaskResolution resolveTask(Integer number, List<Source> sources, String selected, int currentPage) {
        if (number == null) return new TaskResolution("not_requested", null, null, List.of());
        List<IndexedExercise> hits = new ArrayList<>();
        for (var source : sources) for (var ex : source.parsed().exercises()) if (ex.number()==number)
            hits.add(new IndexedExercise(source,ex));
        if (hits.isEmpty()) return new TaskResolution("not_found",number,null,List.of());
        var chosen = hits.stream().filter(h -> h.source().boardId().equals(selected)).toList();
        if (chosen.isEmpty()) {
            // If a selected pupil has no personal workbook, they may work on the shared PDF.
            // Never attribute another pupil's material to the selected pupil.
            var common = hits.stream().filter(h -> h.source().shared()).toList();
            if (!common.isEmpty()) chosen=common;
            else if ("board-1".equals(selected)) chosen=hits;
            else return new TaskResolution("not_found_in_selected_document",number,null,List.of());
        }
        if (chosen.size()>1) {
            var visible=chosen.stream().filter(h -> h.task().pageNumber()==currentPage).toList();
            if (visible.size()==1) chosen=visible;
        }
        if (chosen.size()==1) return new TaskResolution("resolved",number,chosen.get(0),List.copyOf(chosen));
        return new TaskResolution("ambiguous",number,null,List.copyOf(chosen));
    }

    private static Map<String,Object> taskReference(TaskResolution resolution) {
        var details=new LinkedHashMap<String,Object>();
        details.put("state",resolution.state());
        if (resolution.number()==null) return details;
        details.put("requestedNumber",resolution.number());
        if (resolution.resolved()!=null) {
            var hit=resolution.resolved();
            details.put("taskId",KolinExerciseIndex.id(hit.source().boardId(),hit.source().version(),hit.task()));
            details.put("source",hit.source().name());
            details.put("kind",hit.source().shared()?"shared":"personal");
            details.put("pageNumber",hit.task().pageNumber());
            details.put("statement",hit.task().text());
            details.put("statementTruncated",hit.task().truncated());
            details.put("documentVersion",hit.source().version());
            details.put("documentState",hit.source().parsed().status());
        } else if ("ambiguous".equals(resolution.state())) {
            details.put("alternatives",resolution.candidates().stream().limit(10).map(hit ->
                Map.of("source",hit.source().name(),"kind",hit.source().shared()?"shared":"personal",
                       "pageNumber",hit.task().pageNumber(),
                       "taskId",KolinExerciseIndex.id(hit.source().boardId(),hit.source().version(),hit.task())))
                .toList());
        }
        details.put("limitations","Only saved PDF text was indexed. Handwriting and scanned pages are not recognized.");
        return details;
    }

    private static String selectedBoard(String question, KolinChatService.Context requested,
                                        List<KolinTaskRoster.Pupil> pupils) {
        String normalized = KolinBoardReviewService.normalize(question);
        Set<String> words = new HashSet<>(java.util.Arrays.asList(normalized.split("[^a-z0-9]+")));
        List<KolinTaskRoster.Pupil> matches = pupils.stream().filter(pupil ->
            java.util.Arrays.stream(KolinBoardReviewService.normalize(pupil.name()).split("[^a-z0-9]+"))
                .filter(name -> name.length() >= 3)
                .anyMatch(name -> words.stream().anyMatch(word -> KolinBoardReviewService.nameMatches(name, word)))
        ).toList();
        if (matches.size() == 1) return PersonalBoard.workbookTargetIdFor(matches.get(0).id());
        if (matches.size() > 1) return "board-1";
        if (requested != null && requested.studentId() != null &&
            pupils.stream().anyMatch(p -> p.id().equals(requested.studentId())))
            return PersonalBoard.workbookTargetIdFor(requested.studentId());
        return "board-1";
    }

    private static int relevance(String question, String pageText, int number, int currentPage) {
        String lower = pageText.toLowerCase(Locale.ROOT);
        int score = number == currentPage ? 10 : 0;
        String query = question.toLowerCase(Locale.ROOT);
        if (number == 1 && query.matches("(?su).*(?:перв|втор|first|second|1.?2).*(?:задан|упражнен|пример|task|exercise|aufgab).*"))
            score += 35;
        var matcher = TOKEN.matcher(query);
        Set<String> words = new HashSet<>();
        while (matcher.find()) {
            String word = matcher.group();
            if (word.length() < 4 || word.matches("(?iu)(что|как|где|это|данн|теперь|все|весь|можно|пожалуйста)"))
                continue;
            words.add(word);
        }
        for (String word : words) if (lower.contains(word)) score += 4;
        return score;
    }
}
