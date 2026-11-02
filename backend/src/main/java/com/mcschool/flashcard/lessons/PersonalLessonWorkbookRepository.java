package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface PersonalLessonWorkbookRepository extends JpaRepository<PersonalLessonWorkbook, UUID> {
    Optional<PersonalLessonWorkbook> findByTeacherIdAndEventIdAndStudentId(UUID teacherId, String eventId, UUID studentId);
    interface Metadata {
        UUID getStudentId();
        String getFilename();
        Long getVersion();
    }

    @Query("select w.studentId as studentId, w.filename as filename, w.version as version "
            + "from PersonalLessonWorkbook w where w.teacherId = :teacherId and w.eventId = :eventId")
    List<Metadata> metadata(UUID teacherId, String eventId);

    @Query("select w.version from PersonalLessonWorkbook w where w.teacherId = :teacherId "
            + "and w.eventId = :eventId and w.studentId = :studentId")
    Optional<Long> workbookVersion(UUID teacherId, String eventId, UUID studentId);
}
