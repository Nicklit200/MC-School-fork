package com.mcschool.flashcard.homeworks;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.homeworks.dto.CreateHomeworkRequest;
import com.mcschool.flashcard.homeworks.dto.HomeworkResponse;
import com.mcschool.flashcard.homeworks.dto.SubmitHomeworkRequest;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
public class HomeworkController {

    private final HomeworkService homeworkService;
    private final HomeworkPdfService homeworkPdfService;
    private final HomeworkDriveExportService homeworkDriveExportService;

    public HomeworkController(HomeworkService homeworkService,
                              HomeworkPdfService homeworkPdfService,
                              HomeworkDriveExportService homeworkDriveExportService) {
        this.homeworkService = homeworkService;
        this.homeworkPdfService = homeworkPdfService;
        this.homeworkDriveExportService = homeworkDriveExportService;
    }

    @PostMapping("/students/{studentId}/homeworks")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('TEACHER')")
    public HomeworkResponse createHomework(@AuthenticationPrincipal AuthenticatedUser caller,
                                           @PathVariable UUID studentId,
                                           @Valid @RequestBody CreateHomeworkRequest request) {
        return homeworkService.createHomework(caller, studentId, request);
    }

    /** Always creates a NEW homework row and attaches the selected PDF to it. */
    @PostMapping(value = "/students/{studentId}/homeworks/pdf", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('TEACHER')")
    public HomeworkResponse createPdfHomework(@AuthenticationPrincipal AuthenticatedUser caller,
                                              @PathVariable UUID studentId,
                                              @RequestParam("startDate") LocalDate startDate,
                                              @RequestParam("file") MultipartFile file) {
        return homeworkPdfService.createWorksheetHomework(caller, studentId, startDate, file);
    }

    @GetMapping("/students/{studentId}/homeworks")
    @PreAuthorize("hasRole('TEACHER')")
    public List<HomeworkResponse> listForTeacher(@AuthenticationPrincipal AuthenticatedUser caller,
                                                 @PathVariable UUID studentId) {
        return homeworkService.listForTeacher(caller, studentId);
    }

    @GetMapping("/study/homeworks")
    @PreAuthorize("hasRole('STUDENT')")
    public List<HomeworkResponse> listForStudent(@AuthenticationPrincipal AuthenticatedUser caller) {
        return homeworkService.listForStudent(caller);
    }

    @PostMapping(value = "/homeworks/{homeworkId}/worksheet", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('TEACHER')")
    public void uploadWorksheet(@AuthenticationPrincipal AuthenticatedUser caller,
                                @PathVariable UUID homeworkId,
                                @RequestParam("file") MultipartFile file) {
        homeworkPdfService.uploadWorksheet(caller, homeworkId, file);
    }

    @GetMapping(value = "/study/homeworks/{homeworkId}/worksheet/pages/{pageIndex}", produces = MediaType.IMAGE_PNG_VALUE)
    @PreAuthorize("hasRole('STUDENT')")
    public ResponseEntity<byte[]> worksheetPage(@AuthenticationPrincipal AuthenticatedUser caller,
                                                 @PathVariable UUID homeworkId,
                                                 @PathVariable int pageIndex) {
        byte[] png = homeworkPdfService.renderStudentPage(caller, homeworkId, pageIndex);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_PNG)
                .contentLength(png.length)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(png);
    }

    @GetMapping(value = "/study/homeworks/{homeworkId}/worksheet/pages/{pageIndex}/data-url", produces = MediaType.TEXT_PLAIN_VALUE)
    @PreAuthorize("hasRole('STUDENT')")
    public ResponseEntity<String> worksheetPageDataUrl(@AuthenticationPrincipal AuthenticatedUser caller,
                                                        @PathVariable UUID homeworkId,
                                                        @PathVariable int pageIndex) {
        byte[] png = homeworkPdfService.renderStudentPage(caller, homeworkId, pageIndex);
        String dataUrl = "data:image/png;base64," + Base64.getEncoder().encodeToString(png);
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_PLAIN)
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(dataUrl);
    }

    @PostMapping("/study/homeworks/{homeworkId}/submit-pdf")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STUDENT')")
    public void submitPdf(@AuthenticationPrincipal AuthenticatedUser caller,
                          @PathVariable UUID homeworkId,
                          @Valid @RequestBody SubmitHomeworkRequest request) {
        homeworkPdfService.submit(caller, homeworkId, request);
        homeworkDriveExportService.exportSubmittedHomework(caller.id(), homeworkId);
    }

    @PostMapping(value = "/study/homeworks/{homeworkId}/submit-file", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STUDENT')")
    public void submitFile(@AuthenticationPrincipal AuthenticatedUser caller,
                           @PathVariable UUID homeworkId,
                           @RequestParam("file") MultipartFile file) {
        homeworkPdfService.submitFile(caller, homeworkId, file);
        homeworkDriveExportService.exportSubmittedHomework(caller.id(), homeworkId);
    }

    @GetMapping(value = "/homeworks/{homeworkId}/submission", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasRole('TEACHER')")
    public ResponseEntity<byte[]> downloadSubmission(@AuthenticationPrincipal AuthenticatedUser caller,
                                                     @PathVariable UUID homeworkId) {
        byte[] pdf = homeworkPdfService.teacherSubmission(caller, homeworkId);
        String filename = homeworkPdfService.submissionFilename(caller, homeworkId);
        ContentDisposition disposition = ContentDisposition.attachment()
                .filename(filename, StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .body(pdf);
    }
}
