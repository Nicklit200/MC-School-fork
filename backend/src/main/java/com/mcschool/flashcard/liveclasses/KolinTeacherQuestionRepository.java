package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KolinTeacherQuestionRepository extends JpaRepository<KolinTeacherQuestion, UUID> {

    Optional<KolinTeacherQuestion> findByTeacherIdAndClassIdAndClientMessageId(
            UUID teacherId, UUID classId, UUID clientMessageId);

    List<KolinTeacherQuestion> findByTeacherIdAndClassIdOrderByCreatedAtDescIdDesc(
            UUID teacherId, UUID classId, Pageable page);
}
