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
import java.io.IOException;
import java.util.Comparator;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.apache.pdfbox.Loader;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Private-account pilot for per-student lesson PDFs. All identities are server checked. */
@Service
public class PersonalLessonWorkbookService {
    public static final UUID PILOT_TEACHER_ID = UUID.fromString("14e3c7c1-1fc8-41bd-858a-6c20efdd957a");
    private static final int MAX_PDF_BYTES = 25 * 1024 * 1024;
    private final PersonalLessonWorkbookRepository repository;
    private final GoogleCalendarLessonService lessons;
    private final UserRepository users;
    private final StudentGroupRepository groups;
    private final StudentGroupMemberRepository members;
    private final LessonPreparationService preparations;

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

    public record PersonalWorkbookResponse(UUID studentId, String studentName, boolean hasWorkbook,
                                            String filename, long version) {}
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
        return new PersonalWorkbooksResponse(true, roster.stream()
                .map(student -> {
                    var metadata = stored.get(student.getId());
                    return new PersonalWorkbookResponse(student.getId(), student.getFullName(), metadata != null,
                            metadata == null ? null : metadata.getFilename(),
                            metadata == null ? 0L : metadata.getVersion() + 1L);
                }).toList());
    }

    @Transactional
    public PersonalWorkbookResponse upload(AuthenticatedUser teacher, String eventId, UUID studentId,
                                            String filename, byte[] pdf) {
        requireEnabled(teacher);
        User student = requireStudent(lessonStudents(teacher, eventId), studentId);
        validatePdf(pdf);
        // Completed-lesson exports need the preparation metadata even when this
        // lesson has only personal files. Existing shared PDFs remain untouched.
        preparations.getOrCreate(teacher, eventId);
        PersonalLessonWorkbook workbook = repository.findByTeacherIdAndEventIdAndStudentId(
                teacher.id(), eventId, studentId)
                .orElseGet(() -> PersonalLessonWorkbook.create(teacher.id(), eventId, studentId));
        String storedFilename = filename(filename);
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
    @Transactional(readOnly = true)
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
        return new PersonalWorkbookResponse(student.getId(), student.getFullName(), workbook != null,
                workbook == null ? null : workbook.getFilename(), workbook == null ? 0L : workbook.documentVersion());
    }

    private String filename(String value) {
        if (value == null || value.isBlank()) return "personal-workbook.pdf";
        String clean = value.replace('\\', '/');
        clean = clean.substring(clean.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\\\"]", "").strip();
        if (clean.isBlank()) return "personal-workbook.pdf";
        if (clean.length() > 255) clean = clean.substring(0, 251) + ".pdf";
        return clean;
    }

    private void validatePdf(byte[] pdf) {
        if (pdf != null && pdf.length > MAX_PDF_BYTES)
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "PDF must not exceed 25 MB");
        if (pdf == null || pdf.length < 5 || pdf[0] != '%' || pdf[1] != 'P' || pdf[2] != 'D'
                || pdf[3] != 'F' || pdf[4] != '-')
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Please upload a valid PDF");
        try (var document = Loader.loadPDF(pdf)) {
            if (document.isEncrypted() || document.getNumberOfPages() == 0) throw new IOException("Unreadable PDF");
        } catch (IOException ex) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Please upload a readable PDF with at least one page");
        }
    }
}
