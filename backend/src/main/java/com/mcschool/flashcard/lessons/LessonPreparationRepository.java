package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface LessonPreparationRepository extends JpaRepository<LessonPreparation, LessonPreparation.Key> {
    Optional<LessonPreparation> findByTeacherIdAndEventId(UUID teacherId, String eventId);

    interface AnswersMetadata {
        boolean getHasAnswers();
        String getAnswersFilename();
        long getVersion();
    }

    /** Read only the answer-key revision, never hydrate PDF bytes or lesson notes. */
    @Query(value = """
            SELECT COALESCE(octet_length(answers_pdf), 0) > 0 AS "hasAnswers",
                   answers_filename AS "answersFilename", answers_version AS version
            FROM lesson_preparations
            WHERE teacher_id = :teacherId AND event_id = :eventId
            """, nativeQuery = true)
    Optional<AnswersMetadata> answersMetadata(UUID teacherId, String eventId);

    @Query("select p from LessonPreparation p join fetch p.teacher")
    List<LessonPreparation> findAllWithTeacher();
}
