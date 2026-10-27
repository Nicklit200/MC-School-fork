package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroup;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.users.AdminAccountResponse;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import com.mcschool.flashcard.users.dto.StudentTransferResponse;
import com.mcschool.flashcard.users.dto.TransferStudentsResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class TeacherTransferService {

    private final UserRepository users;
    private final StudentGroupRepository groups;
    private final StudentGroupMemberRepository members;
    private final LessonHistoryRepository lessonHistory;
    private final LessonPreparationRepository preparations;

    public TeacherTransferService(
            UserRepository users,
            StudentGroupRepository groups,
            StudentGroupMemberRepository members,
            LessonHistoryRepository lessonHistory,
            LessonPreparationRepository preparations) {
        this.users = users;
        this.groups = groups;
        this.members = members;
        this.lessonHistory = lessonHistory;
        this.preparations = preparations;
    }

    @Transactional
    public StudentTransferResponse transferStudent(UUID studentId, UUID newTeacherId) {
        User student = users.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT && !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        User newTeacher = requireActiveTeacher(newTeacherId);
        User oldTeacher = student.getTeacher();
        if (oldTeacher != null && oldTeacher.getId().equals(newTeacherId)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Student is already assigned to this teacher");
        }

        student.reassignTeacher(newTeacher);
        Set<UUID> studentIds = Set.of(studentId);
        Set<UUID> movedGroupIds = oldTeacher == null
                ? Set.of()
                : moveEligibleGroupsForStudent(student, oldTeacher, newTeacher);
        int copiedLessons = oldTeacher == null ? 0
                : copyFutureLessons(oldTeacher, newTeacher, studentIds, movedGroupIds);
        int futureGroupLessonsNotTransferred = oldTeacher == null ? 0
                : countFutureGroupLessonsNotTransferred(oldTeacher, studentId, movedGroupIds);

        reassignParentIfAllChildrenMoved(student.getParent(), newTeacher);
        return new StudentTransferResponse(
                AdminAccountResponse.from(student), copiedLessons, movedGroupIds.size(),
                futureGroupLessonsNotTransferred);
    }

    @Transactional
    public TransferStudentsResponse transferAllStudents(UUID fromTeacherId, UUID toTeacherId) {
        if (fromTeacherId.equals(toTeacherId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose two different teachers");
        }
        User fromTeacher = requireTeacherIncludingArchived(fromTeacherId);
        User toTeacher = requireActiveTeacher(toTeacherId);

        List<User> students = users.findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(fromTeacherId);
        Set<UUID> studentIds = new LinkedHashSet<>();
        for (User student : students) {
            student.reassignTeacher(toTeacher);
            studentIds.add(student.getId());
        }

        Set<UUID> movedGroupIds = new LinkedHashSet<>();
        for (StudentGroup group : groups.findAllByTeacherIdOrderByNameAsc(fromTeacherId)) {
            if (allNonArchivedMembersAssignedTo(group, toTeacherId)) {
                group.reassignTeacher(toTeacher);
                movedGroupIds.add(group.getId());
            }
        }

        int copiedLessons = copyFutureLessons(fromTeacher, toTeacher, studentIds, movedGroupIds);
        int groupsNotTransferred = countGroupsWithFutureLessonsNotTransferred(fromTeacher, movedGroupIds);
        reassignParentsIfAllChildrenMoved(students, toTeacher);

        return new TransferStudentsResponse(
                fromTeacherId, fromTeacher.getFullName(),
                toTeacherId, toTeacher.getFullName(),
                students.size(), movedGroupIds.size(), copiedLessons, groupsNotTransferred);
    }

    private Set<UUID> moveEligibleGroupsForStudent(User student, User oldTeacher, User newTeacher) {
        Set<UUID> moved = new LinkedHashSet<>();
        for (StudentGroupMember membership : members.findAllByStudentIdOrderByCreatedAtAsc(student.getId())) {
            StudentGroup group = membership.getGroup();
            if (!group.getTeacher().getId().equals(oldTeacher.getId())) continue;
            if (!allNonArchivedMembersAssignedTo(group, newTeacher.getId())) continue;
            group.reassignTeacher(newTeacher);
            moved.add(group.getId());
        }
        return moved;
    }

    private boolean allNonArchivedMembersAssignedTo(StudentGroup group, UUID teacherId) {
        List<StudentGroupMember> groupMembers = members.findAllByGroupIdOrderByCreatedAtAsc(group.getId());
        boolean hasActiveAccount = false;
        for (StudentGroupMember membership : groupMembers) {
            User student = membership.getStudent();
            if (student.isArchived()) continue;
            hasActiveAccount = true;
            if (student.getRole() != Role.STUDENT || student.getTeacher() == null
                    || !student.getTeacher().getId().equals(teacherId)) {
                return false;
            }
        }
        return hasActiveAccount;
    }

    private int copyFutureLessons(User fromTeacher, User toTeacher, Set<UUID> studentIds, Set<UUID> groupIds) {
        if (studentIds.isEmpty() && groupIds.isEmpty()) return 0;
        Instant now = Instant.now();
        int copied = 0;
        List<LessonHistoryEntry> entries =
                lessonHistory.findAllByTeacherIdAndDeletedAtIsNullOrderByStartsAtAsc(fromTeacher.getId());
        for (LessonHistoryEntry entry : entries) {
            if (entry.getStartsAt() == null || !entry.getStartsAt().isAfter(now)) continue;

            boolean individual = entry.getGroupId() == null
                    && entry.getStudentId() != null && studentIds.contains(entry.getStudentId());
            boolean group = entry.getGroupId() != null && groupIds.contains(entry.getGroupId());
            if (!individual && !group) continue;

            List<UUID> participants = entry.toResponse().participantStudentIds() == null
                    ? List.of()
                    : entry.toResponse().participantStudentIds().stream()
                            .filter(studentIds::contains).distinct().toList();
            if (group && participants.isEmpty()) continue;

            String newEventId = ManualLessonService.EVENT_PREFIX + UUID.randomUUID();
            GroupLessonResponse source = entry.toResponse();
            GroupLessonResponse transferred = new GroupLessonResponse(
                    newEventId,
                    newEventId,
                    group ? source.groupId() : null,
                    group ? source.groupName() : null,
                    individual ? source.studentId() : null,
                    individual ? source.studentName() : null,
                    participants,
                    source.title(),
                    source.startsAt(),
                    source.endsAt(),
                    null,
                    null
            );
            lessonHistory.save(LessonHistoryEntry.create(toTeacher, transferred));
            preparations.findByTeacherIdAndEventId(fromTeacher.getId(), source.eventId())
                    .ifPresent(preparation -> preparations.save(preparation.copyFor(toTeacher, newEventId)));
            copied++;
        }
        return copied;
    }

    private int countFutureGroupLessonsNotTransferred(User oldTeacher, UUID studentId, Set<UUID> movedGroupIds) {
        Set<UUID> groupIds = new HashSet<>();
        for (StudentGroupMember membership : members.findAllByStudentIdOrderByCreatedAtAsc(studentId)) {
            groupIds.add(membership.getGroup().getId());
        }
        if (groupIds.isEmpty()) return 0;
        Instant now = Instant.now();
        return (int) lessonHistory.findAllByTeacherIdAndDeletedAtIsNullOrderByStartsAtAsc(oldTeacher.getId()).stream()
                .filter(entry -> entry.getStartsAt() != null && entry.getStartsAt().isAfter(now))
                .filter(entry -> entry.getGroupId() != null && groupIds.contains(entry.getGroupId()))
                .filter(entry -> !movedGroupIds.contains(entry.getGroupId()))
                .count();
    }

    private int countGroupsWithFutureLessonsNotTransferred(User oldTeacher, Set<UUID> movedGroupIds) {
        Instant now = Instant.now();
        Set<UUID> groupsWithFutureLessons = new HashSet<>();
        for (LessonHistoryEntry entry : lessonHistory.findAllByTeacherIdAndDeletedAtIsNullOrderByStartsAtAsc(oldTeacher.getId())) {
            if (entry.getStartsAt() != null && entry.getStartsAt().isAfter(now)
                    && entry.getGroupId() != null && !movedGroupIds.contains(entry.getGroupId())) {
                groupsWithFutureLessons.add(entry.getGroupId());
            }
        }
        return groupsWithFutureLessons.size();
    }

    private void reassignParentsIfAllChildrenMoved(List<User> students, User newTeacher) {
        Set<UUID> parents = new LinkedHashSet<>();
        for (User student : students) {
            if (student.getParent() != null) parents.add(student.getParent().getId());
        }
        for (UUID parentId : parents) {
            users.findById(parentId).ifPresent(parent -> reassignParentIfAllChildrenMoved(parent, newTeacher));
        }
    }

    private void reassignParentIfAllChildrenMoved(User parent, User newTeacher) {
        if (parent == null || parent.getRole() != Role.PARENT) return;
        List<User> children = users.findAllByParentIdAndArchivedFalseOrderByFullNameAsc(parent.getId());
        if (!children.isEmpty() && children.stream().allMatch(child ->
                child.getTeacher() != null && child.getTeacher().getId().equals(newTeacher.getId()))) {
            parent.reassignParentOwner(newTeacher);
        }
    }

    private User requireActiveTeacher(UUID teacherId) {
        return users.findById(teacherId)
                .filter(user -> user.getRole() == Role.TEACHER)
                .filter(user -> !user.isArchived() && user.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Active teacher not found"));
    }

    private User requireTeacherIncludingArchived(UUID teacherId) {
        return users.findById(teacherId)
                .filter(user -> user.getRole() == Role.TEACHER)
                .orElseThrow(() -> new ResourceNotFoundException("Source teacher not found"));
    }
}
