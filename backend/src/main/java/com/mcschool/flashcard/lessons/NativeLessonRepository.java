package com.mcschool.flashcard.lessons;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NativeLessonRepository extends JpaRepository<NativeLesson, UUID> {

    List<NativeLesson> findAllByTeacherIdAndStartsAtBetweenOrderByStartsAtAsc(
            UUID teacherId, Instant from, Instant to);

    Optional<NativeLesson> findByIdAndTeacherId(UUID id, UUID teacherId);
}
