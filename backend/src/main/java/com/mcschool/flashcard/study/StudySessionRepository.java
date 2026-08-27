package com.mcschool.flashcard.study;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StudySessionRepository extends JpaRepository<StudySession, UUID> {

    Optional<StudySession> findByStudentIdAndStatus(UUID studentId, SessionStatus status);

    Optional<StudySession> findByIdAndStudentId(UUID id, UUID studentId);

    boolean existsByStudentIdAndStatus(UUID studentId, SessionStatus status);

    List<StudySession> findAllByStudentIdAndStatusAndSessionTypeOrderByCompletedAtDesc(
            UUID studentId, SessionStatus status, SessionType sessionType);
}
