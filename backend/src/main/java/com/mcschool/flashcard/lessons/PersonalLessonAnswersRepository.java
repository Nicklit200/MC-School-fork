package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface PersonalLessonAnswersRepository extends JpaRepository<PersonalLessonAnswers, UUID> {
    Optional<PersonalLessonAnswers> findByTeacherIdAndEventIdAndStudentId(UUID teacherId, String eventId, UUID studentId);

    interface Metadata {
        UUID getStudentId();
        String getFilename();
        Long getVersion();
        long getAnswersSizeBytes();
    }

    @Query(value = """
            SELECT student_id AS "studentId", filename, version,
                   octet_length(answers_pdf) AS "answersSizeBytes"
            FROM personal_lesson_answers
            WHERE teacher_id = :teacherId AND event_id = :eventId
            """, nativeQuery = true)
    List<Metadata> metadata(UUID teacherId, String eventId);

    @Query(value = """
            SELECT student_id AS "studentId", filename, version,
                   octet_length(answers_pdf) AS "answersSizeBytes"
            FROM personal_lesson_answers
            WHERE teacher_id = :teacherId AND event_id = :eventId AND student_id = :studentId
            """, nativeQuery = true)
    Optional<Metadata> metadataForStudent(UUID teacherId, String eventId, UUID studentId);
}
