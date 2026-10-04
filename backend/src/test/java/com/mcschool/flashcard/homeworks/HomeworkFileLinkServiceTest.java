package com.mcschool.flashcard.homeworks;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.config.JwtProperties;
import com.mcschool.flashcard.users.User;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.server.ResponseStatusException;

class HomeworkFileLinkServiceTest {

    private static final Instant NOW = Instant.parse("2026-10-04T09:00:00Z");
    private static final JwtProperties KEY = new JwtProperties("test-only-homework-files-key-0123456789", 1440);
    private static final byte[] ORIGINAL = "%PDF-1.7\noriginal worksheet".getBytes(StandardCharsets.UTF_8);
    private static final byte[] SUBMITTED = "%PDF-1.7\nactual student answers".getBytes(StandardCharsets.UTF_8);
    private HomeworkRepository repository;
    private User student;
    private Homework homework;
    private HomeworkFileLinkService service;

    @BeforeEach
    void setUp() {
        repository = mock(HomeworkRepository.class);
        student = mock(User.class);
        User teacher = mock(User.class);
        when(student.getId()).thenReturn(UUID.randomUUID());
        when(teacher.getId()).thenReturn(UUID.randomUUID());
        when(student.getTeacher()).thenReturn(teacher);
        homework = Homework.create(student, LocalDate.of(2026, 10, 3));
        homework.attachWorksheet("original.pdf", ORIGINAL, 1);
        homework.submitWorksheet("student-answer.pdf", SUBMITTED, NOW.minusSeconds(3600));
        when(repository.findById(homework.getId())).thenReturn(Optional.of(homework));
        service = serviceAt(NOW);
    }

    private HomeworkFileLinkService serviceAt(Instant instant) {
        return new HomeworkFileLinkService(repository, KEY, "https://api.example.com/", 60,
                Clock.fixed(instant, ZoneOffset.UTC));
    }

    @Test
    void returnsDistinctLinksWithOneHourExpiryAndNoSecrets() {
        Map<String, Object> links = service.linksFor(homework);
        assertThat(links.get("submittedPdfUrl").toString()).contains("/submission.pdf?").doesNotContain(KEY.secret());
        assertThat(links.get("originalAssignmentUrl").toString()).contains("/worksheet.pdf?");
        assertThat(links.get("submittedPdfUrl")).isNotEqualTo(links.get("originalAssignmentUrl"));
        assertThat(links.get("submittedPdfUrlExpiresAt")).isEqualTo(NOW.plusSeconds(3600).toString());
        assertThat(links.get("originalAssignmentUrlExpiresAt")).isEqualTo(NOW.plusSeconds(3600).toString());
        verifyNoInteractions(repository);
    }

    @Test
    void downloadsExactSubmittedBytesAndOriginalBytesSeparately() {
        HomeworkFileLinkService.Download submitted = download(service, HomeworkFileLinkService.Kind.SUBMISSION,
                params("submittedPdfUrl"));
        HomeworkFileLinkService.Download original = download(service, HomeworkFileLinkService.Kind.WORKSHEET,
                params("originalAssignmentUrl"));
        assertThat(submitted.bytes()).isEqualTo(SUBMITTED).isNotEqualTo(ORIGINAL);
        assertThat(submitted.filename()).isEqualTo("student-answer.pdf");
        assertThat(original.bytes()).isEqualTo(ORIGINAL);
        assertThat(original.filename()).isEqualTo("original.pdf");
    }

    @Test
    void absentSubmissionDoesNotFallBackToWorksheet() {
        Map<String, String> old = params("submittedPdfUrl");
        homework.attachWorksheet("original.pdf", ORIGINAL, 1);
        assertThat(service.linksFor(homework)).containsEntry("submittedPdfUrl", null)
                .containsEntry("submittedPdfUrlExpiresAt", null);
        assertThat(service.linksFor(homework).get("originalAssignmentUrl")).isNotNull();
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.SUBMISSION, old), HttpStatus.NOT_FOUND);
    }

    @Test
    void signatureCannotBeUsedForOtherKind() {
        Map<String, String> p = params("submittedPdfUrl");
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.WORKSHEET, p), HttpStatus.FORBIDDEN);
        verifyNoInteractions(repository);
    }

    @Test
    void signatureCannotBeUsedForOtherHomework() {
        Map<String, String> p = params("submittedPdfUrl");
        assertStatus(() -> service.download(UUID.randomUUID(), HomeworkFileLinkService.Kind.SUBMISSION,
                Long.parseLong(p.get("expires")), p.get("revision"), p.get("signature")), HttpStatus.FORBIDDEN);
        verifyNoInteractions(repository);
    }

    @Test
    void expiryCannotBeExtendedByChangingQueryParameter() {
        Map<String, String> p = params("submittedPdfUrl");
        p.put("expires", String.valueOf(Long.parseLong(p.get("expires")) + 1));
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.SUBMISSION, p), HttpStatus.FORBIDDEN);
        verifyNoInteractions(repository);
    }

    @Test
    void expiresAtExactDeadline() {
        Map<String, String> p = params("submittedPdfUrl");
        assertStatus(() -> download(serviceAt(NOW.plusSeconds(3600)), HomeworkFileLinkService.Kind.SUBMISSION, p),
                HttpStatus.FORBIDDEN);
        verifyNoInteractions(repository);
    }

    @Test
    void alteredSignatureIsRejectedBeforeDatabaseLookup() {
        Map<String, String> p = params("submittedPdfUrl");
        String signature = p.get("signature");
        p.put("signature", (signature.startsWith("A") ? "B" : "A") + signature.substring(1));
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.SUBMISSION, p), HttpStatus.FORBIDDEN);
        verifyNoInteractions(repository);
    }

    @Test
    void missingSignatureIsRejectedBeforeDatabaseLookup() {
        assertStatus(() -> service.download(homework.getId(), HomeworkFileLinkService.Kind.SUBMISSION,
                NOW.plusSeconds(100).getEpochSecond(), "a".repeat(64), null), HttpStatus.FORBIDDEN);
        verifyNoInteractions(repository);
    }

    @Test
    void changedContentInvalidatesOldLinkEvenWithSameTimestamp() {
        Map<String, String> p = params("submittedPdfUrl");
        homework.submitWorksheet("student-answer.pdf", "%PDF-replacement".getBytes(StandardCharsets.UTF_8),
                NOW.minusSeconds(3600));
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.SUBMISSION, p), HttpStatus.GONE);
    }

    @Test
    void changedOwnerInvalidatesOldLink() {
        Map<String, String> p = params("submittedPdfUrl");
        User otherTeacher = mock(User.class);
        when(otherTeacher.getId()).thenReturn(UUID.randomUUID());
        when(student.getTeacher()).thenReturn(otherTeacher);
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.SUBMISSION, p), HttpStatus.GONE);
    }

    @Test
    void archivedStudentCannotBeDownloaded() {
        Map<String, String> p = params("submittedPdfUrl");
        when(student.isArchived()).thenReturn(true);
        assertStatus(() -> download(service, HomeworkFileLinkService.Kind.SUBMISSION, p), HttpStatus.NOT_FOUND);
    }

    @Test
    void knownDevelopmentKeyDoesNotIssueBearerLinks() {
        HomeworkFileLinkService disabled = new HomeworkFileLinkService(repository,
                new JwtProperties("local-dev-only-jwt-secret-change-me-1234567890", 1440),
                "https://api.example.com", 60);
        assertThat(disabled.linksFor(homework)).containsEntry("submittedPdfUrl", null)
                .containsEntry("originalAssignmentUrl", null).containsEntry("fileLinksAvailable", false);
        assertStatus(() -> disabled.download(homework.getId(), HomeworkFileLinkService.Kind.SUBMISSION,
                0, null, null), HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void rejectsUnsafeBaseUrlAndInvalidTtl() {
        assertThatThrownBy(() -> new HomeworkFileLinkService(repository, KEY, "http://example.com", 60))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new HomeworkFileLinkService(repository, KEY, "https://api.example.com", 0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new HomeworkFileLinkService(repository, KEY, "https://api.example.com", 1441))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void controllerReturnsPdfAttachmentWithNoStore() {
        Map<String, String> p = params("submittedPdfUrl");
        var response = new HomeworkPublicFileController(service).submission(homework.getId(),
                Long.parseLong(p.get("expires")), p.get("revision"), p.get("signature"));
        assertThat(response.getBody()).isEqualTo(SUBMITTED);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PDF);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getHeaders().getContentDisposition().getType()).isEqualTo("attachment");
        assertThat(response.getHeaders().getContentDisposition().getFilename()).isEqualTo("student-answer.pdf");
        assertThat(response.getHeaders().getFirst("Referrer-Policy")).isEqualTo("no-referrer");
    }

    private Map<String, String> params(String field) {
        String url = service.linksFor(homework).get(field).toString();
        return Arrays.stream(URI.create(url).getRawQuery().split("&"))
                .map(part -> part.split("=", 2)).collect(Collectors.toMap(pair -> pair[0], pair -> pair[1]));
    }

    private HomeworkFileLinkService.Download download(HomeworkFileLinkService target,
            HomeworkFileLinkService.Kind kind, Map<String, String> p) {
        return target.download(homework.getId(), kind, Long.parseLong(p.get("expires")),
                p.get("revision"), p.get("signature"));
    }

    private void assertStatus(Runnable operation, HttpStatus status) {
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(ResponseStatusException.class,
                ex -> assertThat(ex.getStatusCode()).isEqualTo(status));
    }
}
