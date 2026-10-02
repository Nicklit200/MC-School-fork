package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LessonHistoryRepository extends JpaRepository<LessonHistoryEntry, LessonHistoryEntry.Key> {
    Optional<LessonHistoryEntry> findByTeacherIdAndEventId(UUID teacherId, String eventId);
    List<LessonHistoryEntry> findAllByTeacherIdOrderByStartsAtAsc(UUID teacherId);
}
