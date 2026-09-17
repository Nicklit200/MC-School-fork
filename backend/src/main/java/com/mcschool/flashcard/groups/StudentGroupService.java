package com.mcschool.flashcard.groups;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.cards.Card;
import com.mcschool.flashcard.cards.CardRepository;
import com.mcschool.flashcard.cards.dto.ParsedCard;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.drive.GoogleDriveStructureService;
import com.mcschool.flashcard.groups.dto.AddGroupMembersRequest;
import com.mcschool.flashcard.groups.dto.CreateGroupCardRequest;
import com.mcschool.flashcard.groups.dto.CreateStudentGroupRequest;
import com.mcschool.flashcard.groups.dto.ImportGroupCardsRequest;
import com.mcschool.flashcard.groups.dto.StudentGroupResponse;
import com.mcschool.flashcard.groups.dto.UpdateGroupTranscriptFolderRequest;
import com.mcschool.flashcard.homeworks.Homework;
import com.mcschool.flashcard.homeworks.HomeworkPdfService;
import com.mcschool.flashcard.homeworks.HomeworkRepository;
import com.mcschool.flashcard.notifications.CardPushNotificationService;
import com.mcschool.flashcard.notifications.NotificationService;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserResponse;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class StudentGroupService {

    private final StudentGroupRepository groupRepository;
    private final StudentGroupMemberRepository memberRepository;
    private final UserRepository userRepository;
    private final HomeworkRepository homeworkRepository;
    private final CardRepository cardRepository;
    private final NotificationService notificationService;
    private final CardPushNotificationService cardPushNotificationService;
    private final HomeworkPdfService homeworkPdfService;
    private final GoogleDriveStructureService googleDriveStructureService;

    // Kept for unit tests and older construction sites. Spring uses the annotated constructor below.
    public StudentGroupService(StudentGroupRepository groupRepository,
                               StudentGroupMemberRepository memberRepository,
                               UserRepository userRepository,
                               HomeworkRepository homeworkRepository,
                               CardRepository cardRepository,
                               NotificationService notificationService,
                               CardPushNotificationService cardPushNotificationService,
                               HomeworkPdfService homeworkPdfService) {
        this(groupRepository, memberRepository, userRepository, homeworkRepository, cardRepository,
                notificationService, cardPushNotificationService, homeworkPdfService, null);
    }

    @Autowired
    public StudentGroupService(StudentGroupRepository groupRepository,
                               StudentGroupMemberRepository memberRepository,
                               UserRepository userRepository,
                               HomeworkRepository homeworkRepository,
                               CardRepository cardRepository,
                               NotificationService notificationService,
                               CardPushNotificationService cardPushNotificationService,
                               HomeworkPdfService homeworkPdfService,
                               GoogleDriveStructureService googleDriveStructureService) {
        this.groupRepository = groupRepository;
        this.memberRepository = memberRepository;
        this.userRepository = userRepository;
        this.homeworkRepository = homeworkRepository;
        this.cardRepository = cardRepository;
        this.notificationService = notificationService;
        this.cardPushNotificationService = cardPushNotificationService;
        this.homeworkPdfService = homeworkPdfService;
        this.googleDriveStructureService = googleDriveStructureService;
    }

    @Transactional
    public StudentGroupResponse create(AuthenticatedUser teacher, CreateStudentGroupRequest request) {
        User teacherEntity = userRepository.findById(teacher.id())
                .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
        StudentGroup group = groupRepository.save(StudentGroup.create(teacherEntity, request.name()));
        if (googleDriveStructureService != null) {
            googleDriveStructureService.provisionGroup(teacherEntity, group);
        }

        request.studentIds().stream()
                .distinct()
                .forEach(studentId -> addStudentById(group, teacherEntity, studentId));
        return response(group);
    }

    @Transactional
    public StudentGroupResponse addMembers(AuthenticatedUser teacher, UUID groupId, AddGroupMembersRequest request) {
        StudentGroup group = requireOwnedGroup(teacher.id(), groupId);
        User teacherEntity = group.getTeacher();
        request.studentIds().stream()
                .distinct()
                .forEach(studentId -> addStudentById(group, teacherEntity, studentId));
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
    public StudentGroupResponse updateTranscriptFolder(AuthenticatedUser teacher,
                                                       UUID groupId,
                                                       UpdateGroupTranscriptFolderRequest request) {
        StudentGroup group = requireOwnedGroup(teacher.id(), groupId);
        group.updateTranscriptFolder(request.folderId());
        return response(group);
    }

    @Transactional
    public int createCardForGroup(AuthenticatedUser teacher, UUID groupId, CreateGroupCardRequest request) {
        StudentGroup group = requireOwnedGroup(teacher.id(), groupId);
        List<StudentGroupMember> members = memberRepository.findAllByGroupIdOrderByStudentFullNameAsc(groupId);
        for (StudentGroupMember member : members) {
            Homework homework = homeworkForCards(member.getStudent(), request.startDate());
            cardRepository.save(Card.create(homework, group.getTeacher(), request.question(), request.correctAnswer()));
            cardPushNotificationService.notifyCardsAssigned(
                    member.getStudent().getId(), homework.getId(), request.startDate());
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
            if (!request.cards().isEmpty()) {
                cardPushNotificationService.notifyCardsAssigned(
                        member.getStudent().getId(), homework.getId(), request.startDate());
            }
        }
        return members.size() * request.cards().size();
    }

    @Transactional
    public int createPdfHomeworkForGroup(AuthenticatedUser teacher,
                                         UUID groupId,
                                         LocalDate startDate,
                                         MultipartFile file) {
        requireOwnedGroup(teacher.id(), groupId);
        List<StudentGroupMember> members = memberRepository.findAllByGroupIdOrderByStudentFullNameAsc(groupId);
        for (StudentGroupMember member : members) {
            homeworkPdfService.createWorksheetHomework(
                    teacher,
                    member.getStudent().getId(),
                    startDate,
                    file);
        }
        return members.size();
    }

    private void addStudentById(StudentGroup group, User teacher, UUID studentId) {
        User student = userRepository.findById(studentId)
                .filter(user -> user.getRole() == Role.STUDENT)
                .filter(user -> !user.isArchived())
                .filter(user -> user.getTeacher() != null && user.getTeacher().getId().equals(teacher.getId()))
                .orElseThrow(() -> new ResourceNotFoundException("Student not found"));
        if (!memberRepository.existsByGroupIdAndStudentId(group.getId(), student.getId())) {
            memberRepository.save(StudentGroupMember.create(group, student));
        }
        if (googleDriveStructureService != null) {
            googleDriveStructureService.provisionGroupMember(teacher, group, student);
        }
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
