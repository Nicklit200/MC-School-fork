package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.settings.SchoolBrandGuideService;
import java.awt.image.BufferedImage;
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
import javax.imageio.ImageIO;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Secure adapter between the owner-only MCP tool and the Git-versioned SVG/PDF
 * renderer. No source code, template files or shell commands come from the model.
 * Generated files are only stored as unpublished teacher-owned lesson drafts.
 */
@Service
public class OwnerWorkbookPdfRenderService {
    static final int MAX_INPUT_CHARS = 115_000;
    static final int MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
    static final String VERSION = "2026-11-05-v4-fast-shared";
    private static final List<String> RENDER_FILES = List.of(
            "generate.mjs", "diagrams.mjs", "styles.css", "render_pdf.py", "verify_pdf.py");

    private final ObjectMapper mapper;
    private final LessonPdfDraftService drafts;
    private final SchoolBrandGuideService brandGuide;
    private final Path runtimeDirectory;
    private volatile CachedLogo cachedLogo;

    public OwnerWorkbookPdfRenderService(ObjectMapper mapper, LessonPdfDraftService drafts,
                                         SchoolBrandGuideService brandGuide) {
        this.mapper = mapper;
        this.drafts = drafts;
        this.brandGuide = brandGuide;
        this.runtimeDirectory = prepareRuntimeDirectory();
    }

    private Path prepareRuntimeDirectory() {
        try {
            Path runtime = Files.createTempDirectory("mindcrafti-workbook-runtime-");
            for (String name : RENDER_FILES) {
                try (var input = new ClassPathResource("owner-workbook-generator/" + name).getInputStream()) {
                    Files.copy(input, runtime.resolve(name));
                }
            }
            runtime.toFile().deleteOnExit();
            return runtime;
        } catch (IOException ex) {
            throw new IllegalStateException("Cannot initialize Mindcrafti workbook renderer runtime", ex);
        }
    }

    private BufferedImage officialLogo(AuthenticatedUser teacher) throws IOException {
        var guide = brandGuide.readForStaff(teacher);
        CachedLogo current = cachedLogo;
        if (current != null && Objects.equals(current.updatedAt(), guide.updatedAt())) return current.image();
        synchronized (this) {
            current = cachedLogo;
            if (current != null && Objects.equals(current.updatedAt(), guide.updatedAt())) return current.image();
            BufferedImage image = LessonPdfDraftService.extractOfficialLogo(brandGuide.pdfForStaff(teacher).bytes());
            cachedLogo = new CachedLogo(guide.updatedAt(), image);
            return image;
        }
    }

    public Map<String, Object> create(AuthenticatedUser teacher, String eventId,
                                      String lessonJson, String planSummary,
                                      String difficultySummary) throws Exception {
        Objects.requireNonNull(teacher, "teacher");
        if (eventId == null || eventId.isBlank())
            throw new IllegalArgumentException("eventId is required");
        if (lessonJson == null || lessonJson.isBlank() || lessonJson.length() > MAX_INPUT_CHARS)
            throw new IllegalArgumentException("lessonJson length must be 1..115000 characters");
        @SuppressWarnings("unchecked")
        Map<String, Object> document = mapper.readValue(lessonJson, Map.class);
        int exerciseCount = validateDocument(document);

        BufferedImage officialLogo = officialLogo(teacher);
        Path workspace = Files.createTempDirectory("mindcrafti-workbook-job-");
        try {
            Path logoPath = workspace.resolve("logo.png");
            if (!ImageIO.write(officialLogo, "png", logoPath.toFile()))
                throw new IllegalStateException("Cannot encode official school logo");
            Path dataPath = workspace.resolve("lesson.json");
            Files.writeString(dataPath, lessonJson, StandardCharsets.UTF_8);
            Path output = Files.createDirectory(workspace.resolve("out"));

            String duration = String.valueOf(((Number) requireMap(document.get("meta"), "meta")
                    .get("durationMinutes")).intValue());
            String basename = "Mindcrafti_Workbook_v3";
            ProcessBuilder pb = new ProcessBuilder("node", runtimeDirectory.resolve("generate.mjs").toString(),
                    "--lesson=" + dataPath, "--out=" + output,
                    "--basename=" + basename, "--logo=" + logoPath);
            pb.directory(runtimeDirectory.toFile());
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
                job.destroyForcibly();
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Workbook rendering was interrupted", ex);
            }
            if (!finished) {
                job.destroyForcibly();
                throw new IllegalStateException("Workbook rendering exceeded 115 seconds");
            }
            if (job.exitValue() != 0) {
                String fullLog = Files.readString(logs, StandardCharsets.UTF_8);
                throw new IllegalArgumentException("Workbook generation/QA failed: " +
                        fullLog.substring(Math.max(0, fullLog.length() - 1800)));
            }
            byte[] workbook = Files.readAllBytes(output.resolve(basename + "_Arbeitsheft_" + duration + "min.pdf"));
            byte[] answers = Files.readAllBytes(output.resolve(basename + "_Lehrerloesungen_" + duration + "min.pdf"));
            if (workbook.length > MAX_DOCUMENT_BYTES || answers.length > MAX_DOCUMENT_BYTES)
                throw new IllegalArgumentException("One generated PDF exceeds the 15 MB limit");
            Map<String, Object> result = drafts.createFromRenderer(teacher, eventId, workbook,
                    answers, planSummary, difficultySummary, exerciseCount, officialLogo);
            result.put("generator", "Mindcrafti SVG/A4 workbook " + VERSION);
            result.put("lessonDurationMinutes", Integer.parseInt(duration));
            result.put("publication", "DRAFT only; review both PDFs before calling publish_lesson_draft");
            return result;
        } finally {
            try (var paths = Files.walk(workspace)) {
                paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                    try { Files.deleteIfExists(path); } catch (IOException ignored) { }
                });
            } catch (IOException ignored) { }
        }
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
        List<?> studentPages = requirePages(document.get("workbookPages"), "workbookPages", 18);
        List<?> teacherPages = requirePages(document.get("teacherPages"), "teacherPages", 12);
        int count = 0;
        for (Object page : studentPages) {
            Map<?, ?> p = requireMap(page, "student page");
            for (Object item : requireBlocks(p)) {
                Map<?, ?> block = requireMap(item, "student block");
                String type = String.valueOf(block.get("type"));
                if (List.of("solutions", "schedule", "teacherNote").contains(type))
                    throw new IllegalArgumentException("Teacher-only block in student PDF: " + type);
                if ("exercise".equals(type)) {
                    if (block.get("rows") instanceof List<?> rows) count += rows.size();
                    else count++;
                }
            }
        }
        for (Object page : teacherPages) {
            Map<?, ?> p = requireMap(page, "teacher page");
            for (Object block : requireBlocks(p)) requireMap(block, "teacher block");
        }
        if (count < 1 || count > 120) throw new IllegalArgumentException("Workbook needs 1..120 student exercises");
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

    private record CachedLogo(Instant updatedAt, BufferedImage image) {}
}
