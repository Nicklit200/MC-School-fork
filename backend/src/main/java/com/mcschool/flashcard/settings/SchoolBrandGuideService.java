package com.mcschool.flashcard.settings;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SchoolBrandGuideService {

    private static final short GUIDE_ID = 1;
    private static final int MAX_GUIDE_TEXT_LENGTH = 30000;
    private static final int MAX_PDF_BYTES = 15 * 1024 * 1024;

    private final SchoolBrandGuideRepository repository;

    public SchoolBrandGuideService(SchoolBrandGuideRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public SchoolBrandGuideResponse readForStaff(AuthenticatedUser caller) {
        requireStaff(caller);
        return toResponse(requireGuide());
    }

    @Transactional(readOnly = true)
    public Map<String, Object> readForMcp() {
        SchoolBrandGuide guide = requireGuide();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("guideText", guide.getGuideText() == null ? "" : guide.getGuideText());
        result.put("filename", guide.getPdfFilename());
        result.put("mimeType", guide.hasPdf() ? "application/pdf" : null);
        result.put("sizeBytes", guide.hasPdf() ? guide.getPdfData().length : 0);
        result.put("base64", guide.hasPdf() ? Base64.getEncoder().encodeToString(guide.getPdfData()) : null);
        result.put("updatedAt", guide.getUpdatedAt() == null ? null : guide.getUpdatedAt().toString());
        result.put("configured", (guide.getGuideText() != null && !guide.getGuideText().isBlank()) || guide.hasPdf());
        result.put("usage", "Use this Brand Guide for the visual design of every Mindcrafti document, PDF, report, homework, diagnostic, worksheet, presentation and other branded material unless the administrator explicitly asks not to use it. If a PDF is present, treat it as the visual source of truth and the text as a searchable summary.");
        return result;
    }

    @Transactional
    public SchoolBrandGuideResponse update(AuthenticatedUser caller, UpdateSchoolBrandGuideRequest request) {
        if (caller == null || caller.role() != Role.ADMIN) {
            throw new IllegalArgumentException("Admin role required");
        }
        return updateInternal(request);
    }

    @Transactional
    public SchoolBrandGuideResponse updateFromMcp(User caller, String guideText, String filename, String pdfBase64) {
        if (caller == null || caller.getRole() != Role.ADMIN) {
            throw new IllegalArgumentException("Admin role required");
        }
        return updateInternal(new UpdateSchoolBrandGuideRequest(guideText, filename, pdfBase64));
    }

    @Transactional(readOnly = true)
    public BrandGuidePdf pdfForStaff(AuthenticatedUser caller) {
        requireStaff(caller);
        SchoolBrandGuide guide = requireGuide();
        if (!guide.hasPdf()) {
            throw new IllegalArgumentException("Brand Guide PDF is not uploaded yet");
        }
        String filename = guide.getPdfFilename();
        if (filename == null || filename.isBlank()) filename = "Mindcrafti_Brand_Guide.pdf";
        return new BrandGuidePdf(filename, guide.getPdfData());
    }

    private SchoolBrandGuideResponse updateInternal(UpdateSchoolBrandGuideRequest request) {
        if (request == null) throw new IllegalArgumentException("Request is required");
        boolean hasTextChange = request.guideText() != null;
        boolean hasPdfChange = request.pdfBase64() != null && !request.pdfBase64().isBlank();
        if (!hasTextChange && !hasPdfChange) {
            throw new IllegalArgumentException("Provide guideText and/or pdfBase64");
        }

        SchoolBrandGuide guide = requireGuide();
        if (hasTextChange) {
            if (request.guideText().length() > MAX_GUIDE_TEXT_LENGTH) {
                throw new IllegalArgumentException("Brand Guide text exceeds 30000 characters");
            }
            guide.updateGuideText(request.guideText());
        }

        if (hasPdfChange) {
            byte[] pdf;
            try {
                pdf = Base64.getDecoder().decode(request.pdfBase64().replaceAll("\\s+", ""));
            } catch (IllegalArgumentException ex) {
                throw new IllegalArgumentException("pdfBase64 is not valid base64");
            }
            if (pdf.length == 0) throw new IllegalArgumentException("Brand Guide PDF is empty");
            if (pdf.length > MAX_PDF_BYTES) throw new IllegalArgumentException("Brand Guide PDF exceeds 15 MB");
            if (!looksLikePdf(pdf)) throw new IllegalArgumentException("Uploaded Brand Guide file is not a PDF");
            guide.attachPdf(normalizedPdfFilename(request.filename()), pdf);
        }

        return toResponse(repository.save(guide));
    }

    private SchoolBrandGuide requireGuide() {
        return repository.findById(GUIDE_ID)
                .orElseThrow(() -> new IllegalStateException("School Brand Guide is not initialized"));
    }

    private void requireStaff(AuthenticatedUser caller) {
        if (caller == null || (caller.role() != Role.ADMIN && caller.role() != Role.TEACHER)) {
            throw new IllegalArgumentException("Staff role required");
        }
    }

    private SchoolBrandGuideResponse toResponse(SchoolBrandGuide guide) {
        return new SchoolBrandGuideResponse(
                guide.getGuideText() == null ? "" : guide.getGuideText(),
                guide.getPdfFilename(),
                guide.hasPdf(),
                guide.hasPdf() ? guide.getPdfData().length : 0,
                guide.getUpdatedAt());
    }

    private String normalizedPdfFilename(String filename) {
        String value = filename == null ? "" : filename.trim();
        if (value.isBlank()) return "Mindcrafti_Brand_Guide.pdf";
        value = value.replace("\\", "_").replace("/", "_");
        if (!value.toLowerCase().endsWith(".pdf")) value += ".pdf";
        return value;
    }

    private boolean looksLikePdf(byte[] bytes) {
        if (bytes.length < 5) return false;
        return new String(bytes, 0, 5, StandardCharsets.US_ASCII).equals("%PDF-");
    }

    public record BrandGuidePdf(String filename, byte[] bytes) {
    }
}
