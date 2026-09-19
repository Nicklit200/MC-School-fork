package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.AbstractIntegrationTest;
import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.liveclasses.dto.ClassParticipantResponse;
import com.mcschool.flashcard.liveclasses.dto.JoinRequestResponse;
import com.mcschool.flashcard.liveclasses.dto.ParticipantPermissionRequest;
import com.mcschool.flashcard.liveclasses.provider.LiveClassMediaProvider;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** Waiting-room admission and teacher moderation. */
@TestPropertySource(properties = {
        "app.online-classes.enabled=true",
        "app.online-classes.livekit-url=wss://test.invalid",
        "app.online-classes.livekit-api-key=test-key",
        "app.online-classes.livekit-api-secret=test-secret"
})
class OnlineClassAdmissionIntegrationTest extends AbstractIntegrationTest {

    private static final Instant START = Instant.now().minus(5, ChronoUnit.MINUTES);
    private static final Instant END = START.plus(1, ChronoUnit.HOURS);

    @Autowired
    private OnlineClassAdmissionService admissionService;

    @Autowired
    private OnlineClassHostControlService hostControlService;

    @Autowired
    private OnlineClassRepository classRepository;

    @Autowired
    private OnlineClassParticipantRepository participantRepository;

    @Autowired
    private OnlineClassJoinRequestRepository joinRequestRepository;

    @Autowired
    private UserRepository userRepository;

    @MockitoBean
    private LiveClassMediaProvider mediaProvider;

    private User teacher;
    private User student;
    private User otherStudent;
    private AuthenticatedUser teacherPrincipal;
    private AuthenticatedUser studentPrincipal;
    private OnlineClass onlineClass;

    @BeforeEach
    void seed() {
        teacher = userRepository.save(User.invitedTeacher("Teacher", "teacher@test.local",
                "t1", END));
        student = userRepository.save(User.invitedStudent("Student", "student@test.local", teacher,
                "s1", END));
        otherStudent = userRepository.save(User.invitedStudent("Outsider", "outsider@test.local",
                teacher, "s2", END));
        teacherPrincipal = new AuthenticatedUser(teacher.getId(), teacher.getEmail(), teacher.getRole());
        studentPrincipal = new AuthenticatedUser(student.getId(), student.getEmail(), student.getRole());

        OnlineClass created = OnlineClass.forStudent(teacher, "event-1", "binding-1",
                "Maths", START, END, student);
        created.start(START);
        onlineClass = classRepository.save(created);

        when(mediaProvider.isConfigured()).thenReturn(true);
        when(mediaProvider.listParticipantIdentities(anyString()))
                .thenReturn(List.of(ParticipantIdentity.of(student.getId(), "tab-1")));
    }

    // --- Waiting room --------------------------------------------------------

    @Test
    void knockingTwiceKeepsTheSamePendingRequest() {
        JoinRequestResponse first = admissionService.knock(studentPrincipal, onlineClass.getId());
        JoinRequestResponse second = admissionService.knock(studentPrincipal, onlineClass.getId());

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(second.state()).isEqualTo(JoinRequestState.PENDING);
        assertThat(joinRequestRepository.count()).isEqualTo(1);
    }

    @Test
    void knockingIsAutoApprovedWhenTheWaitingRoomIsOff() {
        onlineClass.setWaitingRoomEnabled(false);
        classRepository.save(onlineClass);

        JoinRequestResponse request = admissionService.knock(studentPrincipal, onlineClass.getId());

        assertThat(request.state()).isEqualTo(JoinRequestState.APPROVED);
        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId())
                .orElseThrow().isAdmitted()).isTrue();
    }

    @Test
    void approvingAdmitsTheParticipant() {
        JoinRequestResponse request = admissionService.knock(studentPrincipal, onlineClass.getId());

        JoinRequestResponse decided =
                admissionService.approve(teacherPrincipal, onlineClass.getId(), request.id());

        assertThat(decided.state()).isEqualTo(JoinRequestState.APPROVED);
        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId())
                .orElseThrow().isAdmitted()).isTrue();
    }

    @Test
    void rejectingBlocksTheParticipant() {
        JoinRequestResponse request = admissionService.knock(studentPrincipal, onlineClass.getId());

        admissionService.reject(teacherPrincipal, onlineClass.getId(), request.id());

        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId())
                .orElseThrow().getAdmissionState()).isEqualTo(AdmissionState.REJECTED);
    }

    @Test
    void aDecisionCannotBeFlippedByADuplicateClick() {
        JoinRequestResponse request = admissionService.knock(studentPrincipal, onlineClass.getId());
        admissionService.reject(teacherPrincipal, onlineClass.getId(), request.id());

        // A late "approve" must not overturn the rejection.
        assertThatThrownBy(() ->
                admissionService.approve(teacherPrincipal, onlineClass.getId(), request.id()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("already been decided");
    }

    @Test
    void onlyTheHostSeesOrDecidesJoinRequests() {
        JoinRequestResponse request = admissionService.knock(studentPrincipal, onlineClass.getId());

        assertThatThrownBy(() -> admissionService.listPending(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() ->
                admissionService.approve(studentPrincipal, onlineClass.getId(), request.id()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void approveAllAdmitsEveryoneWaiting() {
        admissionService.knock(studentPrincipal, onlineClass.getId());

        List<JoinRequestResponse> decided =
                admissionService.approveAll(teacherPrincipal, onlineClass.getId());

        assertThat(decided).hasSize(1);
        assertThat(admissionService.listPending(teacherPrincipal, onlineClass.getId())).isEmpty();
    }

    @Test
    void anUnrelatedStudentCannotKnock() {
        AuthenticatedUser outsider = new AuthenticatedUser(
                otherStudent.getId(), otherStudent.getEmail(), otherStudent.getRole());

        assertThatThrownBy(() -> admissionService.knock(outsider, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void aRemovedStudentCannotKnockAgain() {
        admissionService.knock(studentPrincipal, onlineClass.getId());
        hostControlService.removeParticipant(teacherPrincipal, onlineClass.getId(), student.getId());

        assertThatThrownBy(() -> admissionService.knock(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("removed");
    }

    // --- Host controls -------------------------------------------------------

    @Test
    void mutingResolvesTheLiveIdentityRatherThanGuessingIt() {
        admissionService.knock(studentPrincipal, onlineClass.getId());

        hostControlService.muteParticipant(teacherPrincipal, onlineClass.getId(), student.getId());

        // The identity carries a per-device suffix, so it must come from the
        // room listing; a reconstructed identity would silently match nobody.
        org.mockito.Mockito.verify(mediaProvider)
                .muteParticipantAudio(onlineClass.getRoomName(),
                        ParticipantIdentity.of(student.getId(), "tab-1"));
    }

    @Test
    void removingDisconnectsEveryTabOfThatUser() {
        when(mediaProvider.listParticipantIdentities(anyString())).thenReturn(List.of(
                ParticipantIdentity.of(student.getId(), "tab-1"),
                ParticipantIdentity.of(student.getId(), "tab-2")));
        admissionService.knock(studentPrincipal, onlineClass.getId());

        hostControlService.removeParticipant(teacherPrincipal, onlineClass.getId(), student.getId());

        org.mockito.Mockito.verify(mediaProvider, org.mockito.Mockito.times(2))
                .removeParticipant(anyString(), anyString());
    }

    @Test
    void aTeacherCannotMuteOrRemoveThemselves() {
        assertThatThrownBy(() -> hostControlService.muteParticipant(
                teacherPrincipal, onlineClass.getId(), teacher.getId()))
                .isInstanceOf(ResourceNotFoundException.class);

        participantRepository.save(OnlineClassParticipant.host(onlineClass, teacher));
        assertThatThrownBy(() -> hostControlService.removeParticipant(
                teacherPrincipal, onlineClass.getId(), teacher.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("yourself");
    }

    @Test
    void studentsCannotModerate() {
        admissionService.knock(studentPrincipal, onlineClass.getId());

        assertThatThrownBy(() -> hostControlService.muteParticipant(
                studentPrincipal, onlineClass.getId(), student.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> hostControlService.muteAllStudents(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> hostControlService.attendance(studentPrincipal, onlineClass.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void muteAllLeavesTheHostUnmuted() {
        participantRepository.save(OnlineClassParticipant.host(onlineClass, teacher));
        admissionService.knock(studentPrincipal, onlineClass.getId());
        admissionService.approveAll(teacherPrincipal, onlineClass.getId());

        hostControlService.muteAllStudents(teacherPrincipal, onlineClass.getId());

        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), teacher.getId())
                .orElseThrow().isMicrophoneEnabled()).isTrue();
        assertThat(participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId())
                .orElseThrow().isMicrophoneEnabled()).isFalse();
    }

    @Test
    void screenSharePermissionFollowsTheClassSetting() {
        admissionService.knock(studentPrincipal, onlineClass.getId());
        admissionService.approveAll(teacherPrincipal, onlineClass.getId());

        hostControlService.updatePermissions(teacherPrincipal, onlineClass.getId(), student.getId(),
                new ParticipantPermissionRequest(null, null, true));

        // Granted per-participant, but the class-level switch is still off.
        OnlineClass reloaded = classRepository.findById(onlineClass.getId()).orElseThrow();
        assertThat(reloaded.isStudentScreenShareEnabled()).isFalse();

        hostControlService.setStudentScreenShare(teacherPrincipal, onlineClass.getId(), true);
        assertThat(classRepository.findById(onlineClass.getId()).orElseThrow()
                .isStudentScreenShareEnabled()).isTrue();
    }

    @Test
    void studentsMaySeeTheRosterButNotAttendanceTimings() {
        admissionService.knock(studentPrincipal, onlineClass.getId());

        List<ClassParticipantResponse> roster =
                hostControlService.listParticipants(studentPrincipal, onlineClass.getId());

        assertThat(roster).isNotEmpty();
        assertThat(roster).allSatisfy(entry -> assertThat(entry.displayName()).doesNotContain("@"));
    }

    @Test
    void attendanceSurvivesReconnectsAndIsVisibleToTheTeacher() {
        admissionService.knock(studentPrincipal, onlineClass.getId());
        OnlineClassParticipant participant = participantRepository
                .findByOnlineClassIdAndUserId(onlineClass.getId(), student.getId()).orElseThrow();
        participant.markJoined(START);
        participant.markLeft(START.plusSeconds(300));
        participant.markJoined(START.plusSeconds(600));
        participant.markLeft(START.plusSeconds(900));
        participantRepository.save(participant);

        List<ClassParticipantResponse> attendance =
                hostControlService.attendance(teacherPrincipal, onlineClass.getId());

        assertThat(attendance)
                .filteredOn(entry -> entry.userId().equals(student.getId()))
                .singleElement()
                .extracting(ClassParticipantResponse::totalConnectedSeconds)
                .isEqualTo(600L);
    }

    @Test
    void unmuteIsARequestNotACommand() {
        admissionService.knock(studentPrincipal, onlineClass.getId());

        hostControlService.requestUnmute(teacherPrincipal, onlineClass.getId(), student.getId());

        // Browsers need local consent, so the server sends a notification on the
        // control topic instead of forcing the track on.
        org.mockito.Mockito.verify(mediaProvider).sendControlPacket(
                org.mockito.ArgumentMatchers.eq(onlineClass.getRoomName()),
                org.mockito.ArgumentMatchers.eq("mc.class.control.v1"),
                org.mockito.ArgumentMatchers.any(byte[].class));
    }

    @Test
    void knockingOnAClassThatIsNotOpenIsRejected() {
        OnlineClass scheduled = classRepository.save(OnlineClass.forStudent(teacher, "event-2",
                "binding-2", "Maths", START, END, student));

        assertThatThrownBy(() -> admissionService.knock(studentPrincipal, scheduled.getId()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("not open");
    }

    @Test
    void decidingAnUnknownRequestIsNotFound() {
        assertThatThrownBy(() ->
                admissionService.approve(teacherPrincipal, onlineClass.getId(), UUID.randomUUID()))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
