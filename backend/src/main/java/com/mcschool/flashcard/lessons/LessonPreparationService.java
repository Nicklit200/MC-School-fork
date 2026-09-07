package com.mcschool.flashcard.lessons;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.lessons.dto.LessonPreparationResponse;
import com.mcschool.flashcard.lessons.dto.UpdateLessonPreparationRequest;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LessonPreparationService {
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
        preparation.attachWorkbook(filename, pdf);
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

    private LessonPreparationResponse response(LessonPreparation preparation) {
        return new LessonPreparationResponse(
                preparation.getEventId(),
                preparation.getHomeworkNotes(),
                preparation.getDifficulties(),
                preparation.getLessonPlan(),
                preparation.hasWorkbook(),
                preparation.getWorkbookFilename(),
                preparation.hasAnswers(),
                preparation.getAnswersFilename());
    }
}
