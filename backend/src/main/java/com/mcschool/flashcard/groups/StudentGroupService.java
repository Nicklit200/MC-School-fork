package com.mcschool.flashcard.groups;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.dto.ParsedCard;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.dto.AddGroupMembersRequest;
import com.mcschool.flashcard.groups.dto.CreateGroupCardRequest;
import com.mcschool.flashcard.groups.dto.CreateStudentGroupRequest;
import com.mcschool.flashcard.groups.dto.ImportGroupCardsRequest;
import com.mcschool.flashcard.groups.dto.StudentGroupResponse;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.users.Invitations;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudentGroupService {

    private final StudentGroupRepository groupRepository;
    private final StudentGroupMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardRepository cardRepository;
    private final NotificationService notificationService;

    public StudentGroupService(StudentGroupRepository groupRepository,
                               StudentGroupMemberRepository memberRepository,
                               UserRepository userRepository,
                               HomeworkRepository homeworkRepository,
                               CardRepository cardRepository,
                               NotificationService notificationService) {
        this.groupRepository = groupRepository;
        this.memberRepository = memberRepository;
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.cardRepository = cardRepository;
        this.notificationService = notificationService;
    }

    @Transactional
    public StudentGroupResponse create(AuthenticatedUser teacher, CreateStudentGroupRequest request) {
        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
        StudentGroup group = groupRepository.save(StudentGroup.create(teacherEntity, request.name()));

        request.emails().stream()
                .map(email -> email.trim().toLowerCase(Locale.ROOT))
                .distinct()
                .forEach(email -> addStudentByEmail(group, teacherEntity, email));
        return response(group);
    }

    @Transactional
    public StudentGroupResponse addMembers(AuthenticatedUser teacher, UUID groupId, AddGroupMembersRequest request) {
        StudentGroup group = requireOwnedGroup(teacher.id(), groupId);
        User teacherEntity = group.getTeacher();
        request.emails().stream()
                .map(email -> email.trim().toLowerCase(Locale.ROOT))
                .distinct()
                .forEach(email -> addStudentByEmail(group, teacherEntity, email));
        return response(group);
    }

    @Transactional(readOnly = true)
    public List<StudentGroupResponse> list(AuthenticatedUser teacher) {
        return groupRepository.findAllByTeacherIdOrderByNameAsc(teacher.id()).stream()
                .map(this::response)
                .toList();
    }

    @Transactional(readOnly = true)
    public StudentGroupResponse get(AuthenticatedUser teacher, UUID groupId) {
        return response(requireOwnedGroup(teacher.id(), groupId));
    }

    @Transactional
    public int createCardForGroup(AuthenticatedUser teacher, UUID groupId, CreateGroupCardRequest request) {
        StudentGroup group = requireOwnedGroup(teacher.id(), groupId);
        List<StudentGroupMember> members = memberRepository.findAllByGroupIdOrderByStudentFullNameAsc(groupId);
        for (StudentGroupMember member : members) {
            Homework homework = homeworkForCards(member.getStudent(), request.startDate());
            cardRepository.save(Card.create(homework, group.getTeacher(), request.question(), request.correctAnswer()));
        }
        return members.size();
    }

    @Transactional
    public int importCardsForGroup(AuthenticatedUser teacher, UUID groupId, ImportGroupCardsRequest request) {
        StudentGroup group = requireOwnedGroup(teacher.id(), groupId);
        List<StudentGroupMember> members = memberRepository.findAllByGroupIdOrderByStudentFullNameAsc(groupId);
        for (StudentGroupMember member : members) {
            Homework homework = homeworkForCards(member.getStudent(), request.startDate());
            for (ParsedCard parsed : request.cards()) {
                cardRepository.save(Card.createImported(homework, group.getTeacher(), parsed.question(), parsed.correctAnswer(),
                        parsed.wrongAnswer1(), parsed.wrongAnswer2(), parsed.wrongAnswer3()));
            }
        }
        return members.size() * request.cards().size();
    }

    private void addStudentByEmail(StudentGroup group, User teacher, String email) {
        User student = userRepository.findByEmail(email).orElseGet(() -> createInvitedStudent(teacher, email));
        if (student.getRole() != Role.STUDENT || student.isArchived()
                || student.getTeacher() == null || !student.getTeacher().getId().equals(teacher.getId())) {
            throw new ConflictException("Email belongs to an account that cannot be added to this group");
        }
        if (!memberRepository.existsByGroupIdAndStudentId(group.getId(), student.getId())) {
            memberRepository.save(StudentGroupMember.create(group, student));
        }
    }

    private User createInvitedStudent(User teacher, String email) {
        String token = Invitations.newToken();
        Instant expiresAt = Invitations.expiry(Instant.now());
        String localPart = email.substring(0, email.indexOf('@'));
        String generatedName = localPart.replace('.', ' ').replace('_', ' ').replace('-', ' ').strip();
        if (generatedName.isBlank()) {
            generatedName = email;
        }
        User student = userRepository.save(User.invitedStudent(generatedName, email, teacher, token, expiresAt));
        notificationService.sendInvitation(student, token);
        return student;
    }

    private Homework homeworkForCards(User student, java.time.LocalDate startDate) {
        return homeworkRepository.findFirstByStudentIdAndStartDateAndWorksheetPdfIsNullOrderByCreatedAtAsc(
                        student.getId(), startDate)
                .orElseGet(() -> homeworkRepository.save(Homework.create(student, startDate)));
    }

    private StudentGroup requireOwnedGroup(UUID teacherId, UUID groupId) {
        return groupRepository.findByIdAndTeacherId(groupId, teacherId)
                .orElseThrow(() -> new ResourceNotFoundException("Group not found"));
    }

    private StudentGroupResponse response(StudentGroup group) {
        List<UserResponse> students = memberRepository.findAllByGroupIdOrderByStudentFullNameAsc(group.getId()).stream()
                .map(StudentGroupMember::getStudent)
                .map(UserResponse::from)
                .toList();
        return StudentGroupResponse.from(group, students);
    }
}
