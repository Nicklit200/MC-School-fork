package com.mcschool.flashcard.lessonboard;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LessonBoardOperationRepository extends JpaRepository<LessonBoardOperation, Long> {
    boolean existsByTeacherIdAndEventIdAndKind(UUID teacherId, String eventId, String kind);

    List<LessonBoardOperation> findTop300ByTeacherIdAndEventIdAndIdGreaterThanOrderByIdAsc(
            UUID teacherId, String eventId, Long afterId);
}
