package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface LessonPreparationRepository extends JpaRepository<LessonPreparation, LessonPreparation.Key> {
    Optional<LessonPreparation> findByTeacherIdAndEventId(UUID teacherId, String eventId);

    @Query("select p from LessonPreparation p join fetch p.teacher")
    List<LessonPreparation> findAllWithTeacher();
}
