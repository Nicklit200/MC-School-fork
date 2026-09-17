package com.mcschool.flashcard.parents;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ParentTeacherMessageRepository extends JpaRepository<ParentTeacherMessage, UUID> {
    List<ParentTeacherMessage> findAllByStudentIdOrderByCreatedAtAsc(UUID studentId);
}
