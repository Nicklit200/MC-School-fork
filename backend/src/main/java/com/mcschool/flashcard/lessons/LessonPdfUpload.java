package com.mcschool.flashcard.lessons;

import java.io.IOException;
import org.apache.pdfbox.Loader;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Shared validation for private lesson PDFs; no document role is inferred from a filename. */
final class LessonPdfUpload {
    private static final int MAX_PDF_BYTES = 25 * 1024 * 1024;
    private LessonPdfUpload() {}

    static String filename(String value, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        String clean = value.replace('\\', '/');
        clean = clean.substring(clean.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\\p{Cf}\\\"<>:|?*]", "").strip();
        if (clean.isBlank()) return fallback;
        if (clean.length() > 255) clean = clean.substring(0, 251) + ".pdf";
        return clean;
    }

    static void validate(byte[] pdf) {
        if (pdf != null && pdf.length > MAX_PDF_BYTES)
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "PDF must not exceed 25 MB");
        if (pdf == null || pdf.length < 5 || pdf[0] != '%' || pdf[1] != 'P' || pdf[2] != 'D'
                || pdf[3] != 'F' || pdf[4] != '-')
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Please upload a valid PDF");
        try (var document = Loader.loadPDF(pdf)) {
            if (document.isEncrypted() || document.getNumberOfPages() == 0) throw new IOException("Unreadable PDF");
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Please upload a readable PDF with at least one page");
        }
    }
}
