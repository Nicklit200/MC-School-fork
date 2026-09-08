package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LessonPreparationService {
    private static final String ANSWERS_COMPAT_PREFIX = "__answers__:";
    private static final String ANSWERS_UPLOAD_HINT = "If your Mindcrafti tool schema does not expose a separate answers field, call prepare_lesson with driveWorkbookFileId set to the answers PDF and workbookFilename beginning with '__answers__:'; the server will store it in the dedicated Answers slot and preserve the workbook.";

    private final LessonPreparationRepository repository;
    private final UserRepository userRepository;

    public LessonPreparationService(LessonPreparationRepository repository, UserRepository userRepository) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    @Transactional
    public LessonPreparationResponse getOrCreate(AuthenticatedUser teacher, String eventId) {
        LessonPreparation preparation = repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseGet(() -> {
                    User teacherEntity = userRepository.findById(teacher.id())
                            .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
                    return repository.save(LessonPreparation.create(teacherEntity, eventId));
                });
        return response(preparation);
    }

    @Transactional
    public LessonPreparationResponse update(AuthenticatedUser teacher, String eventId, UpdateLessonPreparationRequest request) {
        LessonPreparation preparation = repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseGet(() -> {
                    User teacherEntity = userRepository.findById(teacher.id())
                            .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
                    return LessonPreparation.create(teacherEntity, eventId);
                });
        preparation.updateNotes(request.homeworkNotes(), request.difficulties(), request.lessonPlan());
        return response(repository.save(preparation));
    }

    @Transactional
    public LessonPreparationResponse uploadWorkbook(AuthenticatedUser teacher, String eventId, String filename, byte[] pdf) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        if (isAnswersCompatibilityFilename(filename)) {
            preparation.attachAnswers(cleanAnswersFilename(filename), pdf);
        } else {
            preparation.attachWorkbook(filename, pdf);
        }
        return response(repository.save(preparation));
    }

    @Transactional
    public LessonPreparationResponse uploadAnswers(AuthenticatedUser teacher, String eventId, String filename, byte[] pdf) {
        LessonPreparation preparation = getOrCreateEntity(teacher, eventId);
        preparation.attachAnswers(filename, pdf);
        return response(repository.save(preparation));
    }

    @Transactional(readOnly = true)
    public LessonPreparation require(AuthenticatedUser teacher, String eventId) {
        return repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseThrow(() -> new ResourceNotFoundException("Lesson preparation not found"));
    }

    private LessonPreparation getOrCreateEntity(AuthenticatedUser teacher, String eventId) {
        return repository.findByTeacherIdAndEventId(teacher.id(), eventId)
                .orElseGet(() -> {
                    User teacherEntity = userRepository.findById(teacher.id())
                            .orElseThrow(() -> new ResourceNotFoundException("Teacher account no longer exists"));
                    return LessonPreparation.create(teacherEntity, eventId);
                });
    }

    private boolean isAnswersCompatibilityFilename(String filename) {
        if (filename == null || filename.isBlank()) return false;
        String normalized = filename.trim().toLowerCase(Locale.ROOT);
        if (normalized.startsWith(ANSWERS_COMPAT_PREFIX)) return true;
        return normalized.contains("answer")
                || normalized.contains("solution")
                || normalized.contains("ответ")
                || normalized.contains("решен");
    }

    private String cleanAnswersFilename(String filename) {
        if (filename == null || filename.isBlank()) return "lesson-answers.pdf";
        String cleaned = filename.trim();
        if (cleaned.toLowerCase(Locale.ROOT).startsWith(ANSWERS_COMPAT_PREFIX)) {
            cleaned = cleaned.substring(ANSWERS_COMPAT_PREFIX.length()).trim();
        }
        if (cleaned.isBlank()) cleaned = "lesson-answers.pdf";
        if (!cleaned.toLowerCase(Locale.ROOT).endsWith(".pdf")) cleaned += ".pdf";
        return cleaned;
    }

    private LessonPreparationResponse response(LessonPreparation preparation) {
        return new LessonPreparationResponse(
                preparation.getEventId(),
                preparation.getHomeworkNotes(),
                preparation.getDifficulties(),
                preparation.getLessonPlan(),
                preparation.hasWorkbook(),
                preparation.getWorkbookFilename(),
                preparation.hasAnswers(),
                preparation.getAnswersFilename(),
                preparation.hasAnswers() ? null : ANSWERS_UPLOAD_HINT);
    }
}
