package com.mcschool.flashcard.lessons;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.Role;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

class WorkbookDraftDownloadServiceTest {
    private static final String SECRET="test-only-configured-secret-at-least-32-bytes";
    private final Clock clock=Clock.fixed(Instant.parse("2026-11-05T12:00:00Z"),ZoneOffset.UTC);
    private final UUID teacherId=UUID.randomUUID(),otherId=UUID.randomUUID(),draftId=UUID.randomUUID();
    private final AuthenticatedUser teacher=new AuthenticatedUser(teacherId,"teacher@test.local",Role.TEACHER);
    private final McpAccessService access=mock(McpAccessService.class);
    private final LessonPdfDraftService drafts=mock(LessonPdfDraftService.class);
    private final GoogleCalendarLessonService lessons=mock(GoogleCalendarLessonService.class);
    private final byte[] bytes="%PDF-1.7\napproved-preview".getBytes(StandardCharsets.US_ASCII);
    private WorkbookDraftDownloadService service;

    @BeforeEach
    void setup() {
        when(access.requireCurrentActor(any())).thenAnswer(i->i.getArgument(0));
        when(access.requireTeacher(any(),any(UUID.class))).thenAnswer(i->{
            AuthenticatedUser actor=i.getArgument(0); UUID target=i.getArgument(1);
            if(actor.role()!=Role.ADMIN && (actor.role()!=Role.TEACHER||!actor.id().equals(target)))throw new AccessDeniedException("Own lessons only");
            return new AuthenticatedUser(target,"teacher@test.local",Role.TEACHER);
        });
        when(drafts.info(any(),eq(draftId))).thenAnswer(i->{
            if(!teacherId.equals(((AuthenticatedUser)i.getArgument(0)).id()))throw new IllegalArgumentException("Draft not found");
            return Map.of("eventId","exact-lesson");
        });
        when(drafts.previewFile(any(),eq(draftId),anyString())).thenReturn(
                new LessonPdfDraftService.PreviewFile("exact-lesson","approved.pdf",bytes));
        when(lessons.listGroupLessons(any())).thenReturn(List.of(new GroupLessonResponse("exact-lesson","exact-lesson",null,null,null,null,
                List.of(),"Math",clock.instant(),clock.instant().plusSeconds(3600),null,null)));
        service=new WorkbookDraftDownloadService(access,drafts,lessons,SECRET,"https://school.example",clock);
    }

    @Test
    void staffPreviewWorksWithoutExpiringTokenAndRechecksOwnership() {
        assertArrayEquals(bytes, service.staffPreview(teacher,teacherId,draftId,"workbook").bytes());
        assertArrayEquals(bytes, service.staffPreview(teacher,teacherId,draftId,"answers").bytes());
        verify(lessons, times(2)).listGroupLessons(any());

        var admin = new AuthenticatedUser(otherId,"admin@test.local",Role.ADMIN);
        assertArrayEquals(bytes, service.staffPreview(admin,teacherId,draftId,"answers").bytes());

        var student = new AuthenticatedUser(otherId,"student@test.local",Role.STUDENT);
        assertThrows(RuntimeException.class,
                () -> service.staffPreview(student,teacherId,draftId,"workbook"));
        assertThrows(RuntimeException.class,
                () -> service.staffPreview(teacher,otherId,draftId,"workbook"));
        assertThrows(RuntimeException.class,
                () -> service.staffPreview(teacher,teacherId,draftId,"transcript"));
    }

    @Test
    void schoolSitePreviewReturnsInlinePdfWithoutPublicCapability() {
        var controller = new WorkbookDraftStaffPreviewController(service);
        var response = controller.preview(teacher,teacherId,draftId,"workbook");
        assertEquals("application/pdf",response.getHeaders().getContentType().toString());
        assertTrue(response.getHeaders().getContentDisposition().isInline());
        assertEquals("no-store",response.getHeaders().getCacheControl());
        assertArrayEquals(bytes,response.getBody());
    }

    @Test
    void signedLinkDownloadsExactBytesAndRechecksCurrentAuthorityAndLesson() {
        Map<String,Object> link=service.create(teacher,teacherId,draftId,"answers");
        assertEquals("2026-11-05T12:05:00Z",link.get("expiresAt"));
        assertEquals(bytes.length,link.get("sizeBytes"));
        clearInvocations(access,drafts,lessons);
        assertArrayEquals(bytes,service.download(token(link)).bytes());
        verify(access).requireCurrentActor(any());
        verify(access).requireTeacher(any(),eq(teacherId));
        verify(lessons).listGroupLessons(any());
        verify(drafts).previewFile(any(),eq(draftId),eq("answers"));
    }

    @Test
    void invalidSignatureAndExpiredLinksFailBeforeAnyDatabaseRead() {
        String valid=token(service.create(teacher,teacherId,draftId,"workbook"));
        clearInvocations(access,drafts,lessons);
        String[] parts=valid.split("\\.");
        String invalid=parts[0]+"."+(parts[1].startsWith("A")?"B":"A")+parts[1].substring(1);
        assertThrows(RuntimeException.class,()->service.download(invalid));
        var expired=new WorkbookDraftDownloadService(access,drafts,lessons,SECRET,"https://school.example",
                Clock.fixed(clock.instant().plusSeconds(301),ZoneOffset.UTC));
        assertThrows(RuntimeException.class,()->expired.download(valid));
        verifyNoInteractions(access,drafts,lessons);
    }

    @Test
    void wrongTeacherAndStudentRolesCannotIssueOrRedeemPdfCapabilities() throws Exception {
        assertThrows(RuntimeException.class,()->service.create(teacher,otherId,draftId,"workbook"));
        var student=new AuthenticatedUser(teacherId,"student@test.local",Role.STUDENT);
        assertThrows(RuntimeException.class,()->service.create(student,teacherId,draftId,"answers"));
        String valid=token(service.create(teacher,teacherId,draftId,"workbook"));
        String[] fields=new String(Base64.getUrlDecoder().decode(valid.split("\\.")[0]),StandardCharsets.UTF_8).split(":");
        clearInvocations(drafts,lessons);
        fields[3]=otherId.toString();
        assertThrows(RuntimeException.class,()->service.download(signed(fields)));
        fields[3]=teacherId.toString(); fields[2]="STUDENT";
        assertThrows(RuntimeException.class,()->service.download(signed(fields)));
        verifyNoInteractions(drafts,lessons);
    }

    @Test
    void revokedAuthorityAndRemovedLessonInvalidatePreviouslyIssuedLink() {
        String valid=token(service.create(teacher,teacherId,draftId,"answers"));
        clearInvocations(drafts);
        when(lessons.listGroupLessons(any())).thenReturn(List.of());
        assertThrows(RuntimeException.class,()->service.download(valid));
        verify(drafts,never()).previewFile(any(),any(),any());
        when(access.requireCurrentActor(any())).thenThrow(new AccessDeniedException("Account deactivated"));
        clearInvocations(drafts,lessons);
        assertThrows(RuntimeException.class,()->service.download(valid));
        verifyNoInteractions(drafts,lessons);
    }

    @Test
    void contentHashRejectsSubstitutedDraftBytes() {
        String valid=token(service.create(teacher,teacherId,draftId,"workbook"));
        when(drafts.previewFile(any(),eq(draftId),anyString())).thenReturn(
                new LessonPdfDraftService.PreviewFile("exact-lesson","approved.pdf","changed".getBytes(StandardCharsets.UTF_8)));
        assertThrows(RuntimeException.class,()->service.download(valid));
    }

    @Test
    void missingConfiguredSecretHasNoInsecureFallback() {
        var missing=new WorkbookDraftDownloadService(access,drafts,lessons,"","https://school.example",clock);
        assertThrows(IllegalStateException.class,()->missing.create(teacher,teacherId,draftId,"workbook"));
        verifyNoInteractions(access,drafts,lessons);
    }

    @Test
    void downloadResponseDisablesCachingAndProvidesPdfAttachment() {
        WorkbookDraftDownloadService mocked=mock(WorkbookDraftDownloadService.class);
        when(mocked.download("verified")).thenReturn(new LessonPdfDraftService.PreviewFile("exact-lesson","approved.pdf",bytes));
        var response=new WorkbookDraftDownloadController(mocked).download("verified");
        assertEquals("no-store",response.getHeaders().getCacheControl());
        assertEquals("application/pdf",response.getHeaders().getContentType().toString());
        assertTrue(response.getHeaders().getContentDisposition().isAttachment());
        assertArrayEquals(bytes,response.getBody());
    }

    private String token(Map<String,Object> link) { return String.valueOf(link.get("downloadUrl")).split("token=",2)[1]; }
    private String signed(String[] fields) throws Exception {
        String encoded=Base64.getUrlEncoder().withoutPadding().encodeToString(String.join(":",fields).getBytes(StandardCharsets.UTF_8));
        Mac mac=Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        return encoded+"."+Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(("mindcrafti-workbook-download\n"+encoded).getBytes(StandardCharsets.UTF_8)));
    }
}
