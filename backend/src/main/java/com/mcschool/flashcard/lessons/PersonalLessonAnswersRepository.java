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
    }

    @Query("select a.studentId as studentId, a.filename as filename, a.version as version "
            + "from PersonalLessonAnswers a where a.teacherId = :teacherId and a.eventId = :eventId")
    List<Metadata> metadata(UUID teacherId, String eventId);

    @Query("select a.studentId as studentId, a.filename as filename, a.version as version "
            + "from PersonalLessonAnswers a where a.teacherId = :teacherId and a.eventId = :eventId and a.studentId = :studentId")
    Optional<Metadata> metadataForStudent(UUID teacherId, String eventId, UUID studentId);
}
