package com.mcschool.flashcard.liveclasses;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.PersonalLessonWorkbookService;
import com.mcschool.flashcard.liveclasses.dto.AnnotationOperationRequest;
import com.mcschool.flashcard.liveclasses.provider.ClassArtifactStorage;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class PersonalWorkbookAnnotationAccessTest {
    private final OnlineClassAnnotationDocumentRepository documents = mock(OnlineClassAnnotationDocumentRepository.class);
    private final OnlineClassAnnotationEventRepository events = mock(OnlineClassAnnotationEventRepository.class);
    private final OnlineClassAccessService access = mock(OnlineClassAccessService.class);
    private final AnnotationPayloadValidator validator = mock(AnnotationPayloadValidator.class);
    private final ClassArtifactStorage storage = mock(ClassArtifactStorage.class);
    private final PersonalLessonWorkbookService personal = mock(PersonalLessonWorkbookService.class);
    private final OnlineClassAnnotationService service = new OnlineClassAnnotationService(documents, events, access,
            validator, storage, Clock.fixed(Instant.parse("2026-11-02T12:00:00Z"), ZoneOffset.UTC), personal);
    private OnlineClass room;
    private User teacher, student, otherStudent;
    private AuthenticatedUser host, owner, other;
    private OnlineClassAnnotationDocument worksheet, myBoard, shared;

    @BeforeEach
    void fixtures() {
        teacher = User.activeTeacher("Nick", "nick@test.local", "nick", "unused");
        ReflectionTestUtils.setField(teacher, "id", PersonalLessonWorkbookService.PILOT_TEACHER_ID);
        student = User.managedStudent("Pupil", teacher);
        otherStudent = User.managedStudent("Other pupil", teacher);
        host = principal(teacher); owner = principal(student); other = principal(otherStudent);
        room = OnlineClass.forStudent(teacher, "event", "event", "Math", Instant.now(), Instant.now().plusSeconds(3600), student);
        for (AuthenticatedUser caller : List.of(host, owner, other)) {
            when(access.requireAdmitted(caller, room.getId())).thenReturn(room);
        }
        when(access.requireHost(host, room.getId())).thenReturn(room);
        when(access.isHost(host, room)).thenReturn(true);
        when(access.requireActiveUser(host.id())).thenReturn(teacher);
        when(access.requireActiveUser(owner.id())).thenReturn(student);
        when(personal.enabledForTeacher(teacher.getId())).thenReturn(true);
        when(validator.validate(any(), anyString())).thenReturn("{}");
        when(events.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        worksheet = document(PersonalBoard.workbookTargetIdFor(student.getId()));
        myBoard = document(PersonalBoard.targetIdFor(student.getId()));
        shared = document("board-1");
        when(documents.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of(shared, myBoard, worksheet));
    }

    @Test
    void admittedOwnerAndHostCanOpenReadAndWriteWorksheet() {
        for (AuthenticatedUser caller : List.of(owner, host)) {
            assertThat(service.openDocument(caller, room.getId(), AnnotationTargetType.WHITEBOARD,
                    worksheet.getTargetId(), 0, null, null).id()).isEqualTo(worksheet.getId());
            assertThat(service.replay(caller, room.getId(), worksheet.getId(), 0)).isEmpty();
            assertThat(service.append(caller, room.getId(), worksheet.getId(), operation()).actorId()).isEqualTo(caller.id());
            assertThat(service.listDocuments(caller, room.getId())).extracting(item -> item.targetId()).contains(worksheet.getTargetId());
        }
        assertThat(worksheet.getRevision()).isEqualTo(2L);
        assertThat(myBoard.getRevision()).isZero();
        assertThat(shared.getRevision()).isZero();
        verify(personal, org.mockito.Mockito.atLeastOnce()).requireClassStudent(room, student.getId());
    }

    @Test
    void differentPupilCannotOpenReadWriteOrListWorksheet() {
        assertDenied(other, worksheet);
        assertThat(service.listDocuments(other, room.getId())).extracting(item -> item.targetId())
                .containsExactly("board-1");
        verifyNoInteractions(events, storage);
    }

    @Test
    void multipageWorkbookChecksMembershipOncePerListForOwnerAndHost() {
        var secondPage = document(worksheet.getTargetId(), 1);
        var thirdPage = document(worksheet.getTargetId(), 2);
        when(documents.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()))
                .thenReturn(List.of(shared, worksheet, secondPage, thirdPage));

        for (AuthenticatedUser caller : List.of(owner, host)) {
            assertThat(service.listDocuments(caller, room.getId())).extracting(item -> item.id())
                    .containsExactly(shared.getId(), worksheet.getId(), secondPage.getId(), thirdPage.getId());
        }

        verify(personal, times(2)).enabledForTeacher(teacher.getId());
        verify(personal, times(2)).requireClassStudent(room, student.getId());
        verifyNoInteractions(events, storage);
    }

    @Test
    void ownerListRechecksRevokedMembershipOnTheNextRequest() {
        assertListRevocationIsFresh(owner);
    }

    @Test
    void hostListRechecksRevokedMembershipOnTheNextRequest() {
        assertListRevocationIsFresh(host);
    }

    @Test
    void multipageWorkbooksStayIsolatedBetweenOwnersWhileHostCanSeeBoth() {
        var secondPage = document(worksheet.getTargetId(), 1);
        var otherWorksheet = document(PersonalBoard.workbookTargetIdFor(otherStudent.getId()));
        var otherSecondPage = document(otherWorksheet.getTargetId(), 1);
        when(documents.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()))
                .thenReturn(List.of(shared, myBoard, worksheet, secondPage, otherWorksheet, otherSecondPage));

        assertThat(service.listDocuments(owner, room.getId())).extracting(item -> item.id())
                .containsExactly(shared.getId(), myBoard.getId(), worksheet.getId(), secondPage.getId());
        assertThat(service.listDocuments(other, room.getId())).extracting(item -> item.id())
                .containsExactly(shared.getId(), otherWorksheet.getId(), otherSecondPage.getId());
        assertThat(service.listDocuments(host, room.getId())).extracting(item -> item.id())
                .containsExactly(shared.getId(), myBoard.getId(), worksheet.getId(), secondPage.getId(),
                        otherWorksheet.getId(), otherSecondPage.getId());

        // Each owner request and the host request independently authorize its target.
        verify(personal, times(2)).requireClassStudent(room, student.getId());
        verify(personal, times(2)).requireClassStudent(room, otherStudent.getId());
        verifyNoInteractions(events, storage);
    }

    @Test
    void nonPilotClassRejectsWorkbookScopeWhileKeepingExistingPersonalBoard() {
        when(personal.enabledForTeacher(teacher.getId())).thenReturn(false);
        assertDenied(owner, worksheet);
        assertDenied(host, worksheet);
        assertThatThrownBy(() -> service.saveSnapshot(host, room.getId(), worksheet.getId(), png()))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(service.listDocuments(host, room.getId())).extracting(item -> item.targetId())
                .containsExactly("board-1", myBoard.getTargetId());
        assertThat(service.openDocument(owner, room.getId(), AnnotationTargetType.WHITEBOARD,
                myBoard.getTargetId(), 0, null, null).id()).isEqualTo(myBoard.getId());
        verifyNoInteractions(events, storage);
    }

    @Test
    void removedPupilScopeIsUnreadableEvenToHostAndIsFilteredRatherThanFailingList() {
        doThrow(new ResourceNotFoundException("No longer a lesson participant"))
                .when(personal).requireClassStudent(room, student.getId());
        assertDenied(host, worksheet);
        assertDenied(owner, worksheet);
        assertThat(service.listDocuments(host, room.getId())).extracting(item -> item.targetId())
                .containsExactly("board-1", myBoard.getTargetId());
        assertThatThrownBy(() -> service.saveSnapshot(host, room.getId(), worksheet.getId(), png()))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(events, storage);
    }

    @Test
    void malformedWorkbookOwnerCannotBeOpenedListedOrSnapshottedByHost() {
        OnlineClassAnnotationDocument malformed = document("personal-workbook-not-a-uuid");
        when(documents.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId())).thenReturn(List.of(shared, malformed));
        assertDenied(host, malformed);
        assertThat(service.listDocuments(host, room.getId())).extracting(item -> item.targetId()).containsExactly("board-1");
        assertThatThrownBy(() -> service.saveSnapshot(host, room.getId(), malformed.getId(), png()))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(events, storage);
    }

    @Test
    void worksheetSnapshotUsesItsOwnArtifactKeyAndRechecksCurrentMembership() {
        when(storage.isConfigured()).thenReturn(true);
        when(storage.buildObjectKey(anyString(), anyString())).thenAnswer(invocation -> invocation.getArgument(1));
        var saved = service.saveSnapshot(host, room.getId(), worksheet.getId(), png());
        assertThat(saved.snapshotSavedAt()).isEqualTo(Instant.parse("2026-11-02T12:00:00Z"));
        assertThat(worksheet.getSnapshotObjectKey()).contains(worksheet.getId().toString());
        assertThat(myBoard.getSnapshotObjectKey()).isNull();
        assertThat(shared.getSnapshotObjectKey()).isNull();
        verify(personal).requireClassStudent(room, student.getId());
        verify(storage, never()).buildObjectKey(room.getId().toString(), "whiteboard-0.png");
    }

    @Test
    void waitingRoomCannotReachWorksheetAnnotations() {
        when(access.requireAdmitted(owner, room.getId())).thenThrow(new ResourceNotFoundException("Not admitted"));
        assertDenied(owner, worksheet);
        assertThatThrownBy(() -> service.listDocuments(owner, room.getId())).isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(personal, events, storage);
    }

    @Test
    void worksheetAndExistingBoardHaveIndependentCanonicalOwnerTargets() {
        assertThat(PersonalBoard.ownerOf(worksheet.getTargetId())).contains(student.getId());
        assertThat(PersonalBoard.ownerOf(myBoard.getTargetId())).contains(student.getId());
        assertThat(PersonalBoard.isWorkbook(worksheet.getTargetId())).isTrue();
        assertThat(PersonalBoard.isWorkbook(myBoard.getTargetId())).isFalse();
        assertThat(worksheet.getTargetId()).isNotEqualTo(myBoard.getTargetId());
        assertThat(PersonalBoard.ownerOf("personal-workbook-1-1-1-1-1")).isEmpty();
    }

    private OnlineClassAnnotationDocument document(String target) {
        return document(target, 0);
    }

    private OnlineClassAnnotationDocument document(String target, int pageIndex) {
        OnlineClassAnnotationDocument document = OnlineClassAnnotationDocument.create(room, AnnotationTargetType.WHITEBOARD, target, pageIndex);
        when(documents.findByOnlineClassIdAndTargetTypeAndTargetIdAndPageIndex(room.getId(), AnnotationTargetType.WHITEBOARD, target, pageIndex))
                .thenReturn(Optional.of(document));
        when(documents.findByIdAndOnlineClassId(document.getId(), room.getId())).thenReturn(Optional.of(document));
        when(documents.findForUpdate(document.getId(), room.getId())).thenReturn(Optional.of(document));
        return document;
    }

    private void assertListRevocationIsFresh(AuthenticatedUser caller) {
        var secondPage = document(worksheet.getTargetId(), 1);
        var thirdPage = document(worksheet.getTargetId(), 2);
        when(documents.findAllByOnlineClassIdOrderByPageIndexAsc(room.getId()))
                .thenReturn(List.of(shared, worksheet, secondPage, thirdPage));
        assertThat(service.listDocuments(caller, room.getId())).extracting(item -> item.id())
                .containsExactly(shared.getId(), worksheet.getId(), secondPage.getId(), thirdPage.getId());

        doThrow(new ResourceNotFoundException("No longer a lesson participant"))
                .when(personal).requireClassStudent(room, student.getId());

        assertThat(service.listDocuments(caller, room.getId())).extracting(item -> item.id())
                .containsExactly(shared.getId());
        verify(personal, times(2)).enabledForTeacher(teacher.getId());
        verify(personal, times(2)).requireClassStudent(room, student.getId());
        verifyNoInteractions(events, storage);
    }

    private void assertDenied(AuthenticatedUser caller, OnlineClassAnnotationDocument document) {
        assertThatThrownBy(() -> service.openDocument(caller, room.getId(), AnnotationTargetType.WHITEBOARD,
                document.getTargetId(), 0, null, null)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.replay(caller, room.getId(), document.getId(), 0)).isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> service.append(caller, room.getId(), document.getId(), operation())).isInstanceOf(ResourceNotFoundException.class);
    }

    private AnnotationOperationRequest operation() {
        return new AnnotationOperationRequest(UUID.randomUUID(), AnnotationOperationType.CLEAR_LAYER, "{}");
    }

    private String png() { return Base64.getEncoder().encodeToString(new byte[] {1, 2, 3}); }

    private AuthenticatedUser principal(User user) {
        return new AuthenticatedUser(user.getId(), user.getEmail(), user.getRole());
    }
}
