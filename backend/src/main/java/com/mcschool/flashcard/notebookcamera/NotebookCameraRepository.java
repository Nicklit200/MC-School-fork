package com.mcschool.flashcard.notebookcamera;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotebookCameraRepository extends JpaRepository<NotebookCamera, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from NotebookCamera c where c.id = :id")
    Optional<NotebookCamera> findLockedById(@Param("id") UUID id);

    List<NotebookCamera> findAllByTeacherIdAndEventIdAndRevokedAtIsNullOrderByCreatedAtAsc(
            UUID teacherId, String eventId);

    List<NotebookCamera> findAllByClassIdAndRevokedAtIsNull(UUID classId);

    List<NotebookCamera> findAllByRevokedAtIsNull();

    List<NotebookCamera> findAllByRevokedAtNotNullAndRoomClosedAtIsNull();
}
