package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.GoogleCalendarLessonService;
import com.mcschool.flashcard.lessons.LessonPreparation;
import com.mcschool.flashcard.lessons.LessonPreparationRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.liveclasses.provider.ParticipantConnection;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

/** Real V97 schema, HTTP permissions and preservation of a teacher's unassigned lesson work. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {"app.online-classes.enabled=true", "app.online-classes.allow-test-classes=false"})
@Testcontainers(disabledWithoutDocker = true)
class UnassignedOnlineClassIntegrationTest {
    @Container private static final PostgreSQLContainer<?> DATABASE = new PostgreSQLContainer<>("postgres:16-alpine");
    @Autowired private OnlineClassRepository classes;
    @Autowired private UserRepository users;
    @Autowired private LessonPreparationRepository preparations;
    @Autowired private StudentGroupRepository groups;
    @Autowired private StudentGroupMemberRepository members;
    @Autowired private MockMvc mvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private ObjectMapper json;
    @MockitoBean private GoogleCalendarLessonService calendar;
    @MockitoBean private LiveClassMediaProvider media;
    private static final String EVENT = "local-unassigned-lesson";
    private static final String BINDING = "local-unassigned-lesson";
    private static final byte[] WORKBOOK = "%PDF-common-workbook".getBytes();
    private static final byte[] ANSWERS = "%PDF-teacher-answers".getBytes();
    private static final String INK = "{\"kind\":\"pen\",\"width\":0.004,\"points\":[[0.2,0.3],[0.3,0.4]]}";
    private User teacher, otherTeacher, pupil, peer;
    private Instant start, end;
    private AtomicReference<GroupLessonResponse> lesson;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry properties) {
        properties.add("spring.datasource.url", DATABASE::getJdbcUrl);
        properties.add("spring.datasource.username", DATABASE::getUsername);
        properties.add("spring.datasource.password", DATABASE::getPassword);
        properties.add("app.online-classes.idle-sweep-initial-ms", () -> "86400000");
    }

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        teacher = users.saveAndFlush(User.activeTeacher("Owner", "owner@unassigned.test", "unassigned-owner", "unused"));
        otherTeacher = users.saveAndFlush(User.activeTeacher("Other", "other@unassigned.test", "unassigned-other", "unused"));
        pupil = users.saveAndFlush(User.managedStudent("Pupil", teacher));
        peer = users.saveAndFlush(User.managedStudent("Peer", teacher));
        start = Instant.now().minusSeconds(300);
        end = start.plusSeconds(3600);
        lesson = new AtomicReference<>(lesson(null, null));
        when(calendar.listGroupLessons(any())).thenReturn(List.of());
        when(calendar.listGroupLessons(principal(teacher))).thenAnswer(invocation -> List.of(lesson.get()));
        when(media.isConfigured()).thenReturn(true);
        when(media.listParticipantIdentities(anyString())).thenReturn(List.of(ParticipantIdentity.of(teacher.getId(), "host-tab")));
        when(media.createConnection(anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> new ParticipantConnection("wss://test.invalid", "issued-token",
                        invocation.getArgument(1), invocation.getArgument(0), Instant.now().plusSeconds(600)));
    }

    private AuthenticatedUser principal(User user) {
        return new AuthenticatedUser(user.getId(), null, user.getRole());
    }

    private UsernamePasswordAuthenticationToken account(User user) {
        return account(principal(user));
    }

    private UsernamePasswordAuthenticationToken account(AuthenticatedUser user) {
        return UsernamePasswordAuthenticationToken.authenticated(user, "unused",
                List.of(new SimpleGrantedAuthority("ROLE_" + user.role().name())));
    }

    private GroupLessonResponse lesson(UUID groupId, UUID pupilId) {
        return new GroupLessonResponse(EVENT, BINDING, groupId, groupId == null ? null : "Group",
                pupilId, pupilId == null ? null : "Pupil", pupilId == null ? List.of() : List.of(pupilId),
                "Unassigned native lesson", start, end, null, null);
    }

    private UUID materialize() throws Exception {
        var response = mvc.perform(post("/api/v1/online-classes/calendar/" + EVENT).with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse();
        return UUID.fromString(json.readTree(response.getContentAsString()).path("id").asText());
    }

    private String roomPath(UUID id) { return "/api/v1/online-classes/" + id; }

    private void start(UUID id) throws Exception {
        mvc.perform(post(roomPath(id) + "/start").with(authentication(account(teacher)))).andExpect(status().isOk());
    }

    private void preparation() {
        LessonPreparation preparation = LessonPreparation.create(teacher, EVENT);
        preparation.attachWorkbook("tasks.pdf", WORKBOOK);
        preparation.attachAnswers("answers.pdf", ANSWERS);
        preparation.updateNotes("Homework", "Difficulties", "Teacher plan", "Teacher transcript");
        preparations.saveAndFlush(preparation);
    }

    private UUID page(UUID classId, int page) throws Exception {
        var response = mvc.perform(post(roomPath(classId) + "/annotations/documents")
                        .param("targetType", "WHITEBOARD").param("targetId", "board-1").param("pageIndex", Integer.toString(page))
                        .with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse();
        return UUID.fromString(json.readTree(response.getContentAsString()).path("id").asText());
    }

    private UUID draw(UUID classId, UUID pageId) throws Exception {
        UUID operationId = UUID.randomUUID();
        mvc.perform(post(roomPath(classId) + "/annotations/documents/" + pageId + "/operations")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(new AnnotationOperationRequest(operationId, AnnotationOperationType.ADD, INK)))
                        .with(authentication(account(teacher))))
                .andExpect(status().isOk());
        return operationId;
    }

    private void admit(UUID classId, User student) throws Exception {
        var knocked = mvc.perform(post(roomPath(classId) + "/join-requests").with(authentication(account(student))))
                .andExpect(status().isOk()).andReturn().getResponse();
        String requestId = json.readTree(knocked.getContentAsString()).path("id").asText();
        mvc.perform(post(roomPath(classId) + "/join-requests/" + requestId + "/approve")
                        .with(authentication(account(teacher))))
                .andExpect(status().isOk());
    }

    @Test
    void verifiedUnassignedLessonUsesOriginalEventMaterialsAndModernRoomWithoutTestFlag() throws Exception {
        preparation();
        UUID id = materialize();
        assertThat(materialize()).isEqualTo(id);
        var room = classes.findById(id).orElseThrow();
        assertThat(room.isTeacherOnly()).isTrue();
        assertThat(room.getEventId()).isEqualTo(EVENT);
        assertThat(room.getBindingKey()).isEqualTo(BINDING);
        assertThat(classes.count()).isEqualTo(1);
        start(id);
        mvc.perform(post(roomPath(id) + "/connection").with(authentication(account(teacher))))
                .andExpect(status().isOk());
        assertThat(mvc.perform(get(roomPath(id) + "/document").with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(WORKBOOK);
        assertThat(mvc.perform(get("/api/v1/lesson-preparations/" + EVENT + "/answers").with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(ANSWERS);
        mvc.perform(post("/api/v1/online-classes/test-class").with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
    }

    @Test
    void unassignedRoomAndItsDataAreDeniedToEveryNonOwnerIncludingOwnPupils() throws Exception {
        UUID id = materialize(); start(id);
        for (User outsider : List.of(pupil, peer, otherTeacher)) {
            mvc.perform(get(roomPath(id)).with(authentication(account(outsider)))).andExpect(status().isNotFound());
            mvc.perform(post(roomPath(id) + "/connection").with(authentication(account(outsider)))).andExpect(status().isNotFound());
            mvc.perform(post(roomPath(id) + "/join-requests").with(authentication(account(outsider)))).andExpect(status().isNotFound());
            mvc.perform(get(roomPath(id) + "/annotations/documents").with(authentication(account(outsider)))).andExpect(status().isNotFound());
            mvc.perform(get(roomPath(id) + "/document").with(authentication(account(outsider)))).andExpect(status().isNotFound());
        }
        mvc.perform(get(roomPath(id)).with(authentication(account(new AuthenticatedUser(pupil.getId(), null, Role.PARENT)))))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/online-classes/calendar/" + EVENT).with(authentication(account(pupil))))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/online-classes/calendar/" + EVENT).with(authentication(account(otherTeacher))))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/online-classes/calendar/local-unknown").with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
        assertThat(classes.count()).isEqualTo(1);
    }

    @Test
    void firstPupilAssignmentPromotesSameLiveRoomAndPreservesNotesPdfAnswersBlankPagesAndInk() throws Exception {
        preparation();
        UUID id = materialize(); start(id);
        UUID writtenPage = page(id, 0), blankPage = page(id, 2), operation = draw(id, writtenPage);
        lesson.set(lesson(null, pupil.getId()));
        assertThat(materialize()).isEqualTo(id);
        assertThat(materialize()).isEqualTo(id);
        assertThat(classes.count()).isEqualTo(1);
        var room = classes.findById(id).orElseThrow();
        assertThat(room.getStudent().getId()).isEqualTo(pupil.getId());
        assertThat(room.getStatus()).isEqualTo(OnlineClassStatus.LIVE);
        assertThat(room.getEventId()).isEqualTo(EVENT);
        var preparation = preparations.findByTeacherIdAndEventId(teacher.getId(), EVENT).orElseThrow();
        assertThat(preparation.getLessonPlan()).isEqualTo("Teacher plan");
        assertThat(preparation.getWorkbookPdf()).isEqualTo(WORKBOOK);
        assertThat(preparation.getAnswersPdf()).isEqualTo(ANSWERS);
        mvc.perform(get(roomPath(id) + "/annotations/documents").with(authentication(account(pupil))))
                .andExpect(status().isNotFound()); // Assignment alone does not admit the pupil.
        admit(id, pupil);
        var listed = json.readTree(mvc.perform(get(roomPath(id) + "/annotations/documents").with(authentication(account(pupil))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(listed.valueStream().map(item -> item.path("id").asText()).toList())
                .containsExactly(writtenPage.toString(), blankPage.toString());
        var replay = json.readTree(mvc.perform(get(roomPath(id) + "/annotations/documents/" + writtenPage + "/operations")
                        .with(authentication(account(pupil))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(replay.size()).isEqualTo(1);
        assertThat(replay.get(0).path("operationId").asText()).isEqualTo(operation.toString());
        assertThat(replay.get(0).path("payload").asText()).isEqualTo(INK);
        assertThat(mvc.perform(get(roomPath(id) + "/document").with(authentication(account(pupil))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).isEqualTo(WORKBOOK);
        mvc.perform(post(roomPath(id) + "/connection").with(authentication(account(pupil)))).andExpect(status().isOk());
        mvc.perform(get(roomPath(id)).with(authentication(account(peer)))).andExpect(status().isNotFound());
    }

    @Test
    void firstGroupAssignmentKeepsRoomAndAllowsOnlyAdmittedCurrentMembers() throws Exception {
        UUID id = materialize(); start(id);
        UUID writtenPage = page(id, 0), operation = draw(id, writtenPage);
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Group"));
        members.saveAndFlush(StudentGroupMember.create(group, pupil));
        lesson.set(lesson(group.getId(), null));
        assertThat(materialize()).isEqualTo(id);
        assertThat(classes.findById(id).orElseThrow().getGroup().getId()).isEqualTo(group.getId());
        admit(id, pupil);
        mvc.perform(post(roomPath(id) + "/connection").with(authentication(account(pupil)))).andExpect(status().isOk());
        var replay = json.readTree(mvc.perform(get(roomPath(id) + "/annotations/documents/" + writtenPage + "/operations")
                        .with(authentication(account(pupil))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(replay.get(0).path("operationId").asText()).isEqualTo(operation.toString());
        mvc.perform(post(roomPath(id) + "/join-requests").with(authentication(account(peer)))).andExpect(status().isNotFound());
    }

    @Test
    void replacingAnAlreadyAssignedAudienceStillRetiresTheOldRoom() throws Exception {
        UUID preview = materialize(); start(preview);
        UUID writtenPage = page(preview, 0); draw(preview, writtenPage);
        lesson.set(lesson(null, pupil.getId()));
        assertThat(materialize()).isEqualTo(preview);
        lesson.set(lesson(null, peer.getId()));
        UUID replacement = materialize();
        assertThat(replacement).isNotEqualTo(preview);
        assertThat(classes.count()).isEqualTo(2);
        assertThat(classes.findById(preview).orElseThrow().getStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(classes.findById(replacement).orElseThrow().getStudent().getId()).isEqualTo(peer.getId());
        mvc.perform(post(roomPath(replacement) + "/connection").with(authentication(account(pupil))))
                .andExpect(status().isNotFound());
        var preserved = json.readTree(mvc.perform(get(roomPath(preview) + "/annotations/documents/" + writtenPage + "/operations")
                        .with(authentication(account(teacher))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(preserved.size()).isEqualTo(1);
    }

    @Test
    void endingTeacherOnlyRoomCannotBeUndoneByAssigningAPupil() throws Exception {
        UUID id = materialize(); start(id);
        mvc.perform(post(roomPath(id) + "/end").with(authentication(account(teacher)))).andExpect(status().isOk());
        lesson.set(lesson(null, pupil.getId()));
        assertThat(materialize()).isEqualTo(id);
        var room = classes.findById(id).orElseThrow();
        assertThat(room.isTeacherOnly()).isTrue();
        assertThat(room.getStatus()).isEqualTo(OnlineClassStatus.ENDED);
        assertThat(classes.count()).isEqualTo(1);
        mvc.perform(post(roomPath(id) + "/start").with(authentication(account(teacher)))).andExpect(status().isConflict());
        mvc.perform(post(roomPath(id) + "/connection").with(authentication(account(pupil)))).andExpect(status().isNotFound());
    }

    @Test
    void migrationAllowsTeacherOnlyButRejectsBothAudienceColumns() throws Exception {
        UUID id = materialize();
        var group = groups.saveAndFlush(StudentGroup.create(teacher, "Group"));
        assertThat(jdbc.queryForObject("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1", String.class))
                .isEqualTo("97");
        assertThatThrownBy(() -> jdbc.update("UPDATE online_classes SET student_id=?, group_id=? WHERE id=?", pupil.getId(), group.getId(), id))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("online_classes_at_most_one_target");
        assertThat(classes.findById(id).orElseThrow().isTeacherOnly()).isTrue();
    }

    @Test
    void forgedForeignAudienceCannotPromoteAnOwnedTeacherOnlyRoom() throws Exception {
        UUID id = materialize();
        User foreignPupil = users.saveAndFlush(User.managedStudent("Foreign", otherTeacher));
        lesson.set(lesson(null, foreignPupil.getId()));
        mvc.perform(post("/api/v1/online-classes/calendar/" + EVENT).with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
        var foreignGroup = groups.saveAndFlush(StudentGroup.create(otherTeacher, "Foreign group"));
        lesson.set(lesson(foreignGroup.getId(), null));
        mvc.perform(post("/api/v1/online-classes/calendar/" + EVENT).with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
        assertThat(classes.findById(id).orElseThrow().isTeacherOnly()).isTrue();
        assertThat(classes.count()).isEqualTo(1);
    }

    @Test
    void firstPromotionRereadsTheVerifiedAudienceAfterAcquiringTheRoomLock() throws Exception {
        UUID id = materialize();
        when(calendar.listGroupLessons(principal(teacher))).thenReturn(
                List.of(lesson(null, pupil.getId())), List.of(lesson(null, peer.getId())));
        assertThat(materialize()).isEqualTo(id);
        assertThat(classes.findById(id).orElseThrow().getStudent().getId()).isEqualTo(peer.getId());
        mvc.perform(get(roomPath(id)).with(authentication(account(pupil)))).andExpect(status().isNotFound());
        mvc.perform(get(roomPath(id)).with(authentication(account(peer)))).andExpect(status().isOk());
    }

    @Test
    void lessonDisappearingFromTheOwnedScheduleDuringPromotionCannotExposeThePreparedRoom() throws Exception {
        UUID id = materialize();
        when(calendar.listGroupLessons(principal(teacher))).thenReturn(
                List.of(lesson(null, pupil.getId())), List.of());
        mvc.perform(post("/api/v1/online-classes/calendar/" + EVENT).with(authentication(account(teacher))))
                .andExpect(status().isNotFound());
        assertThat(classes.findById(id).orElseThrow().isTeacherOnly()).isTrue();
        mvc.perform(get(roomPath(id)).with(authentication(account(pupil)))).andExpect(status().isNotFound());
    }
}
