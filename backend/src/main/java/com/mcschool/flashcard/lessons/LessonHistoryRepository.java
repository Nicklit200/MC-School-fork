package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface LessonHistoryRepository extends JpaRepository<LessonHistoryEntry, LessonHistoryEntry.Key> {
    Optional<LessonHistoryEntry> findByTeacherIdAndEventId(UUID teacherId, String eventId);
    /** Serializes replacement of phone pairings for the same lesson. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select l from LessonHistoryEntry l where l.teacher.id = :teacherId and l.eventId = :eventId")
    Optional<LessonHistoryEntry> findLockedByTeacherIdAndEventId(
            @Param("teacherId") UUID teacherId, @Param("eventId") String eventId);
    List<LessonHistoryEntry> findAllByTeacherIdOrderByStartsAtAsc(UUID teacherId);
}
