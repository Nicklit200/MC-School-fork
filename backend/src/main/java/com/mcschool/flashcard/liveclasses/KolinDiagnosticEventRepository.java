package com.mcschool.flashcard.liveclasses;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KolinDiagnosticEventRepository extends JpaRepository<KolinDiagnosticEvent, UUID> {
    List<KolinDiagnosticEvent> findTop30ByOnlineClassIdAndRecordedAtAfterOrderByRecordedAtDesc(
            UUID classId, Instant since);
    boolean existsByOnlineClassIdAndUserIdAndCategoryAndRecordedAtAfter(
            UUID classId, UUID userId, String category, Instant since);
    long deleteByRecordedAtBefore(Instant before);
}
