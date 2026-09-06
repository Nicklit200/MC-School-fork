package com.mcschool.flashcard.lessons;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GoogleCalendarLessonBindingRepository extends JpaRepository<GoogleCalendarLessonBinding, GoogleCalendarLessonBinding.Key> {
    Optional<GoogleCalendarLessonBinding> findByTeacherIdAndEventKey(UUID teacherId, String eventKey);
    List<GoogleCalendarLessonBinding> findAllByTeacherId(UUID teacherId);
}
