package com.mcschool.flashcard.lessonboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.lessons.LessonHistoryEntry;
import com.mcschool.flashcard.lessons.LessonHistoryRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

class LessonBoardControllerTest {
    private static final UUID TEACHER_ID = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    private static final UUID STUDENT_ID = UUID.fromString("1a4f18d1-e145-4c27-bd3e-7d1598405045");
    private static final String EVENT = "google-calendar-occurrence-01";

    private LessonBoardOperationRepository operations;
    private LessonHistoryRepository lessons;
    private StudentGroupMemberRepository groups;
    private UserRepository users;
    private LessonBoardController controller;

    @BeforeEach
    void init() {
        operations = mock(LessonBoardOperationRepository.class);
        lessons = mock(LessonHistoryRepository.class);
        groups = mock(StudentGroupMemberRepository.class);
        users = mock(UserRepository.class);
        controller = new LessonBoardController(operations, lessons, groups, users, new ObjectMapper());
        LessonHistoryEntry lesson = mock(LessonHistoryEntry.class);
        User teacher = mock(User.class);
        when(teacher.getId()).thenReturn(TEACHER_ID);
        when(lesson.getTeacher()).thenReturn(teacher);
        when(lesson.getTitle()).thenReturn("Математика");
        when(lesson.getMeetUrl()).thenReturn("https://meet.google.com/abc?authuser=teacher");
        when(lessons.findByTeacherIdAndEventId(TEACHER_ID, EVENT)).thenReturn(Optional.of(lesson));
    }

    private AuthenticatedUser teacher() {
        return new AuthenticatedUser(TEACHER_ID, null, Role.TEACHER);
    }

    private AuthenticatedUser student() {
        User account = mock(User.class);
        User teacher = mock(User.class);
        when(teacher.getId()).thenReturn(TEACHER_ID);
        when(account.getRole()).thenReturn(Role.STUDENT);
        when(account.getTeacher()).thenReturn(teacher);
        when(users.findById(STUDENT_ID)).thenReturn(Optional.of(account));
        return new AuthenticatedUser(STUDENT_ID, null, Role.STUDENT);
    }

    @Test
    void teacherOpensOnlyExistingCalendarLesson() {
        var result = controller.start(teacher(), EVENT);
        assertTrue(result.teacher());
        assertEquals("Математика", result.title());
        assertEquals("https://meet.google.com/abc", result.meetUrl());
        verify(operations).save(any(LessonBoardOperation.class));
    }

    @Test
    void arbitraryUnknownLessonCannotBeOpened() {
        assertThrows(ResourceNotFoundException.class,
                () -> controller.start(teacher(), "unknown-lesson"));
    }

    @Test
    void studentCannotAccessBeforeTeacherOpensBoard() {
        assertThrows(ResourceNotFoundException.class,
                () -> controller.read(student(), EVENT, 0));
    }

    @Test
    void unrelatedStudentCannotReadEvenAnOpenedBoard() {
        when(operations.existsByTeacherIdAndEventIdAndKind(TEACHER_ID, EVENT, "OPEN"))
                .thenReturn(true);
        assertThrows(ResourceNotFoundException.class,
                () -> controller.read(student(), EVENT, 0));
    }

    @Test
    void enrolledStudentCanReadOpenedBoard() {
        AuthenticatedUser caller = student();
        LessonHistoryEntry lesson = lessons.findByTeacherIdAndEventId(TEACHER_ID, EVENT).orElseThrow();
        when(lesson.getStudentId()).thenReturn(STUDENT_ID);
        when(operations.existsByTeacherIdAndEventIdAndKind(TEACHER_ID, EVENT, "OPEN"))
                .thenReturn(true);
        var board = controller.read(caller, EVENT, 0);
        assertFalse(board.teacher());
        assertEquals(EVENT, board.eventId());
    }

    @Test
    void studentsCannotClearTeacherBoard() {
        AuthenticatedUser caller = student();
        LessonHistoryEntry lesson = lessons.findByTeacherIdAndEventId(TEACHER_ID, EVENT).orElseThrow();
        when(lesson.getStudentId()).thenReturn(STUDENT_ID);
        when(operations.existsByTeacherIdAndEventIdAndKind(TEACHER_ID, EVENT, "OPEN"))
                .thenReturn(true);
        var request = new LessonBoardController.BoardActionRequest(
                "CLEAR", null, null, null, null, null, null, null);
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> controller.append(caller, EVENT, request));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatusCode());
    }

    @Test
    void rejectOversizedOrUnboundedCoordinates() {
        when(operations.existsByTeacherIdAndEventIdAndKind(TEACHER_ID, EVENT, "OPEN"))
                .thenReturn(true);
        var request = new LessonBoardController.BoardActionRequest(
                "STROKE", List.of(new LessonBoardController.BoardPoint(200.0, 0.5)),
                null, null, null, "#123456", 4, null);
        ResponseStatusException e = assertThrows(ResponseStatusException.class,
                () -> controller.append(teacher(), EVENT, request));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatusCode());
    }

    @Test
    void teacherCannotUndoAnOperationFromAnotherCalendarLesson() {
        when(operations.existsByTeacherIdAndEventIdAndKind(TEACHER_ID, EVENT, "OPEN"))
                .thenReturn(true);
        LessonBoardOperation otherLesson = mock(LessonBoardOperation.class);
        when(otherLesson.getTeacherId()).thenReturn(TEACHER_ID);
        when(otherLesson.getEventId()).thenReturn("another-event");
        when(operations.findById(10L)).thenReturn(Optional.of(otherLesson));
        var request = new LessonBoardController.BoardActionRequest(
                "UNDO", null, null, null, null, null, null, 10L);
        assertThrows(ResponseStatusException.class,
                () -> controller.append(teacher(), EVENT, request));
    }
}
