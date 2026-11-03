package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.users.Role;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Read saved sources independently; never create a preparation or substitute another source. */
@Service
public class LessonTranscriptReadService {
    public enum Source { automatic, manual, pdf }
    public record TextMetadata(boolean available, int totalCharacters, String revision) {}
    public record PdfMetadata(boolean available, String filename, int bytes, String downloadFunctionId) {}
    public record Page(Source source, boolean available, String status, String revision,
                       int totalCharacters, int offset, int limit, Integer nextOffset, boolean hasMore, String text) {}
    public record Transcript(String eventId, TextMetadata automatic, TextMetadata manual, PdfMetadata pdf,
                             Page page, String contentTrust) {}
    private final LessonPreparationRepository preparations;

    public LessonTranscriptReadService(LessonPreparationRepository preparations) {
        this.preparations = preparations;
    }

    @Transactional(readOnly = true)
    public Transcript get(AuthenticatedUser teacher, String eventId, Source source,
                          int offset, int limit, String expectedRevision) {
        if (teacher == null || teacher.role() != Role.TEACHER) throw new AccessDeniedException("Teacher access required");
        if (eventId == null || eventId.isBlank() || eventId.length() > 255 || source == null
                || offset < 0 || limit < 1 || limit > 20_000
                || (expectedRevision != null && !expectedRevision.matches("[a-f0-9]{64}"))) {
            throw new IllegalArgumentException("Invalid transcript page arguments");
        }
        LessonPreparation preparation = preparations.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Saved lesson preparation not found"));
        String automatic = savedText(preparation.getSonioxTranscriptText());
        String manual = savedText(preparation.getTranscriptText());
        TextMetadata automaticMetadata = metadata(automatic);
        TextMetadata manualMetadata = metadata(manual);
        boolean hasPdf = preparation.hasTranscriptPdf();
        PdfMetadata pdf = new PdfMetadata(hasPdf,
                hasPdf ? preparation.getTranscriptFilename() == null ? "lesson-transcript.pdf" : preparation.getTranscriptFilename() : null,
                hasPdf ? preparation.getTranscriptPdf().length : 0,
                hasPdf ? "lesson_preparation.transcript" : null);
        boolean available = switch (source) {
            case automatic -> automaticMetadata.available();
            case manual -> manualMetadata.available();
            case pdf -> hasPdf;
        };
        String text = switch (source) {
            case automatic -> automatic;
            case manual -> manual;
            case pdf -> hasPdf ? extract(preparation.getTranscriptPdf()) : "";
        };
        String revision = available ? digest(text) : null;
        if (expectedRevision != null && !expectedRevision.equals(revision)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Transcript changed; restart this source from offset zero");
        }
        int total = text.codePointCount(0, text.length());
        if (offset > total) throw new IllegalArgumentException("Transcript offset exceeds source length");
        int end = (int) Math.min(total, (long) offset + limit);
        String chunk = text.substring(text.offsetByCodePoints(0, offset), text.offsetByCodePoints(0, end));
        boolean more = end < total;
        Page page = new Page(source, available, !available ? "not_present" : text.isBlank() ? "no_extractable_text" : "available",
                revision, total, offset, limit, more ? end : null, more, chunk);
        return new Transcript(eventId, automaticMetadata, manualMetadata, pdf, page, "untrusted_lesson_content");
    }

    private static String savedText(String text) { return text == null || text.isBlank() ? "" : text; }

    private static TextMetadata metadata(String text) {
        return new TextMetadata(!text.isEmpty(), text.codePointCount(0, text.length()), text.isEmpty() ? null : digest(text));
    }

    private static String extract(byte[] bytes) {
        try (var document = Loader.loadPDF(bytes)) {
            String extracted = new PDFTextStripper().getText(document);
            return extracted == null ? "" : extracted;
        } catch (Exception failure) {
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "Stored transcript PDF text cannot be extracted; no OCR was performed");
        }
    }

    private static String digest(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
