package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.drive.GoogleDriveService;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.users.User;
import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Line2D;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Creates a durable visual archive of lesson boards after a lesson ends.
 *
 * <p>The annotation operation stream is already the authoritative in-app copy.
 * This service additionally renders it into PDFs and uploads them to the
 * configured lesson-material Google Drive folders.
 */
@Service
public class OnlineClassBoardArchiveService {

    private static final Logger log = LoggerFactory.getLogger(OnlineClassBoardArchiveService.class);
    private static final ZoneId SCHOOL_ZONE = ZoneId.of("Europe/Berlin");
    private static final DateTimeFormatter FILE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm");
    private static final float RENDER_DPI = 96f;
    private static final int BLANK_WIDTH = 1440;
    private static final int BLANK_HEIGHT = 900;

    private final OnlineClassRepository classRepository;
    private final OnlineClassAnnotationDocumentRepository documentRepository;
    private final OnlineClassAnnotationEventRepository eventRepository;
    private final OnlineClassAttendanceRepository attendanceRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final LessonPreparationRepository preparationRepository;
    private final GoogleDriveService googleDriveService;
    private final ObjectMapper objectMapper;

    public OnlineClassBoardArchiveService(
            OnlineClassRepository classRepository,
            OnlineClassAnnotationDocumentRepository documentRepository,
            OnlineClassAnnotationEventRepository eventRepository,
            OnlineClassAttendanceRepository attendanceRepository,
            StudentGroupMemberRepository groupMemberRepository,
            LessonPreparationRepository preparationRepository,
            GoogleDriveService googleDriveService,
            ObjectMapper objectMapper) {
        this.classRepository = classRepository;
        this.documentRepository = documentRepository;
        this.eventRepository = eventRepository;
        this.attendanceRepository = attendanceRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.preparationRepository = preparationRepository;
        this.googleDriveService = googleDriveService;
        this.objectMapper = objectMapper;
    }

    /**
     * Best-effort background archive. Ending the lesson must never wait for
     * Google Drive or fail because Drive is temporarily unavailable.
     */
    @Async
    @Transactional(readOnly = true)
    public void archiveAfterEnd(UUID classId) {
        OnlineClass onlineClass = classRepository.findById(classId).orElse(null);
        if (onlineClass == null || onlineClass.getStatus() != OnlineClassStatus.ENDED) {
            return;
        }

        List<OnlineClassAnnotationDocument> allDocuments = documentRepository
                .findAllByOnlineClassIdOrderByPageIndexAsc(classId)
                .stream()
                .filter(document -> document.getTargetType() == AnnotationTargetType.WHITEBOARD)
                .toList();
        if (allDocuments.isEmpty()) {
            log.info("Skipping board Drive archive because the lesson has no board documents: classId={}", classId);
            return;
        }

        LessonPreparation preparation = preparationRepository
                .findByTeacherIdAndEventId(onlineClass.getTeacher().getId(), onlineClass.getEventId())
                .orElse(null);

        List<OnlineClassAnnotationDocument> sharedDocuments = allDocuments.stream()
                .filter(document -> "shared".equals(document.getTargetId()) || "board-1".equals(document.getTargetId()))
                .toList();
        byte[] sharedPdf = renderPdf(preparation, sharedDocuments);

        Map<UUID, Recipient> recipients = recipientsFor(onlineClass);
        Map<UUID, byte[]> privatePdfs = new LinkedHashMap<>();
        for (Recipient recipient : recipients.values()) {
            List<OnlineClassAnnotationDocument> privateDocuments = allDocuments.stream()
                    .filter(document -> ("student:" + recipient.id()).equals(document.getTargetId()))
                    .toList();
            byte[] pdf = renderPdf(preparation, privateDocuments);
            if (pdf != null) {
                privatePdfs.put(recipient.id(), pdf);
            }
        }

        long lessonNumber = lessonNumber(onlineClass);
        String lessonPrefix = String.format("Urok_%02d", Math.max(1L, lessonNumber));

        // For a group lesson there is one common Google Drive folder.
        // All completed student boards live together and are distinguished by
        // lesson number + student name. We deliberately do not duplicate these
        // group files into every student's personal Drive folder.
        if (onlineClass.getGroup() != null) {
            String groupFolder = onlineClass.getGroup().getGoogleDriveTranscriptFolderId();
            if (!hasText(groupFolder)) {
                log.info("Skipping group board Drive archive because no group lesson folder is configured: classId={} groupId={}",
                        classId, onlineClass.getGroup().getId());
                return;
            }

            uploadIfNeeded(groupFolder, lessonPrefix + "_Obshchaya.pdf", sharedPdf);
            for (Recipient recipient : recipients.values()) {
                uploadIfNeeded(
                        groupFolder,
                        lessonPrefix + "_" + safeFileName(recipient.name()) + ".pdf",
                        privatePdfs.get(recipient.id()));
            }
            log.info("Group lesson board archive finished: classId={} lessonNumber={} recipients={}",
                    classId, lessonNumber, recipients.size());
            return;
        }

        // Individual lesson: keep both the common sheet and the student's
        // completed sheet in that student's lesson folder.
        for (Recipient recipient : recipients.values()) {
            if (!hasText(recipient.folderId())) {
                continue;
            }
            uploadIfNeeded(recipient.folderId(), lessonPrefix + "_Obshchaya.pdf", sharedPdf);
            uploadIfNeeded(
                    recipient.folderId(),
                    lessonPrefix + "_" + safeFileName(recipient.name()) + ".pdf",
                    privatePdfs.get(recipient.id()));
        }

        log.info("Individual lesson board archive finished: classId={} lessonNumber={} recipients={}",
                classId, lessonNumber, recipients.size());
    }

    private long lessonNumber(OnlineClass onlineClass) {
        if (onlineClass.getGroup() != null) {
            return classRepository.countEndedGroupLessonsUpTo(
                    onlineClass.getGroup().getId(), onlineClass.getScheduledStartAt());
        }
        if (onlineClass.getStudent() != null) {
            return classRepository.countEndedStudentLessonsUpTo(
                    onlineClass.getStudent().getId(), onlineClass.getScheduledStartAt());
        }
        return 1L;
    }

    private Map<UUID, Recipient> recipientsFor(OnlineClass onlineClass) {
        Map<UUID, Recipient> result = new LinkedHashMap<>();

        attendanceRepository.findAllByOnlineClassIdOrderByStudentFullNameAsc(onlineClass.getId())
                .forEach(item -> putRecipient(result, item.getStudent()));

        if (result.isEmpty() && onlineClass.getStudent() != null) {
            putRecipient(result, onlineClass.getStudent());
        }

        if (result.isEmpty() && onlineClass.getGroup() != null) {
            groupMemberRepository
                    .findAllByGroupIdOrderByStudentFullNameAsc(onlineClass.getGroup().getId())
                    .forEach(member -> putRecipient(result, member.getStudent()));
        }

        return result;
    }

    private void putRecipient(Map<UUID, Recipient> result, User student) {
        result.put(student.getId(), new Recipient(
                student.getId(),
                student.getFullName(),
                student.getGoogleDriveTranscriptFolderId()));
    }

    private byte[] renderPdf(LessonPreparation preparation,
                             List<OnlineClassAnnotationDocument> documents) {
        if (documents == null || documents.isEmpty()) {
            return null;
        }

        List<OnlineClassAnnotationDocument> ordered = documents.stream()
                .sorted(Comparator.comparingInt(OnlineClassAnnotationDocument::getPageIndex))
                .toList();

        try (PDDocument output = new PDDocument();
             PDDocument workbook = preparation != null && preparation.hasWorkbook()
                     ? Loader.loadPDF(preparation.getWorkbookPdf())
                     : null;
             ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {

            PDFRenderer renderer = workbook == null ? null : new PDFRenderer(workbook);
            Set<Integer> renderedPages = new LinkedHashSet<>();

            for (OnlineClassAnnotationDocument document : ordered) {
                if (!renderedPages.add(document.getPageIndex())) {
                    continue;
                }

                BufferedImage pageImage = createBaseImage(renderer, workbook, document);
                BufferedImage overlay = new BufferedImage(
                        pageImage.getWidth(), pageImage.getHeight(), BufferedImage.TYPE_INT_ARGB);
                Graphics2D graphics = overlay.createGraphics();
                try {
                    configureGraphics(graphics);
                    List<OnlineClassAnnotationEvent> visible = foldVisibleOperations(document.getId());
                    for (OnlineClassAnnotationEvent event : visible) {
                        drawOperation(graphics, event, pageImage.getWidth(), pageImage.getHeight());
                    }
                } finally {
                    graphics.dispose();
                }

                Graphics2D flattened = pageImage.createGraphics();
                try {
                    flattened.setComposite(AlphaComposite.SrcOver);
                    flattened.drawImage(overlay, 0, 0, null);
                } finally {
                    flattened.dispose();
                }

                float pageWidth = pageImage.getWidth() * 72f / RENDER_DPI;
                float pageHeight = pageImage.getHeight() * 72f / RENDER_DPI;
                PDPage page = new PDPage(new PDRectangle(pageWidth, pageHeight));
                output.addPage(page);
                var image = LosslessFactory.createFromImage(output, pageImage);
                try (PDPageContentStream stream = new PDPageContentStream(output, page)) {
                    stream.drawImage(image, 0, 0, pageWidth, pageHeight);
                }
            }

            if (output.getNumberOfPages() == 0) {
                return null;
            }
            output.save(bytes);
            return bytes.toByteArray();
        } catch (Exception ex) {
            log.error("Could not render lesson board PDF", ex);
            return null;
        }
    }

    private BufferedImage createBaseImage(PDFRenderer renderer, PDDocument workbook,
                                          OnlineClassAnnotationDocument document) throws Exception {
        int pageIndex = document.getPageIndex();
        if (renderer != null && workbook != null && pageIndex >= 0 && pageIndex < workbook.getNumberOfPages()) {
            return toRgb(renderer.renderImageWithDPI(pageIndex, RENDER_DPI));
        }

        int width = BLANK_WIDTH;
        int height = BLANK_HEIGHT;
        Integer sourceWidth = document.getSourceWidth();
        Integer sourceHeight = document.getSourceHeight();
        if (sourceWidth != null && sourceHeight != null && sourceWidth > 0 && sourceHeight > 0) {
            double aspect = (double) sourceWidth / (double) sourceHeight;
            width = BLANK_WIDTH;
            height = Math.max(600, Math.min(1800, (int) Math.round(width / aspect)));
        }

        BufferedImage blank = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = blank.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, width, height);
        } finally {
            graphics.dispose();
        }
        return blank;
    }

    private BufferedImage toRgb(BufferedImage source) {
        if (source.getType() == BufferedImage.TYPE_INT_RGB) {
            return source;
        }
        BufferedImage rgb = new BufferedImage(source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = rgb.createGraphics();
        try {
            graphics.setColor(Color.WHITE);
            graphics.fillRect(0, 0, rgb.getWidth(), rgb.getHeight());
            graphics.drawImage(source, 0, 0, null);
        } finally {
            graphics.dispose();
        }
        return rgb;
    }

    private List<OnlineClassAnnotationEvent> foldVisibleOperations(UUID documentId) {
        List<OnlineClassAnnotationEvent> ordered =
                eventRepository.findAllByDocumentIdOrderBySequenceAsc(documentId);
        Map<UUID, OnlineClassAnnotationEvent> visible = new LinkedHashMap<>();
        Map<UUID, OnlineClassAnnotationEvent> originals = new LinkedHashMap<>();
        Set<UUID> undone = new LinkedHashSet<>();

        for (OnlineClassAnnotationEvent event : ordered) {
            switch (event.getOperationType()) {
                case ADD, UPDATE, ERASE -> {
                    originals.putIfAbsent(event.getOperationId(), event);
                    visible.put(event.getOperationId(), event);
                }
                case CLEAR_LAYER -> {
                    UUID ownerId = event.getLayerOwner().getId();
                    visible.entrySet().removeIf(entry ->
                            entry.getValue().getLayerOwner().getId().equals(ownerId));
                }
                case CLEAR_ALL -> {
                    visible.clear();
                    undone.clear();
                }
                case UNDO -> {
                    UUID target = targetOperationId(event.getPayload());
                    OnlineClassAnnotationEvent current = target == null ? null : visible.get(target);
                    if (current != null
                            && current.getLayerOwner().getId().equals(event.getLayerOwner().getId())) {
                        visible.remove(target);
                        undone.add(target);
                    }
                }
                case REDO -> {
                    UUID target = targetOperationId(event.getPayload());
                    if (target == null || !undone.contains(target)) {
                        continue;
                    }
                    OnlineClassAnnotationEvent original = originals.get(target);
                    if (original != null
                            && original.getLayerOwner().getId().equals(event.getLayerOwner().getId())) {
                        visible.put(target, original);
                        undone.remove(target);
                    }
                }
            }
        }

        return visible.values().stream()
                .sorted(Comparator.comparingLong(OnlineClassAnnotationEvent::getSequence))
                .toList();
    }

    private UUID targetOperationId(String payload) {
        try {
            String value = objectMapper.readTree(payload).path("targetOperationId").asString("");
            return value.isBlank() ? null : UUID.fromString(value);
        } catch (RuntimeException ex) {
            return null;
        }
    }

    private void drawOperation(Graphics2D graphics, OnlineClassAnnotationEvent event,
                               int width, int height) {
        JsonNode shape;
        try {
            shape = objectMapper.readTree(event.getPayload());
        } catch (RuntimeException ex) {
            return;
        }

        String kind = shape.path("kind").asString("");
        Color color = parseColor(shape.path("color").asString("#111111"));
        float strokeWidth = Math.max(1f, (float) shape.path("width").asDouble(0.004) * width);

        if ("erase".equals(kind)) {
            graphics.setComposite(AlphaComposite.Clear);
            graphics.setStroke(roundStroke(strokeWidth * 3f));
            drawPointPath(graphics, shape, width, height);
            graphics.setComposite(AlphaComposite.SrcOver);
            return;
        }

        float alpha = "highlighter".equals(kind) ? 0.35f : 1f;
        graphics.setComposite(AlphaComposite.SrcOver.derive(alpha));
        graphics.setColor(color);
        graphics.setStroke(roundStroke(strokeWidth));

        switch (kind) {
            case "pen", "highlighter" -> drawPointPath(graphics, shape, width, height);
            case "line" -> drawLine(graphics, shape, width, height, false);
            case "arrow" -> drawLine(graphics, shape, width, height, true);
            case "rect" -> drawRectangle(graphics, shape, width, height);
            case "ellipse" -> drawEllipse(graphics, shape, width, height);
            case "text" -> drawText(graphics, shape, width, height);
            default -> {
                // Unknown shapes are ignored; persisted validation still keeps normal data safe.
            }
        }
        graphics.setComposite(AlphaComposite.SrcOver);
    }

    private void drawPointPath(Graphics2D graphics, JsonNode shape, int width, int height) {
        JsonNode points = shape.get("points");
        if (points == null || !points.isArray() || points.isEmpty()) {
            return;
        }
        Path2D.Double path = new Path2D.Double();
        boolean first = true;
        for (JsonNode point : points) {
            if (!point.isArray() || point.size() < 2) continue;
            double x = point.get(0).asDouble() * width;
            double y = point.get(1).asDouble() * height;
            if (first) {
                path.moveTo(x, y);
                first = false;
            } else {
                path.lineTo(x, y);
            }
        }
        if (!first) graphics.draw(path);
    }

    private void drawLine(Graphics2D graphics, JsonNode shape, int width, int height, boolean arrow) {
        double x1 = shape.path("x1").asDouble() * width;
        double y1 = shape.path("y1").asDouble() * height;
        double x2 = shape.path("x2").asDouble() * width;
        double y2 = shape.path("y2").asDouble() * height;
        graphics.draw(new Line2D.Double(x1, y1, x2, y2));
        if (!arrow) return;

        double angle = Math.atan2(y2 - y1, x2 - x1);
        double size = Math.max(10.0, ((BasicStroke) graphics.getStroke()).getLineWidth() * 5.0);
        Path2D.Double head = new Path2D.Double();
        head.moveTo(x2, y2);
        head.lineTo(
                x2 - size * Math.cos(angle - Math.PI / 6),
                y2 - size * Math.sin(angle - Math.PI / 6));
        head.lineTo(
                x2 - size * Math.cos(angle + Math.PI / 6),
                y2 - size * Math.sin(angle + Math.PI / 6));
        head.closePath();
        graphics.fill(head);
    }

    private void drawRectangle(Graphics2D graphics, JsonNode shape, int width, int height) {
        double x = shape.path("x").asDouble() * width;
        double y = shape.path("y").asDouble() * height;
        double w = shape.path("w").asDouble() * width;
        double h = shape.path("h").asDouble() * height;
        graphics.draw(new Rectangle2D.Double(
                Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h)));
    }

    private void drawEllipse(Graphics2D graphics, JsonNode shape, int width, int height) {
        double x = shape.path("x").asDouble() * width;
        double y = shape.path("y").asDouble() * height;
        double w = shape.path("w").asDouble() * width;
        double h = shape.path("h").asDouble() * height;
        graphics.draw(new Ellipse2D.Double(
                Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h)));
    }

    private void drawText(Graphics2D graphics, JsonNode shape, int width, int height) {
        double x = shape.path("x").asDouble() * width;
        double y = shape.path("y").asDouble() * height;
        float size = Math.max(10f, (float) shape.path("size").asDouble(0.03) * height);
        graphics.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, Math.max(10, Math.round(size))));
        graphics.drawString(shape.path("text").asString(""), (float) x, (float) y + size);
    }

    private void configureGraphics(Graphics2D graphics) {
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    }

    private BasicStroke roundStroke(float width) {
        return new BasicStroke(Math.max(1f, width), BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND);
    }

    private Color parseColor(String value) {
        try {
            return Color.decode(value);
        } catch (NumberFormatException ex) {
            return Color.BLACK;
        }
    }

    private void uploadIfNeeded(String folderId, String fileName, byte[] bytes) {
        if (!hasText(folderId) || bytes == null || bytes.length == 0) {
            return;
        }
        try {
            if (googleDriveService.fileExists(folderId, fileName)) {
                return;
            }
            googleDriveService.uploadBytes(folderId, fileName, "application/pdf", bytes);
            log.info("Uploaded lesson board PDF to Google Drive: file={}", fileName);
        } catch (RuntimeException ex) {
            log.error("Could not upload lesson board PDF to Google Drive: file={}", fileName, ex);
        }
    }

    private String safeFileName(String value) {
        if (value == null || value.isBlank()) {
            return "lesson";
        }
        String cleaned = value.trim()
                .replaceAll("[\\\\/:*?\"<>|]", "_")
                .replaceAll("\\s+", "_");
        return cleaned.isBlank() ? "lesson" : cleaned;
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private record Recipient(UUID id, String name, String folderId) {}
}
