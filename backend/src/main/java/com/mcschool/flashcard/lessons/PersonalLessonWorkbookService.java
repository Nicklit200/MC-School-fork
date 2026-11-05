package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMember;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.groups.StudentGroupRepository;
import com.mcschool.flashcard.lessons.dto.GroupLessonResponse;
import com.mcschool.flashcard.liveclasses.OnlineClass;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import com.mcschool.flashcard.users.UserStatus;
import java.util.Comparator;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Private-account pilot for per-student lesson PDFs. All identities are server checked. */
@Service
public class PersonalLessonWorkbookService {
    public static final UUID PILOT_TEACHER_ID = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    private final PersonalLessonWorkbookRepository repository;
    private final GoogleCalendarLessonService lessons;
    private final UserRepository users;
    private final StudentGroupRepository groups;
    private final StudentGroupMemberRepository members;
    private final LessonPreparationService preparations;
    private PersonalLessonAnswersRepository answersRepository;

    public PersonalLessonWorkbookService(PersonalLessonWorkbookRepository repository,
            GoogleCalendarLessonService lessons, UserRepository users,
            StudentGroupRepository groups, StudentGroupMemberRepository members,
            LessonPreparationService preparations) {
        this.repository = repository;
        this.lessons = lessons;
        this.users = users;
        this.groups = groups;
        this.members = members;
        this.preparations = preparations;
    }

    @Autowired
    public void setAnswersRepository(PersonalLessonAnswersRepository answersRepository) {
        this.answersRepository = answersRepository;
    }

    /** This response is available only through teacher-scoped preparation APIs. */
    public record PersonalWorkbookResponse(UUID studentId, String studentName, boolean hasWorkbook,
                                            String filename, long version, boolean hasAnswers,
                                            String answersFilename, long answersVersion,
                                            long workbookSizeBytes, long answersSizeBytes) {
        public PersonalWorkbookResponse(UUID studentId, String studentName, boolean hasWorkbook, String filename,
                                        long version, boolean hasAnswers, String answersFilename, long answersVersion) {
            this(studentId, studentName, hasWorkbook, filename, version, hasAnswers, answersFilename, answersVersion, 0L, 0L);
        }
        public PersonalWorkbookResponse(UUID studentId, String studentName, boolean hasWorkbook, String filename, long version) {
            this(studentId, studentName, hasWorkbook, filename, version, false, null, 0L, 0L, 0L);
        }
    }
    public record PersonalWorkbooksResponse(boolean enabled, List<PersonalWorkbookResponse> students) {}

    public boolean enabled(AuthenticatedUser teacher) {
        return teacher != null && teacher.role() == Role.TEACHER && enabledForTeacher(teacher.id());
    }

    public boolean enabledForTeacher(UUID teacherId) {
        return PILOT_TEACHER_ID.equals(teacherId) && users.existsByIdAndRoleAndStatusAndArchivedFalse(
                teacherId, Role.TEACHER, UserStatus.ACTIVE);
    }

    // Calendar lesson verification may refresh durable lesson history.
    @Transactional
    public PersonalWorkbooksResponse list(AuthenticatedUser teacher, String eventId) {
        if (!enabled(teacher)) return new PersonalWorkbooksResponse(false, List.of());
        List<User> roster = lessonStudents(teacher, eventId);
        Map<UUID, PersonalLessonWorkbookRepository.Metadata> stored = repository.metadata(teacher.id(), eventId)
                .stream().collect(Collectors.toMap(PersonalLessonWorkbookRepository.Metadata::getStudentId, Function.identity()));
        Map<UUID, PersonalLessonAnswersRepository.Metadata> answers = answersRepository == null ? Map.of()
                : answersRepository.metadata(teacher.id(), eventId).stream()
                    .collect(Collectors.toMap(PersonalLessonAnswersRepository.Metadata::getStudentId, Function.identity()));
        return new PersonalWorkbooksResponse(true, roster.stream()
                .map(student -> {
                    var metadata = stored.get(student.getId());
                    var answerMetadata = answers.get(student.getId());
                    return new PersonalWorkbookResponse(student.getId(), student.getFullName(), metadata != null,
                            metadata == null ? null : metadata.getFilename(),
                            metadata == null ? 0L : metadata.getVersion() + 1L,
                            answerMetadata != null, answerMetadata == null ? null : answerMetadata.getFilename(),
                            answerMetadata == null ? 0L : answerMetadata.getVersion() + 1L,
                            metadata == null ? 0L : metadata.getWorkbookSizeBytes(),
                            answerMetadata == null ? 0L : answerMetadata.getAnswersSizeBytes());
                }).toList());
    }

    @Transactional
    public PersonalWorkbookResponse upload(AuthenticatedUser teacher, String eventId, UUID studentId,
                                            String filename, byte[] pdf) {
        requireEnabled(teacher);
        User student = requireStudent(lessonStudents(teacher, eventId), studentId);
        LessonPdfUpload.validate(pdf);
        // Completed-lesson exports need the preparation metadata even when this
        // lesson has only personal files. Existing shared PDFs remain untouched.
        preparations.getOrCreate(teacher, eventId);
        PersonalLessonWorkbook workbook = repository.findByTeacherIdAndEventIdAndStudentId(
                teacher.id(), eventId, studentId)
                .orElseGet(() -> PersonalLessonWorkbook.create(teacher.id(), eventId, studentId));
        String storedFilename = LessonPdfUpload.filename(filename, "personal-workbook.pdf");
        if (storedFilename.equals(workbook.getFilename()) && Arrays.equals(pdf, workbook.getWorkbookPdf())) {
            return response(student, workbook);
        }
        workbook.attach(storedFilename, pdf);
        try {
            return response(student, repository.saveAndFlush(workbook));
        } catch (ObjectOptimisticLockingFailureException | DataIntegrityViolationException ex) {
            throw new ConflictException("Personal workbook changed; reload it before uploading again");
        }
    }

    @Transactional
    public Optional<byte[]> workbook(AuthenticatedUser teacher, String eventId, UUID studentId) {
        requireEnabled(teacher);
        requireStudent(lessonStudents(teacher, eventId), studentId);
        return repository.findByTeacherIdAndEventIdAndStudentId(teacher.id(), eventId, studentId)
                .map(PersonalLessonWorkbook::getWorkbookPdf);
    }

    /** Reused by teacher-only per-pupil resources, even before a workbook exists. */
    @Transactional
    public void requireLessonStudent(AuthenticatedUser teacher, String eventId, UUID studentId) {
        requireEnabled(teacher);
        requireStudent(lessonStudents(teacher, eventId), studentId);
    }

    /** Called only after classroom admission and board-owner authorization. No Calendar network call. */
    @Transactional(readOnly = true)
    public Optional<PersonalLessonWorkbook> workbookForClass(OnlineClass lesson, UUID studentId) {
        if (!enabledForTeacher(lesson.getTeacher().getId())) throw notFound();
        requireClassStudent(lesson, studentId);
        return repository.findByTeacherIdAndEventIdAndStudentId(
                lesson.getTeacher().getId(), lesson.getEventId(), studentId);
    }

    @Transactional(readOnly = true)
    public long workbookVersionForClass(OnlineClass lesson, UUID studentId) {
        if (!enabledForTeacher(lesson.getTeacher().getId())) throw notFound();
        requireClassStudent(lesson, studentId);
        return repository.workbookVersion(lesson.getTeacher().getId(), lesson.getEventId(), studentId)
                .map(version -> version + 1L).orElse(0L);
    }

    /** Validate current ownership and membership even when the viewer is the host. */
    // A document list catches expected not-found results to filter revoked
    // targets. This read guard must not mark its caller's transaction for rollback.
    @Transactional(readOnly = true, noRollbackFor = ResourceNotFoundException.class)
    public void requireClassStudent(OnlineClass lesson, UUID studentId) {
        UUID teacherId = lesson.getTeacher().getId();
        List<User> roster = lesson.isGroupClass()
                ? groupStudents(teacherId, lesson.getGroup().getId())
                : singleStudent(teacherId, lesson.getStudent() == null ? null : lesson.getStudent().getId());
        requireStudent(roster, studentId);
    }

    private List<User> lessonStudents(AuthenticatedUser teacher, String eventId) {
        if (eventId == null || eventId.isBlank() || eventId.length() > 255) throw notFound();
        GroupLessonResponse lesson = lessons.listGroupLessons(teacher).stream()
                .filter(item -> item.eventId().equals(eventId)).findFirst().orElseThrow(this::notFound);
        if (lesson.groupId() != null) return groupStudents(teacher.id(), lesson.groupId());
        if (lesson.studentId() != null) return singleStudent(teacher.id(), lesson.studentId());
        throw notFound();
    }

    private List<User> groupStudents(UUID teacherId, UUID groupId) {
        groups.findByIdAndTeacherId(groupId, teacherId).orElseThrow(this::notFound);
        return members.findAllByGroupIdOrderByStudentFullNameAsc(groupId).stream()
                .map(StudentGroupMember::getStudent).filter(student -> currentStudent(student, teacherId))
                .sorted(Comparator.comparing(User::getFullName)).toList();
    }

    private List<User> singleStudent(UUID teacherId, UUID studentId) {
        if (studentId == null) return List.of();
        return users.findById(studentId).filter(student -> currentStudent(student, teacherId))
                .map(List::of).orElseGet(List::of);
    }

    private boolean currentStudent(User student, UUID teacherId) {
        // A receipt may wait for a concurrent upload after this User was loaded.
        // Do not reuse cached ownership or status when rechecking the target.
        return users.existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
                student.getId(), teacherId, Role.STUDENT, UserStatus.ACTIVE);
    }

    private User requireStudent(List<User> roster, UUID studentId) {
        return roster.stream().filter(student -> student.getId().equals(studentId))
                .findFirst().orElseThrow(this::notFound);
    }

    private void requireEnabled(AuthenticatedUser teacher) {
        if (!enabled(teacher)) throw notFound();
    }

    private ResourceNotFoundException notFound() {
        return new ResourceNotFoundException("Personal workbook not found");
    }

    private PersonalWorkbookResponse response(User student, PersonalLessonWorkbook workbook) {
        var answers = answersRepository == null || workbook == null ? Optional.<PersonalLessonAnswersRepository.Metadata>empty()
                : answersRepository.metadataForStudent(workbook.getTeacherId(), workbook.getEventId(), student.getId());
        return new PersonalWorkbookResponse(student.getId(), student.getFullName(), workbook != null,
                workbook == null ? null : workbook.getFilename(), workbook == null ? 0L : workbook.documentVersion(),
                answers.isPresent(), answers.map(PersonalLessonAnswersRepository.Metadata::getFilename).orElse(null),
                answers.map(row -> row.getVersion() + 1L).orElse(0L),
                workbook == null || workbook.getWorkbookPdf() == null ? 0L : workbook.getWorkbookPdf().length,
                answers.map(PersonalLessonAnswersRepository.Metadata::getAnswersSizeBytes).orElse(0L));
    }
}
