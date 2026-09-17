package com.mcschool.flashcard.lessons;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LessonPreparationRepository extends JpaRepository<LessonPreparation, LessonPreparation.Key> {
    Optional<LessonPreparation> findByTeacherIdAndEventId(UUID teacherId, String eventId);
}
