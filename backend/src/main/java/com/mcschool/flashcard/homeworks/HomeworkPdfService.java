package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.homeworks.dto.HomeworkPageOverlayRequest;
import com.mcschool.flashcard.homeworks.dto.SubmitHomeworkRequest;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.apache.pdfbox.rendering.ImageType;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class HomeworkPdfService {

    private static final long MAX_PDF_BYTES = 15L * 1024L * 1024L;
    private static final float PAGE_RENDER_DPI = 144f;

    private final HomeworkRepository homeworkRepository;
    private final UserRepository userRepository;

    public HomeworkPdfService(HomeworkRepository homeworkRepository, UserRepository userRepository) {
        this.homeworkRepository = homeworkRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    public void uploadWorksheet(AuthenticatedUser teacher, UUID homeworkId, MultipartFile file) {
        Homework homework = requireTeacherHomework(teacher.id(), homeworkId);
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("PDF file is required");
        if (file.getSize() > MAX_PDF_BYTES) throw new IllegalArgumentException("PDF is too large");
        String filename = file.getOriginalFilename() == null ? "worksheet.pdf" : file.getOriginalFilename();
        if (!filename.toLowerCase().endsWith(".pdf")) throw new IllegalArgumentException("Only PDF files are supported");
        try {
            byte[] bytes = file.getBytes();
            try (PDDocument document = Loader.loadPDF(bytes)) {
                if (document.getNumberOfPages() == 0) throw new IllegalArgumentException("PDF has no pages");
                homework.attachWorksheet(filename, bytes, document.getNumberOfPages());
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("Could not read PDF", e);
        }
    }

    @Transactional(readOnly = true)
    public byte[] renderStudentPage(AuthenticatedUser student, UUID homeworkId, int pageIndex) {
        Homework homework = requireStudentHomework(student.id(), homeworkId);
        ensureWorksheet(homework);
        if (pageIndex < 0 || pageIndex >= homework.getWorksheetPageCount()) {
            throw new ResourceNotFoundException("Homework page not found");
        }
        byte[] sourcePdf = homework.isSubmitted() ? homework.getSubmittedPdf() : homework.getWorksheetPdf();
        try (PDDocument document = Loader.loadPDF(sourcePdf);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDFRenderer renderer = new PDFRenderer(document);
            BufferedImage image = renderer.renderImageWithDPI(pageIndex, PAGE_RENDER_DPI, ImageType.RGB);
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Could not render homework PDF", e);
        }
    }

    @Transactional
    public void submit(AuthenticatedUser student, UUID homeworkId, SubmitHomeworkRequest request) {
        Homework homework = requireStudentHomework(student.id(), homeworkId);
        ensureWorksheet(homework);
        if (homework.isSubmitted()) throw new IllegalArgumentException("Homework has already been submitted");
        try (PDDocument document = Loader.loadPDF(homework.getWorksheetPdf());
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            for (HomeworkPageOverlayRequest overlay : request.overlays()) {
                if (overlay.pageIndex() < 0 || overlay.pageIndex() >= document.getNumberOfPages()) {
                    throw new IllegalArgumentException("Invalid page index");
                }
                byte[] png = decodeBase64Image(overlay.imageBase64());
                PDPage page = document.getPage(overlay.pageIndex());
                PDRectangle box = page.getCropBox();
                PDImageXObject image = PDImageXObject.createFromByteArray(document, png,
                        "homework-overlay-" + overlay.pageIndex());
                try (PDPageContentStream content = new PDPageContentStream(document, page,
                        PDPageContentStream.AppendMode.APPEND, true, true)) {
                    content.drawImage(image, box.getLowerLeftX(), box.getLowerLeftY(), box.getWidth(), box.getHeight());
                }
            }
            document.save(out);
            String baseName = homework.getWorksheetFilename() == null
                    ? "homework" : homework.getWorksheetFilename().replaceFirst("(?i)\\.pdf$", "");
            homework.submitWorksheet(baseName + "-submitted.pdf", out.toByteArray(), Instant.now());
        } catch (IOException e) {
            throw new IllegalStateException("Could not create submitted PDF", e);
        }
    }

    @Transactional(readOnly = true)
    public byte[] teacherSubmission(AuthenticatedUser teacher, UUID homeworkId) {
        Homework homework = requireTeacherHomework(teacher.id(), homeworkId);
        if (!homework.isSubmitted()) throw new ResourceNotFoundException("Homework has not been submitted yet");
        return homework.getSubmittedPdf();
    }

    @Transactional(readOnly = true)
    public String submissionFilename(AuthenticatedUser teacher, UUID homeworkId) {
        Homework homework = requireTeacherHomework(teacher.id(), homeworkId);
        if (!homework.isSubmitted()) throw new ResourceNotFoundException("Homework has not been submitted yet");
        return homework.getSubmittedFilename();
    }

    private byte[] decodeBase64Image(String value) {
        String payload = value;
        int comma = value.indexOf(',');
        if (comma >= 0) payload = value.substring(comma + 1);
        try {
            return Base64.getDecoder().decode(payload);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid drawing data", e);
        }
    }

    private void ensureWorksheet(Homework homework) {
        if (!homework.hasWorksheet() || homework.getWorksheetPageCount() == null) {
            throw new ResourceNotFoundException("Homework PDF not found");
        }
    }

    private Homework requireTeacherHomework(UUID teacherId, UUID homeworkId) {
        Homework homework = homeworkRepository.findById(homeworkId)
                .orElseThrow(() -> new ResourceNotFoundException("Homework not found"));
        User student = homework.getStudent();
        if (student.getTeacher() == null || !student.getTeacher().getId().equals(teacherId) || student.isArchived()) {
            throw new ResourceNotFoundException("Homework not found");
        }
        return homework;
    }

    private Homework requireStudentHomework(UUID studentId, UUID homeworkId) {
        Homework homework = homeworkRepository.findByIdAndStudentId(homeworkId, studentId)
                .orElseThrow(() -> new ResourceNotFoundException("Homework not found"));
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        if (!homework.getStudent().getId().equals(student.getId())) throw new ResourceNotFoundException("Homework not found");
        return homework;
    }
}
