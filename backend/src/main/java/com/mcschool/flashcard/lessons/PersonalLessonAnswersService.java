package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ConflictException;
import java.util.Arrays;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Private teacher answer keys; this service is never used by classroom document endpoints. */
@Service
public class PersonalLessonAnswersService {
    private final PersonalLessonAnswersRepository repository;
    private final PersonalLessonWorkbookService workbooks;

    public PersonalLessonAnswersService(PersonalLessonAnswersRepository repository, PersonalLessonWorkbookService workbooks) {
        this.repository = repository;
        this.workbooks = workbooks;
    }

    public record Metadata(UUID studentId, boolean hasAnswers, String answersFilename, long version, long answersSizeBytes) {
        public Metadata(UUID studentId, boolean hasAnswers, String answersFilename, long version) {
            this(studentId, hasAnswers, answersFilename, version, 0L);
        }
    }

    public boolean enabled(AuthenticatedUser teacher) { return workbooks.enabled(teacher); }

    // The current lesson check can refresh durable Google Calendar history.
    @Transactional
    public Metadata metadata(AuthenticatedUser teacher, String eventId, UUID studentId) {
        workbooks.requireLessonStudent(teacher, eventId, studentId);
        return repository.metadataForStudent(teacher.id(), eventId, studentId)
                .map(row -> new Metadata(studentId, true, row.getFilename(), row.getVersion() + 1L, row.getAnswersSizeBytes()))
                .orElseGet(() -> new Metadata(studentId, false, null, 0L));
    }

    @Transactional
    public Metadata upload(AuthenticatedUser teacher, String eventId, UUID studentId, String filename, byte[] pdf) {
        workbooks.requireLessonStudent(teacher, eventId, studentId);
        LessonPdfUpload.validate(pdf);
        String storedFilename = LessonPdfUpload.filename(filename, "personal-answers.pdf");
        PersonalLessonAnswers answers = repository.findByTeacherIdAndEventIdAndStudentId(teacher.id(), eventId, studentId)
                .orElseGet(() -> PersonalLessonAnswers.create(teacher.id(), eventId, studentId));
        if (storedFilename.equals(answers.getFilename()) && Arrays.equals(pdf, answers.getAnswersPdf())) return response(answers);
        answers.attach(storedFilename, pdf);
        try {
            return response(repository.saveAndFlush(answers));
        } catch (ObjectOptimisticLockingFailureException | DataIntegrityViolationException conflict) {
            throw new ConflictException("Personal answers changed; reload them before uploading again");
        }
    }

    @Transactional
    public Optional<byte[]> answers(AuthenticatedUser teacher, String eventId, UUID studentId) {
        workbooks.requireLessonStudent(teacher, eventId, studentId);
        return repository.findByTeacherIdAndEventIdAndStudentId(teacher.id(), eventId, studentId)
                .map(PersonalLessonAnswers::getAnswersPdf);
    }

    private Metadata response(PersonalLessonAnswers answers) {
        return new Metadata(answers.getStudentId(), true, answers.getFilename(), answers.documentVersion(),
                answers.getAnswersPdf() == null ? 0L : answers.getAnswersPdf().length);
    }
}
