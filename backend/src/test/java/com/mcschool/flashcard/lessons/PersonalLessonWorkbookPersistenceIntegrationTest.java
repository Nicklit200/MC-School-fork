package com.mcschool.flashcard.lessons;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.lessons.dto.CreateLessonRequest;
import com.mcschool.flashcard.liveclasses.*;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.users.*;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/** Complete Flyway history, actual bytea persistence and optimistic locking in PostgreSQL. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.online-classes.enabled=true")
@EnabledIf("databaseAvailable")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PersonalLessonWorkbookPersistenceIntegrationTest {
    @Autowired private PersonalLessonWorkbookService service;
    @Autowired private PersonalLessonWorkbookRepository workbooks;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private UserRepository users;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private OnlineClassRepository classes;
    @Autowired private OnlineClassParticipantRepository participants;
    @Autowired private OnlineClassDocumentService documents;
    @Autowired private OnlineClassAnnotationService annotations;
    @Autowired private OnlineClassService onlineClasses;
    @Autowired private ManualLessonService manualLessons;
    @Autowired private LessonHistoryRepository history;
    @Autowired private StudentGroupRepository groups;
    @Autowired private StudentGroupMemberRepository groupMembers;
    @Autowired private CompletedLessonDocumentController completedDocuments;
    @Autowired private PlatformTransactionManager transactions;
    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @MockitoBean private GoogleCalendarLessonService lessons;
    private User teacher;
    private User student;
    private AuthenticatedUser caller;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        McpTestDatabase.properties(properties);
    }

    static boolean databaseAvailable() { return McpTestDatabase.available(); }

    @AfterAll
    static void stopDatabase() { McpTestDatabase.stop(); }

    @BeforeEach
    void setup() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher = User.activeTeacher("Nick", "nick@personal.test", "nick-personal", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        teacher = users.saveAndFlush(teacher);
        student = users.saveAndFlush(User.managedStudent("Student", teacher));
        caller = new AuthenticatedUser(teacher.getId(), null, Role.TEACHER);
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "event", "event", null, null, student.getId(), "Student", List.of(student.getId()),
                "Math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
    }

    private byte[] pdf(int pages) throws Exception {
        try (var document = new PDDocument(); var out = new ByteArrayOutputStream()) {
            for (int index = 0; index < pages; index++) document.addPage(new PDPage());
            document.save(out);
            return out.toByteArray();
        }
    }

    @Test
    void migrationPersistsPersonalBytesAndMetadataWithoutChangingSharedWorkbook() throws Exception {
        byte[] shared = pdf(1);
        byte[] personal = pdf(2);
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachWorkbook("shared.pdf", shared);
        preparations.saveAndFlush(preparation);
        long preparationVersion = preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getVersion();

        var uploaded = service.upload(caller, "event", student.getId(), "personal.pdf", personal);
        assertThat(uploaded.version()).isEqualTo(1L);
        assertThat(uploaded.workbookSizeBytes()).isEqualTo(personal.length);
        assertThat(uploaded.answersSizeBytes()).isZero();
        assertThat(workbooks.metadata(teacher.getId(), "event").get(0).getWorkbookSizeBytes()).isEqualTo(personal.length);
        assertThat(service.workbook(caller, "event", student.getId())).contains(personal);
        assertThat(service.list(caller, "event").students()).containsExactly(uploaded);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getWorkbookPdf()).isEqualTo(shared);
        assertThat(jdbc.queryForObject("select to_regclass('public.personal_lesson_workbooks')::text", String.class))
                .isEqualTo("personal_lesson_workbooks");

        assertThat(service.upload(caller, "event", student.getId(), "personal.pdf", personal).version()).isEqualTo(1L);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event").orElseThrow().getVersion())
                .isEqualTo(preparationVersion);
        assertThat(service.upload(caller, "event", student.getId(), "updated.pdf", pdf(3)).version()).isEqualTo(2L);
        assertThat(workbooks.count()).isEqualTo(1);
    }

    @Test
    void uniqueIdentityAndStaleEntityPreventConcurrentOverwrite() throws Exception {
        service.upload(caller, "event", student.getId(), "first.pdf", pdf(1));
        var first = workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()).orElseThrow();
        var stale = workbooks.findByTeacherIdAndEventIdAndStudentId(teacher.getId(), "event", student.getId()).orElseThrow();
        first.attach("new.pdf", pdf(2));
        workbooks.saveAndFlush(first);
        stale.attach("stale.pdf", pdf(3));
        assertThatThrownBy(() -> workbooks.saveAndFlush(stale)).isInstanceOf(ObjectOptimisticLockingFailureException.class);
        var duplicate = PersonalLessonWorkbook.create(teacher.getId(), "event", student.getId());
        duplicate.attach("duplicate.pdf", pdf(1));
        assertThatThrownBy(() -> workbooks.saveAndFlush(duplicate)).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(workbooks.metadata(teacher.getId(), "event")).hasSize(1);
        assertThat(workbooks.workbookVersion(teacher.getId(), "event", student.getId())).contains(1L);
    }

    @Test
    void actualAdmissionAndCurrentOwnershipProtectPersonalDocumentAndVersion() throws Exception {
        byte[] personal = pdf(2);
        service.upload(caller, "event", student.getId(), "personal.pdf", personal);
        var room = classes.saveAndFlush(OnlineClass.forStudent(teacher, "event", "event", "Math",
                Instant.now(), Instant.now().plusSeconds(3600), student));
        var studentCaller = new AuthenticatedUser(student.getId(), null, Role.STUDENT);
        String board = "personal-workbook-" + student.getId();
        assertThatThrownBy(() -> documents.workbook(studentCaller, room.getId(), board))
                .isInstanceOf(ResourceNotFoundException.class);
        var participant = OnlineClassParticipant.student(room, student);
        participant.admit();
        participants.saveAndFlush(participant);
        assertThat(documents.workbook(studentCaller, room.getId(), board)).contains(personal);
        assertThat(documents.workbookVersion(studentCaller, room.getId(), board)).isEqualTo(1L);
        assertThat(documents.workbook(caller, room.getId(), board)).contains(personal);

        User other = users.saveAndFlush(User.managedStudent("Other", teacher));
        var otherCaller = new AuthenticatedUser(other.getId(), null, Role.STUDENT);
        assertThatThrownBy(() -> documents.workbook(otherCaller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> documents.workbookVersion(otherCaller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);

        jdbc.update("update users set archived=true where id=?", student.getId());
        assertThatThrownBy(() -> documents.workbook(caller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> documents.workbookVersion(caller, room.getId(), board)).isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void blankWorksheetPageIsDiscoverableBeforeInkAndReplayStaysPrivateAcrossRosterRemoval() throws Exception {
        var peer = users.saveAndFlush(User.managedStudent("Peer", teacher));
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Page sync"));
        var membership = groupMembers.saveAndFlush(StudentGroupMember.create(group, student));
        groupMembers.saveAndFlush(StudentGroupMember.create(group, peer));
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "event", "event", group.getId(), "Page sync", null, null, List.of(student.getId(), peer.getId()),
                "Math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
        service.upload(caller, "event", student.getId(), "worksheet.pdf", pdf(1));
        var room = classes.saveAndFlush(OnlineClass.forGroup(teacher, "event", "event", "Math",
                Instant.now(), Instant.now().plusSeconds(3600), group));
        for (User pupil : List.of(student, peer)) {
            var admitted = OnlineClassParticipant.student(room, pupil);
            admitted.admit();
            participants.saveAndFlush(admitted);
        }
        var hostAccount = account(teacher.getId(), Role.TEACHER);
        var ownerAccount = account(student.getId(), Role.STUDENT);
        var peerAccount = account(peer.getId(), Role.STUDENT);
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        String pages = "/api/v1/online-classes/" + room.getId() + "/annotations/documents";

        // Opening the appended blank page persists its identity before any stroke exists.
        var opened = mvc.perform(post(pages).param("targetType", "WHITEBOARD").param("targetId", board)
                        .param("pageIndex", "1").with(authentication(hostAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(0))
                .andReturn().getResponse().getContentAsString();
        String documentId = json.readTree(opened).path("id").asString("");
        assertThat(documentId).isNotBlank();
        mvc.perform(get(pages).with(authentication(ownerAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(documentId)).andExpect(jsonPath("$[0].targetId").value(board))
                .andExpect(jsonPath("$[0].pageIndex").value(1)).andExpect(jsonPath("$[0].revision").value(0));
        mvc.perform(post(pages).param("targetType", "WHITEBOARD").param("targetId", board)
                        .param("pageIndex", "1").with(authentication(ownerAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(documentId));

        UUID operationId = UUID.randomUUID();
        String ink = """
                {"kind":"pen","color":"#123456","width":0.004,"points":[[0.2,0.3],[0.4,0.5]]}
                """;
        String operations = pages + "/" + documentId + "/operations";
        mvc.perform(post(operations).with(authentication(hostAccount)).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AnnotationOperationRequest(operationId, AnnotationOperationType.ADD, ink))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.sequence").value(1));
        mvc.perform(get(operations).with(authentication(ownerAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].operationId").value(operationId.toString()))
                .andExpect(jsonPath("$[0].sequence").value(1))
                .andExpect(jsonPath("$[0].actorId").value(teacher.getId().toString()))
                .andExpect(jsonPath("$[0].layerOwnerId").value(teacher.getId().toString()))
                .andExpect(jsonPath("$[0].payload").value(ink));
        mvc.perform(get(pages).with(authentication(peerAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get(operations).with(authentication(peerAccount))).andExpect(status().isNotFound());

        // A later request must recheck current membership even for the host.
        groupMembers.deleteById(membership.getId());
        groupMembers.flush();
        mvc.perform(get(pages).with(authentication(hostAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get(operations).with(authentication(hostAccount))).andExpect(status().isNotFound());
        mvc.perform(get(operations).with(authentication(ownerAccount))).andExpect(status().isNotFound());
    }

    @Test
    void unifiedMyBoardKeepsLegacyOrdinaryAndWorksheetBytesPagesAndInkSeparate() throws Exception {
        byte[] commonPdf = pdf(1);
        byte[] privatePdf = pdf(2);
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachWorkbook("common-a.pdf", commonPdf);
        preparations.saveAndFlush(preparation);
        var peer = users.saveAndFlush(User.managedStudent("Peer", teacher));
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Legacy boards"));
        groupMembers.saveAndFlush(StudentGroupMember.create(group, student));
        groupMembers.saveAndFlush(StudentGroupMember.create(group, peer));
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "event", "event", group.getId(), "Legacy boards", null, null, List.of(student.getId(), peer.getId()),
                "Math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
        var room = classes.saveAndFlush(OnlineClass.forGroup(teacher, "event", "event", "Math",
                Instant.now(), Instant.now().plusSeconds(3600), group));
        for (User pupil : List.of(student, peer)) {
            var admitted = OnlineClassParticipant.student(room, pupil);
            admitted.admit();
            participants.saveAndFlush(admitted);
        }
        var hostAccount = account(teacher.getId(), Role.TEACHER);
        var ownerAccount = account(student.getId(), Role.STUDENT);
        var peerAccount = account(peer.getId(), Role.STUDENT);
        String ordinaryTarget = PersonalBoard.targetIdFor(student.getId());
        String worksheetTarget = PersonalBoard.workbookTargetIdFor(student.getId());
        String base = "/api/v1/online-classes/" + room.getId();
        String pages = base + "/annotations/documents";

        // These notes predate the personal PDF assignment and must stay on A.
        String ordinaryPage = mvc.perform(post(pages).param("targetType", "WHITEBOARD").param("targetId", ordinaryTarget)
                        .param("pageIndex", "0").with(authentication(ownerAccount)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String ordinaryId = json.readTree(ordinaryPage).path("id").asString("");
        UUID ordinaryOperation = UUID.randomUUID();
        String ordinaryInk = """
                {"kind":"pen","color":"#aa0000","width":0.004,"points":[[0.1,0.2],[0.3,0.4]]}
                """;
        String ordinaryReplay = pages + "/" + ordinaryId + "/operations";
        mvc.perform(post(ordinaryReplay).with(authentication(ownerAccount)).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AnnotationOperationRequest(ordinaryOperation, AnnotationOperationType.ADD, ordinaryInk))))
                .andExpect(status().isOk());

        service.upload(caller, "event", student.getId(), "private-b.pdf", privatePdf);
        String worksheetPage = mvc.perform(post(pages).param("targetType", "WHITEBOARD").param("targetId", worksheetTarget)
                        .param("pageIndex", "2").with(authentication(hostAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(0))
                .andReturn().getResponse().getContentAsString();
        String worksheetId = json.readTree(worksheetPage).path("id").asString("");
        assertThat(ordinaryId).isNotBlank().isNotEqualTo(worksheetId);
        assertThat(worksheetId).isNotBlank();
        UUID worksheetOperation = UUID.randomUUID();
        String worksheetInk = """
                {"kind":"pen","color":"#0000bb","width":0.006,"points":[[0.6,0.7],[0.8,0.9]]}
                """;
        String worksheetReplay = pages + "/" + worksheetId + "/operations";
        mvc.perform(post(worksheetReplay).with(authentication(hostAccount)).contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AnnotationOperationRequest(worksheetOperation, AnnotationOperationType.ADD, worksheetInk))))
                .andExpect(status().isOk());

        for (var viewer : List.of(ownerAccount, hostAccount)) {
            mvc.perform(get(pages).with(authentication(viewer)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                    .andExpect(jsonPath("$[0].id").value(ordinaryId)).andExpect(jsonPath("$[0].targetId").value(ordinaryTarget))
                    .andExpect(jsonPath("$[0].pageIndex").value(0))
                    .andExpect(jsonPath("$[1].id").value(worksheetId)).andExpect(jsonPath("$[1].targetId").value(worksheetTarget))
                    .andExpect(jsonPath("$[1].pageIndex").value(2));
            mvc.perform(get(ordinaryReplay).with(authentication(viewer)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                    .andExpect(jsonPath("$[0].operationId").value(ordinaryOperation.toString()))
                    .andExpect(jsonPath("$[0].payload").value(ordinaryInk));
            mvc.perform(get(worksheetReplay).with(authentication(viewer)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                    .andExpect(jsonPath("$[0].operationId").value(worksheetOperation.toString()))
                    .andExpect(jsonPath("$[0].payload").value(worksheetInk));
            mvc.perform(get(base + "/document").param("boardId", ordinaryTarget).with(authentication(viewer)))
                    .andExpect(status().isOk()).andExpect(content().bytes(commonPdf));
            mvc.perform(get(base + "/document").param("boardId", worksheetTarget).with(authentication(viewer)))
                    .andExpect(status().isOk()).andExpect(content().bytes(privatePdf));
        }
        mvc.perform(get(pages).with(authentication(peerAccount)))
                .andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        for (String target : List.of(ordinaryTarget, worksheetTarget)) {
            mvc.perform(get(base + "/document").param("boardId", target).with(authentication(peerAccount)))
                    .andExpect(status().isNotFound());
        }
        for (String replay : List.of(ordinaryReplay, worksheetReplay)) {
            mvc.perform(get(replay).with(authentication(peerAccount))).andExpect(status().isNotFound());
        }
        // The private override never replaces the shared source for other pupils.
        mvc.perform(get(base + "/document").with(authentication(peerAccount)))
                .andExpect(status().isOk()).andExpect(content().bytes(commonPdf));
    }

    @Test
    @WithMockUser(roles = "TEACHER")
    void detachedGroupClassCanValidateMembershipAndSaveCompletedWorksheetWithoutOpenSession() throws Exception {
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Group"));
        groupMembers.saveAndFlush(StudentGroupMember.create(group, student));
        var room = classes.saveAndFlush(OnlineClass.forGroup(teacher, "group-event", "group-event", "Group math",
                Instant.now(), Instant.now().plusSeconds(3600), group));
        // Repository transactions have ended: group membership and student entities
        // must be loaded inside the guard's own transaction (open-in-view is false).
        var detachedRoom = classes.findById(room.getId()).orElseThrow();
        assertThatCode(() -> service.requireClassStudent(detachedRoom, student.getId())).doesNotThrowAnyException();

        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "group-event", "group-event", group.getId(), "Group", null, null, List.of(student.getId()),
                "Group math", Instant.now(), Instant.now().plusSeconds(3600), null, null)));
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "group-event")).isEmpty();
        service.upload(caller, "group-event", student.getId(), "personal-only.pdf", pdf(1));
        var emptyPreparation = preparations.findByTeacherIdAndEventId(teacher.getId(), "group-event").orElseThrow();
        assertThat(emptyPreparation.hasWorkbook()).isFalse();
        assertThat(emptyPreparation.hasAnswers()).isFalse();
        byte[] finished = pdf(2);
        String board = PersonalBoard.workbookTargetIdFor(student.getId());
        var saved = completedDocuments.save(caller, "group-event", room.getId(), board,
                new MockMultipartFile("file", "completed.pdf", "application/pdf", finished));
        assertThat(saved.boardId()).isEqualTo(board);
        assertThat(saved.classId()).isEqualTo(room.getId());
        assertThat(completedDocuments.download(caller, "group-event", saved.id()).getBody()).isEqualTo(finished);
    }

    @Test
    void freshScalarTargetGuardRejectsArchivedAndTransferredStudentDespiteCachedIdentity() throws Exception {
        User otherTeacher = users.saveAndFlush(User.activeTeacher("Other", "other@personal.test", "other-personal", "unused"));
        byte[] bytes = pdf(1);
        new TransactionTemplate(transactions).executeWithoutResult(status -> {
            User cached = users.findById(student.getId()).orElseThrow();
            assertThat(cached.isArchived()).isFalse();
            assertThat(cached.getTeacher().getId()).isEqualTo(teacher.getId());
            jdbc.update("update users set archived=true where id=?", student.getId());
            assertThat(cached.isArchived()).isFalse();
            assertThat(service.list(caller, "event").students()).isEmpty();

            jdbc.update("update users set archived=false, teacher_id=? where id=?", otherTeacher.getId(), student.getId());
            assertThat(cached.getTeacher().getId()).isEqualTo(teacher.getId());
            assertThat(service.list(caller, "event").students()).isEmpty();
            assertThatThrownBy(() -> service.upload(caller, "event", student.getId(), "forbidden.pdf", bytes))
                    .isInstanceOf(ResourceNotFoundException.class);
            assertThat(workbooks.count()).isZero();
            status.setRollbackOnly();
        });
    }

    @RepeatedTest(5)
    void firstAssignmentsForThreePupilsCanBeUploadedConcurrently() throws Exception {
        var fixture = groupOfThree();
        var uploads = new ArrayList<Callable<PersonalLessonWorkbookService.PersonalWorkbookResponse>>();
        for (int index = 0; index < fixture.pupils().size(); index++) {
            User pupil = fixture.pupils().get(index);
            byte[] bytes = pdf(index + 2);
            uploads.add(() -> service.upload(caller, "event", pupil.getId(), "worksheet.pdf", bytes));
        }
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event")).isEmpty();
        assertThat(concurrently(uploads)).allSatisfy(upload -> assertThat(upload.version()).isEqualTo(1));
        assertThat(service.list(caller, "event").students()).hasSize(3).allSatisfy(row -> {
            assertThat(row.hasWorkbook()).isTrue();
            assertThat(row.version()).isEqualTo(1);
        });
        assertThat(workbooks.count()).isEqualTo(3);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), "event")).isPresent();
    }

    @Test
    void threePrivateWorksheetsAndConcurrentInkSurviveReconnectAndOnePupilReplacement() throws Exception {
        var fixture = groupOfThree();
        byte[] shared = pdf(1);
        var preparation = LessonPreparation.create(teacher, "event");
        preparation.attachWorkbook("shared.pdf", shared);
        preparations.saveAndFlush(preparation);
        var room = OnlineClass.forGroup(teacher, "event", "event", "Private assignment test",
                Instant.now().minusSeconds(60), Instant.now().plusSeconds(3600), fixture.group());
        room.start(Instant.now());
        room = classes.saveAndFlush(room);
        UUID roomId = room.getId();
        var bytesByPupil = new java.util.HashMap<UUID, byte[]>();
        var documentByPupil = new java.util.HashMap<UUID, UUID>();
        for (int index = 0; index < fixture.pupils().size(); index++) {
            User pupil = fixture.pupils().get(index);
            byte[] bytes = pdf(index + 2);
            bytesByPupil.put(pupil.getId(), bytes);
            service.upload(caller, "event", pupil.getId(), "worksheet.pdf", bytes);
            var admitted = OnlineClassParticipant.student(room, pupil);
            admitted.admit();
            participants.saveAndFlush(admitted);
            var owner = new AuthenticatedUser(pupil.getId(), null, Role.STUDENT);
            String target = PersonalBoard.workbookTargetIdFor(pupil.getId());
            assertThat(documents.workbook(owner, roomId, target)).contains(bytes);
            assertThat(documents.workbook(caller, roomId, target)).contains(bytes);
            assertThat(documents.workbookVersion(owner, roomId, target)).isEqualTo(1);
            documentByPupil.put(pupil.getId(), annotations.openDocument(owner, roomId,
                    AnnotationTargetType.WHITEBOARD, target, 0, null, null).id());
        }
        var writes = new ArrayList<Callable<Void>>();
        for (User pupil : fixture.pupils()) {
            var owner = new AuthenticatedUser(pupil.getId(), null, Role.STUDENT);
            UUID documentId = documentByPupil.get(pupil.getId());
            writes.add(() -> {
                for (int index = 0; index < 8; index++) {
                    var operation = new AnnotationOperationRequest(UUID.randomUUID(), AnnotationOperationType.ADD,
                            "{\"kind\":\"pen\",\"color\":\"#123456\",\"width\":0.004,\"points\":[[0.1,0.2],[0.3,0.4]]}");
                    var saved = annotations.append(owner, roomId, documentId, operation);
                    assertThat(saved.sequence()).isEqualTo(index + 1);
                    // A retry after a connection interruption is the same operation.
                    assertThat(annotations.append(owner, roomId, documentId, operation).sequence()).isEqualTo(saved.sequence());
                }
                return null;
            });
        }
        concurrently(writes);
        for (User pupil : fixture.pupils()) {
            var reconnected = new AuthenticatedUser(pupil.getId(), null, Role.STUDENT);
            UUID documentId = documentByPupil.get(pupil.getId());
            assertThat(annotations.replay(reconnected, roomId, documentId, 0)).hasSize(8)
                    .allSatisfy(operation -> assertThat(operation.actorId()).isEqualTo(pupil.getId()));
            assertThat(annotations.replay(reconnected, roomId, documentId, 5)).extracting(item -> item.sequence())
                    .containsExactly(6L, 7L, 8L);
            assertThat(annotations.listDocuments(reconnected, roomId)).extracting(item -> item.id())
                    .containsExactly(documentId);
            assertThat(annotations.replay(caller, roomId, documentId, 0)).hasSize(8);
            for (User peer : fixture.pupils()) {
                if (peer.getId().equals(pupil.getId())) continue;
                String otherTarget = PersonalBoard.workbookTargetIdFor(peer.getId());
                assertThatThrownBy(() -> documents.workbook(reconnected, roomId, otherTarget))
                        .isInstanceOf(ResourceNotFoundException.class);
                assertThatThrownBy(() -> annotations.replay(reconnected, roomId, documentByPupil.get(peer.getId()), 0))
                        .isInstanceOf(ResourceNotFoundException.class);
                assertThatThrownBy(() -> annotations.openDocument(reconnected, roomId,
                        AnnotationTargetType.WHITEBOARD, otherTarget, 0, null, null))
                        .isInstanceOf(ResourceNotFoundException.class);
                assertThatThrownBy(() -> annotations.append(reconnected, roomId, documentByPupil.get(peer.getId()),
                        new AnnotationOperationRequest(UUID.randomUUID(), AnnotationOperationType.ADD,
                                "{\"kind\":\"pen\",\"width\":0.004,\"points\":[[0.1,0.2]]}")))
                        .isInstanceOf(ResourceNotFoundException.class);
            }
        }
        User replaced = fixture.pupils().get(1);
        byte[] replacement = pdf(5);
        assertThat(service.upload(caller, "event", replaced.getId(), "worksheet.pdf", replacement).version()).isEqualTo(2);
        for (User pupil : fixture.pupils()) {
            String target = PersonalBoard.workbookTargetIdFor(pupil.getId());
            boolean changed = pupil.getId().equals(replaced.getId());
            assertThat(documents.workbook(caller, roomId, target))
                    .contains(changed ? replacement : bytesByPupil.get(pupil.getId()));
            assertThat(documents.workbookVersion(caller, roomId, target)).isEqualTo(changed ? 2 : 1);
            assertThat(annotations.replay(caller, roomId, documentByPupil.get(pupil.getId()), 0)).hasSize(8);
        }
        assertThat(annotations.listDocuments(caller, roomId)).hasSize(3);
        assertThat(documents.workbook(caller, roomId)).contains(shared);
    }

    @Test
    void oneOffGroupRebindChangesOnlyOneLessonAndArchivesTheOldLiveRoomWithoutLosingFilesOrInk() throws Exception {
        var fixture = groupOfThree();
        var regular = groups.saveAndFlush(StudentGroup.create(teacher, "Regular two-pupil group"));
        for (User pupil : fixture.pupils().subList(0, 2)) {
            groupMembers.saveAndFlush(StudentGroupMember.create(regular, pupil));
        }
        Instant start = Instant.now().plusSeconds(4 * 86400L);
        var first = manualLessons.create(caller, new CreateLessonRequest("One-off session", start,
                start.plusSeconds(3600), regular.getId(), null));
        var future = manualLessons.create(caller, new CreateLessonRequest("Next regular session", start.plusSeconds(7 * 86400L),
                start.plusSeconds(7 * 86400L + 3600), regular.getId(), null));
        when(lessons.listGroupLessons(caller)).thenAnswer(ignored -> history
                .findAllByTeacherIdAndDeletedAtIsNullOrderByStartsAtAsc(teacher.getId()).stream()
                .map(LessonHistoryEntry::toResponse).toList());
        byte[] shared = pdf(1), privatePdf = pdf(2);
        var preparation = LessonPreparation.create(teacher, first.eventId());
        preparation.attachWorkbook("shared.pdf", shared);
        preparations.saveAndFlush(preparation);
        service.upload(caller, first.eventId(), student.getId(), "worksheet.pdf", privatePdf);
        UUID oldClassId = onlineClasses.materializeFromCalendar(caller, first.eventId()).id();
        var oldRoom = classes.findById(oldClassId).orElseThrow();
        oldRoom.start(Instant.now());
        classes.saveAndFlush(oldRoom);
        var admitted = OnlineClassParticipant.student(oldRoom, student);
        admitted.admit();
        participants.saveAndFlush(admitted);
        var owner = new AuthenticatedUser(student.getId(), null, Role.STUDENT);
        User guest = fixture.pupils().get(2);
        var guestCaller = new AuthenticatedUser(guest.getId(), null, Role.STUDENT);
        String target = PersonalBoard.workbookTargetIdFor(student.getId());
        UUID oldDocument = annotations.openDocument(owner, oldClassId, AnnotationTargetType.WHITEBOARD,
                target, 0, null, null).id();
        UUID savedOperation = UUID.randomUUID();
        annotations.append(owner, oldClassId, oldDocument,
                new AnnotationOperationRequest(savedOperation, AnnotationOperationType.ADD,
                        "{\"kind\":\"pen\",\"width\":0.004,\"points\":[[0.1,0.2],[0.3,0.4]]}"));
        assertThatThrownBy(() -> documents.workbook(guestCaller, oldClassId, target))
                .isInstanceOf(ResourceNotFoundException.class);

        // Rebind one dated native event, leaving the permanent group's two members unchanged.
        manualLessons.bindGroup(caller, first.eventId(), fixture.group().getId());
        assertThat(classes.findById(oldClassId).orElseThrow().getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        var rebound = history.findByTeacherIdAndEventId(teacher.getId(), first.eventId()).orElseThrow().toResponse();
        assertThat(rebound.eventId()).isEqualTo(first.eventId());
        assertThat(rebound.groupId()).isEqualTo(fixture.group().getId());
        assertThat(rebound.participantStudentIds()).containsExactlyInAnyOrderElementsOf(fixture.pupils().stream().map(User::getId).toList());
        var next = history.findByTeacherIdAndEventId(teacher.getId(), future.eventId()).orElseThrow().toResponse();
        assertThat(next.groupId()).isEqualTo(regular.getId());
        assertThat(next.participantStudentIds()).containsExactlyInAnyOrder(student.getId(), fixture.pupils().get(1).getId());
        assertThat(groupMembers.findAllByGroupIdOrderByCreatedAtAsc(regular.getId())).hasSize(2);
        assertThat(service.list(caller, first.eventId()).students()).hasSize(3);
        assertThat(service.list(caller, future.eventId()).students()).hasSize(2);

        // Materializing the explicitly changed audience retires the old session and creates a new room.
        var replacement = onlineClasses.materializeFromCalendar(caller, first.eventId());
        assertThat(replacement.id()).isNotEqualTo(oldClassId);
        assertThat(replacement.status()).isEqualTo(OnlineClassStatus.SCHEDULED);
        assertThat(classes.findById(oldClassId).orElseThrow().getStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(classes.findById(replacement.id()).orElseThrow().getGroup().getId()).isEqualTo(fixture.group().getId());
        assertThat(annotations.replay(caller, oldClassId, oldDocument, 0)).extracting(item -> item.operationId()).containsExactly(savedOperation);
        assertThat(annotations.listDocuments(caller, replacement.id())).isEmpty();
        assertThat(documents.workbook(caller, replacement.id(), target)).contains(privatePdf);
        assertThat(documents.workbook(caller, replacement.id())).contains(shared);
        assertThat(preparations.findByTeacherIdAndEventId(teacher.getId(), first.eventId()).orElseThrow().getWorkbookPdf()).isEqualTo(shared);
        assertThatThrownBy(() -> annotations.replay(guestCaller, oldClassId, oldDocument, 0))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(onlineClasses.materializeFromCalendar(caller, first.eventId()).id()).isEqualTo(replacement.id());
    }

    private record ThreePupils(StudentGroup group, List<User> pupils) {}

    private ThreePupils groupOfThree() {
        var pupils = List.of(student,
                users.saveAndFlush(User.managedStudent("Pupil B", teacher)),
                users.saveAndFlush(User.managedStudent("Pupil C", teacher)));
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Three private assignments"));
        for (User pupil : pupils) groupMembers.saveAndFlush(StudentGroupMember.create(group, pupil));
        when(lessons.listGroupLessons(caller)).thenReturn(List.of(new GroupLessonResponse(
                "event", "event", group.getId(), "Three private assignments", null, null,
                pupils.stream().map(User::getId).toList(), "Math", Instant.now(),
                Instant.now().plusSeconds(3600), null, null)));
        return new ThreePupils(group, pupils);
    }

    private <T> List<T> concurrently(List<Callable<T>> actions) throws Exception {
        var pool = Executors.newFixedThreadPool(actions.size());
        var ready = new CountDownLatch(actions.size());
        var start = new CountDownLatch(1);
        try {
            var futures = actions.stream().map(action -> pool.submit(() -> {
                ready.countDown();
                if (!start.await(20, TimeUnit.SECONDS)) throw new IllegalStateException("Concurrent test start timed out");
                return action.call();
            })).toList();
            assertThat(ready.await(20, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            var results = new ArrayList<T>();
            for (var future : futures) results.add(future.get(30, TimeUnit.SECONDS));
            return results;
        } finally {
            start.countDown();
            pool.shutdownNow();
        }
    }

    private UsernamePasswordAuthenticationToken account(UUID userId, Role role) {
        return UsernamePasswordAuthenticationToken.authenticated(new AuthenticatedUser(userId, null, role), null,
                List.of(new SimpleGrantedAuthority("ROLE_" + role.name())));
    }
}
