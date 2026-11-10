package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import java.awt.image.BufferedImage;
import org.apache.pdfbox.pdmodel.PDDocument;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Semaphore;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ClassPathResource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/**
 * Secure adapter between teacher-authorized MCP tools and the Git-versioned SVG/PDF
 * renderer. No source code, template files or shell commands come from the model.
 * Generated files are only stored as unpublished teacher-owned lesson drafts.
 */
@Service
public class OwnerWorkbookPdfRenderService {
    private static final Logger LOG = LoggerFactory.getLogger(OwnerWorkbookPdfRenderService.class);
    static final int MAX_INPUT_CHARS = 115_000;
    static final int MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
    static final String VERSION = "2026-11-05-v4-fast-shared";
    private static final List<String> RENDER_FILES = List.of(
            "generate.mjs", "pagination.mjs", "math.mjs", "schema.mjs", "diagrams.mjs", "visual-tasks.mjs", "styles.css", "render_pdf.py", "verify_pdf.py", "algebra_qa.py");

    @Value("${MINDCRAFTI_WORKBOOK_MODULES:/opt/mindcrafti-workbook/node_modules}")
    private String modulesDirectory;

    private final ObjectMapper mapper;
    private final LessonPdfDraftService drafts;
    private final SchoolBrandGuideService brandGuide;
    // Three background workbook jobs run in parallel. Keep one additional
    // permit available for live Kolin/teacher-triggered worksheet rendering.
    private final Semaphore renderSlots = new Semaphore(4, true);
    private final Object runtimeLock = new Object();
    private volatile Path runtimeDirectory;

    public OwnerWorkbookPdfRenderService(ObjectMapper mapper, LessonPdfDraftService drafts,
                                         SchoolBrandGuideService brandGuide) {
        this.mapper = mapper;
        this.drafts = drafts;
        this.brandGuide = brandGuide;
    }

    /** @Value is assigned after construction; initialize the immutable shared runtime on first render. */
    private Path runtimeDirectory() {
        Path current = runtimeDirectory;
        if (current != null) return current;
        synchronized (runtimeLock) {
            current = runtimeDirectory;
            if (current == null) runtimeDirectory = current = prepareRuntimeDirectory();
            return current;
        }
    }

    private Path prepareRuntimeDirectory() {
        if (modulesDirectory == null || modulesDirectory.isBlank())
            throw new IllegalStateException("Workbook MathJax runtime is unavailable; configure MINDCRAFTI_WORKBOOK_MODULES");
        Path modules = Path.of(modulesDirectory).toAbsolutePath().normalize();
        if (!Files.isDirectory(modules.resolve("mathjax")))
            throw new IllegalStateException("Workbook MathJax runtime is unavailable; configure MINDCRAFTI_WORKBOOK_MODULES");
        Path runtime = null;
        try {
            runtime = Files.createTempDirectory("mindcrafti-workbook-runtime-");
            runtime.toFile().deleteOnExit();
            for (String name : RENDER_FILES) {
                Path target = runtime.resolve(name);
                try (var input = new ClassPathResource("owner-workbook-generator/" + name).getInputStream()) {
                    Files.copy(input, target);
                }
                target.toFile().deleteOnExit();
            }
            Path moduleLink = runtime.resolve("node_modules");
            Files.createSymbolicLink(moduleLink, modules);
            moduleLink.toFile().deleteOnExit();
            return runtime;
        } catch (IOException | RuntimeException ex) {
            if (runtime != null) cleanupWorkspace(runtime);
            throw new IllegalStateException("Cannot initialize Mindcrafti workbook renderer runtime", ex);
        }
    }


    public Map<String, Object> create(AuthenticatedUser teacher, String eventId,
                                      String lessonJson, String planSummary,
                                      String difficultySummary) throws Exception {
        if (!renderSlots.tryAcquire())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Workbook renderer is busy. Retry the unchanged request with the same idempotencyKey after an active render finishes.");
        try {
            return render(teacher, eventId, lessonJson, planSummary, difficultySummary);
        } finally {
            renderSlots.release();
        }
    }

    /** Immutable output for Kolin's teacher-owned task artifact, never published here. */
    public record PlainWorksheet(byte[] pdf, byte[] previewPng, int pageCount, Map<String, Object> qa) {}

    /**
     * Reuses the installed SVG/math and measured A4 pipeline without brand IO or
     * a lesson draft. Callers authorize the room/student and persist this output
     * once. Neither viewing the preview nor assigning it should render again.
     */
    public PlainWorksheet renderPlain(String lessonJson) throws Exception {
        if (!renderSlots.tryAcquire())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Workbook renderer is busy. Retry the same request after an active render finishes.");
        try {
            if (lessonJson == null || lessonJson.isBlank() || lessonJson.length() > 32_000)
                throw new IllegalArgumentException("Plain worksheet JSON must contain 1..32000 characters");
            @SuppressWarnings("unchecked")
            Map<String, Object> document = mapper.readValue(lessonJson, Map.class);
            int exercises = validatePlainDocument(document);
            int expectedPages = ((List<?>) document.get("workbookPages")).size();
            int duration = ((Number) requireMap(document.get("meta"), "meta").get("durationMinutes")).intValue();
            Path runtime = runtimeDirectory();
            Path workspace = Files.createTempDirectory("mindcrafti-plain-worksheet-");
            try {
                Path source = workspace.resolve("lesson.json");
                Path output = Files.createDirectory(workspace.resolve("out"));
                Files.writeString(source, lessonJson, StandardCharsets.UTF_8);
                String basename = "Kolin_Plain";
                var process = new ProcessBuilder("node", runtime.resolve("generate.mjs").toString(),
                        "--lesson=" + source, "--out=" + output, "--basename=" + basename, "--plain");
                process.directory(runtime.toFile());
                process.redirectErrorStream(true);
                process.redirectOutput(workspace.resolve("renderer.log").toFile());
                runPlainProcess(process);
                Path pdfPath = output.resolve(basename + "_Arbeitsheft_" + duration + "min.pdf");
                Path previewPath = output.resolve(basename + "_preview.png");
                if (Files.size(pdfPath) > MAX_DOCUMENT_BYTES || Files.size(previewPath) > 3 * 1024 * 1024)
                    throw new IllegalStateException("Plain worksheet output exceeds its size limit");
                @SuppressWarnings("unchecked")
                Map<String, Object> mathQa = mapper.readValue(Files.readString(output.resolve(basename + "_math-qa.json")), Map.class);
                @SuppressWarnings("unchecked")
                Map<String, Object> layoutQa = mapper.readValue(Files.readString(output.resolve(basename + "_layout-qa.json")), Map.class);
                requirePlainQa(mathQa, layoutQa, exercises);
                byte[] pdf = Files.readAllBytes(pdfPath);
                byte[] preview = Files.readAllBytes(previewPath);
                try (var parsed = Loader.loadPDF(pdf)) {
                    if (parsed.isEncrypted() || parsed.getNumberOfPages() != expectedPages)
                        throw new IllegalStateException("Plain worksheet page verification failed");
                }
                BufferedImage image = ImageIO.read(new java.io.ByteArrayInputStream(preview));
                if (image == null || image.getWidth() < 1 || image.getHeight() < 1
                        || image.getWidth() > 802 || image.getHeight() > 802)
                    throw new IllegalStateException("Plain worksheet preview verification failed");
                return new PlainWorksheet(pdf, preview, expectedPages, Map.of(
                        "mathPassed", true, "layoutPassed", true, "rawLatexFound", false,
                        "algebraChecked", mathQa.get("checked"),
                        "algebraCoverage", "explicit assertions tied to generated tasks",
                        "arithmeticChains", mathQa.getOrDefault("arithmeticChains", 0),
                        "results", mathQa.getOrDefault("results", List.of())));
            } finally {
                cleanupWorkspace(workspace);
            }
        } finally {
            renderSlots.release();
        }
    }

    private static void runPlainProcess(ProcessBuilder builder) throws IOException {
        Process process = builder.start();
        try {
            if (!process.waitFor(115, TimeUnit.SECONDS)) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                throw new IllegalStateException("Plain worksheet rendering exceeded its time limit");
            }
            // Renderer diagnostics can contain source expressions. The internal
            // temp log is removed with its workspace, never exposed to the user.
            if (process.exitValue() != 0)
                throw new IllegalArgumentException("Plain worksheet generation or verification failed");
        } catch (InterruptedException ex) {
            process.descendants().forEach(ProcessHandle::destroyForcibly);
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Plain worksheet rendering was interrupted", ex);
        }
    }

    static int validatePlainDocument(Map<String, Object> document) {
        int count = validateDocument(document);
        if (count > 20 || ((List<?>) document.get("workbookPages")).size() > 10
                || ((List<?>) document.get("teacherPages")).size() > 4)
            throw new IllegalArgumentException("Plain worksheet needs 1..20 tasks and at most 10 student pages");
        return count;
    }

    static void requirePlainQa(Map<String, Object> math, Map<String, Object> layout, int exercises) {
        if (!Boolean.TRUE.equals(math.get("passed")) || !Boolean.TRUE.equals(layout.get("passed"))
                || !(math.get("checked") instanceof Number checked) || checked.intValue() < exercises)
            throw new IllegalStateException("Plain worksheet requires successful math assertions for every task and measured layout QA");
    }

    private Map<String, Object> render(AuthenticatedUser teacher, String eventId,
                                      String lessonJson, String planSummary,
                                      String difficultySummary) throws Exception {
        long startedNanos = System.nanoTime();
        Objects.requireNonNull(teacher, "teacher");
        if (eventId == null || eventId.isBlank())
            throw new IllegalArgumentException("eventId is required");
        if (lessonJson == null || lessonJson.isBlank() || lessonJson.length() > MAX_INPUT_CHARS)
            throw new IllegalArgumentException("lessonJson length must be 1..115000 characters");
        @SuppressWarnings("unchecked")
        Map<String, Object> document = mapper.readValue(lessonJson, Map.class);
        int exerciseCount = validateDocument(document);

        // Branded text and orange header remain, but all workbook image logos are disabled.
        // Do not fetch or rasterize the Brand Guide PDF for each generated worksheet.
        Path runtime = runtimeDirectory();
        Path workspace = Files.createTempDirectory("mindcrafti-workbook-job-");
        try {
            Path dataPath = workspace.resolve("lesson.json");
            Files.writeString(dataPath, lessonJson, StandardCharsets.UTF_8);
            Path output = Files.createDirectory(workspace.resolve("out"));

            String duration = String.valueOf(((Number) requireMap(document.get("meta"), "meta")
                    .get("durationMinutes")).intValue());
            String basename = "Mindcrafti_Workbook_v3";
            ProcessBuilder pb = new ProcessBuilder("node", runtime.resolve("generate.mjs").toString(),
                    "--lesson=" + dataPath, "--out=" + output,
                    "--basename=" + basename);
            pb.directory(runtime.toFile());
            pb.redirectErrorStream(true);
            Path logs = workspace.resolve("renderer.log");
            pb.redirectOutput(logs.toFile());
            Process job;
            try {
                job = pb.start();
            } catch (IOException ex) {
                throw new IllegalStateException("Workbook v3 runtime is not installed: node/python3/WeasyPrint/PyMuPDF required", ex);
            }
            boolean finished;
            try {
                finished = job.waitFor(115, TimeUnit.SECONDS);
            } catch (InterruptedException ex) {
                job.descendants().forEach(ProcessHandle::destroyForcibly);
                job.destroyForcibly();
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Workbook rendering was interrupted", ex);
            }
            if (!finished) {
                job.descendants().forEach(ProcessHandle::destroyForcibly);
                job.destroyForcibly();
                throw new IllegalStateException("Workbook rendering exceeded 115 seconds");
            }
            if (job.exitValue() != 0) {
                String fullLog = Files.readString(logs, StandardCharsets.UTF_8);
                throw new IllegalArgumentException("Workbook generation/QA failed: " +
                        fullLog.substring(Math.max(0, fullLog.length() - 1800)));
            }
            long renderedNanos = System.nanoTime();
            Path workbookPath=output.resolve(basename + "_Arbeitsheft_" + duration + "min.pdf");
            Path answersPath=output.resolve(basename + "_Lehrerloesungen_" + duration + "min.pdf");
            if(Files.size(workbookPath)>MAX_DOCUMENT_BYTES || Files.size(answersPath)>MAX_DOCUMENT_BYTES)
                throw new IllegalArgumentException("One generated PDF exceeds the 15 MB limit");
            byte[] workbook = Files.readAllBytes(workbookPath);
            byte[] answers = Files.readAllBytes(answersPath);
            if (workbook.length > MAX_DOCUMENT_BYTES || answers.length > MAX_DOCUMENT_BYTES)
                throw new IllegalArgumentException("One generated PDF exceeds the 15 MB limit");
            // A homework day must remain ONE physical A4 student PDF page, even
            // after the generator's safety-driven auto-pagination. Never silently
            // turn a 10-minute daily homework into a multi-page worksheet.
            if(Boolean.TRUE.equals(requireMap(document.get("meta"),"meta").get("homeworkMode"))) {
                try(PDDocument oneDay=Loader.loadPDF(workbook)) {
                    if(oneDay.getNumberOfPages()!=1)
                        throw new IllegalArgumentException("Homework day must fit on exactly one A4 student page; reduce tasks or visual size");
                }
            }
            @SuppressWarnings("unchecked") Map<String,Object> mathQa=mapper.readValue(Files.readString(output.resolve(basename+"_math-qa.json")),Map.class);
            if(!Boolean.TRUE.equals(mathQa.get("passed"))) throw new IllegalStateException("Renderer math QA report did not pass");
            Map<String, Object> result = drafts.createFromRenderer(teacher, eventId, workbook,
                    answers, planSummary, difficultySummary, exerciseCount, null);
            result.put("generator", "Mindcrafti SVG/A4 workbook " + VERSION);
            result.put("lessonDurationMinutes", Integer.parseInt(duration));
            result.put("durationMinutes", Integer.parseInt(duration));
            result.put("workbook", Map.of("filename", result.get("workbookFilename"), "sizeBytes", workbook.length));
            result.put("answers", Map.of("filename", result.get("answersFilename"), "sizeBytes", answers.length));
            Map<String,Object> qa=new java.util.LinkedHashMap<>();
            qa.put("mathPassed",true);
            qa.put("layoutPassed",true);
            qa.put("rawLatexFound",false);
            qa.put("algebraChecked",mathQa.getOrDefault("checked",0));
            qa.put("algebraCoverage",mathQa.getOrDefault("coverage","explicit assertions only"));
            qa.put("arithmeticChains",mathQa.getOrDefault("arithmeticChains",0));
            qa.put("graphWarnings",mathQa.getOrDefault("graphWarnings",List.of()));
            result.put("qa",qa);
            result.put("published", false);
            result.put("renderMs", (renderedNanos - startedNanos) / 1_000_000L);
            long totalMs = (System.nanoTime() - startedNanos) / 1_000_000L;
            result.put("totalGenerationMs", totalMs);
            LOG.info("Mindcrafti workbook renderer successful: renderMs={} storageAndVerificationMs={} totalMs={} studentBytes={} teacherBytes={}",
                    (renderedNanos - startedNanos) / 1_000_000L,
                    (System.nanoTime() - renderedNanos) / 1_000_000L,
                    totalMs, workbook.length, answers.length);
            result.put("runtimeCached", true);
            result.put("publication", "DRAFT only; review both PDFs before calling publish_lesson_draft");
            return result;
        } finally {
            cleanupWorkspace(workspace);
        }
    }

    private static void cleanupWorkspace(Path workspace) {
        try (var paths = Files.walk(workspace)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            });
        } catch (IOException ignored) { }
    }

    static int validateDocument(Map<String, Object> document) {
        for (String key : List.of("homework", "homeworkDays", "homeworkPdf", "assignment")) {
            if (document.containsKey(key))
                throw new IllegalArgumentException("Homework belongs to a separate workflow");
        }
        Map<?, ?> meta = requireMap(document.get("meta"), "meta");
        Object n = meta.get("durationMinutes");
        if (!(n instanceof Number minutes) || minutes.intValue() < 30 || minutes.intValue() > 240
                || minutes.doubleValue() != minutes.intValue())
            throw new IllegalArgumentException("meta.durationMinutes must be an integer from 30 to 240");
        String school = String.valueOf(meta.get("school"));
        if (!"MINDCRAFTI SCHOOL".equalsIgnoreCase(school.trim()))
            throw new IllegalArgumentException("meta.school must be MINDCRAFTI SCHOOL");
        // Fail unsupported physical dimensions before queuing or opening a PDF
        // renderer. All paths (MCH3 drafts, homework and direct renderer) share
        // the same schema bounds as schema.mjs.
        validateSpacerLimits(document, 0);
        List<?> studentPages = requirePages(document.get("workbookPages"), "workbookPages", 18);
        List<?> teacherPages = requirePages(document.get("teacherPages"), "teacherPages", 12);
        int count = 0;
        for (Object page : studentPages) {
            Map<?, ?> p = requireMap(page, "student page");
            for (Object item : requireBlocks(p)) {
                count += inspectStudentTree(requireMap(item, "student block"), 0);
            }
        }
        for (Object page : teacherPages) {
            Map<?, ?> p = requireMap(page, "teacher page");
            for (Object block : requireBlocks(p)) requireMap(block, "teacher block");
        }
        if (count < 1 || count > 120) throw new IllegalArgumentException("Workbook needs 1..120 student exercises");
        return count;
    }

    private static final java.util.regex.Pattern SPACER_LENGTH =
            java.util.regex.Pattern.compile("^(\\d+(?:\\.\\d+)?)(mm|px|em)$");

    private static void validateSpacerLimits(Object raw, int depth) {
        if (depth > 32) throw new IllegalArgumentException("Workbook layout is too deeply nested");
        if (raw instanceof Map<?, ?> map) {
            if ("spacer".equals(map.get("type"))) {
                Object height = map.get("height");
                if (height != null) {
                    if (!(height instanceof String text))
                        throw new IllegalArgumentException("spacer.height must be a length such as 40mm; maximum 60mm");
                    var matcher = SPACER_LENGTH.matcher(text);
                    if (!matcher.matches())
                        throw new IllegalArgumentException("spacer.height must be a length such as 40mm; maximum 60mm");
                    double amount = Double.parseDouble(matcher.group(1));
                    double multiplier = switch (matcher.group(2)) {
                        case "px" -> 25.4 / 96;
                        case "em" -> 16 * 25.4 / 96;
                        default -> 1.0;
                    };
                    if (amount * multiplier > 60)
                        throw new IllegalArgumentException("spacer.height exceeds 60mm; use exercise.writeLines for large handwriting areas");
                }
            }
            for (Object child : map.values())
                if (child instanceof Map<?, ?> || child instanceof List<?>)
                    validateSpacerLimits(child, depth + 1);
        } else if (raw instanceof List<?> list) {
            for (Object child : list)
                if (child instanceof Map<?, ?> || child instanceof List<?>)
                    validateSpacerLimits(child, depth + 1);
        }
    }

    /** Inspect all nested layout containers, not only the top-level block list. */
    private static int inspectStudentTree(Object raw, int depth) {
        if (depth > 32) throw new IllegalArgumentException("Workbook layout is too deeply nested");
        int count = 0;
        if (raw instanceof Map<?,?> map) {
            String type = String.valueOf(map.get("type"));
            if (List.of("solutions", "schedule", "teacherNote").contains(type))
                throw new IllegalArgumentException("Teacher-only block in student PDF: " + type);
            if ("exercise".equals(type) || "taskCard".equals(type) || "visualTask".equals(type))
                count = map.get("rows") instanceof List<?> rows && !rows.isEmpty() ? rows.size() : 1;
            for (Object value : map.values()) if (value instanceof Map<?,?> || value instanceof List<?>)
                count += inspectStudentTree(value, depth + 1);
        } else if (raw instanceof List<?> list) {
            if (list.size() > 200) throw new IllegalArgumentException("Workbook collection is too large");
            for (Object value : list) count += inspectStudentTree(value, depth + 1);
        }
        return count;
    }

    private static Map<?, ?> requireMap(Object raw, String name) {
        if (!(raw instanceof Map<?, ?> map)) throw new IllegalArgumentException(name + " must be an object");
        return map;
    }
    private static List<?> requirePages(Object raw, String name, int max) {
        if (!(raw instanceof List<?> pages) || pages.isEmpty() || pages.size() > max)
            throw new IllegalArgumentException(name + " must contain 1.." + max + " pages");
        return pages;
    }
    private static List<?> requireBlocks(Map<?, ?> page) {
        if (!(page.get("blocks") instanceof List<?> blocks) || blocks.isEmpty() || blocks.size() > 35)
            throw new IllegalArgumentException("Each page must contain 1..35 blocks");
        return blocks;
    }
}
