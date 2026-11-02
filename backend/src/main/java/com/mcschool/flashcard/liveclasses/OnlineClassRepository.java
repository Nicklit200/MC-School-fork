package com.mcschool.flashcard.liveclasses;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;

public interface OnlineClassRepository extends JpaRepository<OnlineClass, UUID> {

    /** Guards duplicate materialization of the same calendar occurrence. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<OnlineClass> findByTeacherIdAndEventIdAndScheduledStartAt(
            UUID teacherId, String eventId, Instant scheduledStartAt);

    Optional<OnlineClass> findByRoomName(String roomName);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM OnlineClass c WHERE c.id = :id")
    Optional<OnlineClass> findForUpdate(@Param("id") UUID id);

    List<OnlineClass> findAllByStatusIn(List<OnlineClassStatus> statuses);

    List<OnlineClass> findAllByMediaClosePendingTrue();

    /** Retention sweep: classes that ended before a cutoff. */
    List<OnlineClass> findAllByStatusAndActualEndAtBefore(OnlineClassStatus status, Instant cutoff);

    /** Occurrences of one calendar event owned by this teacher, newest first. */
    List<OnlineClass> findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(
            UUID teacherId, String eventId);

    /** The current materialization wins over callbacks from a retired room. */
    Optional<OnlineClass> findFirstByTeacherIdAndEventIdOrderByCreatedAtDesc(
            UUID teacherId, String eventId);

    List<OnlineClass> findAllByTeacherIdAndScheduledStartAtBetweenOrderByScheduledStartAtAsc(
            UUID teacherId, Instant from, Instant to);

    List<OnlineClass> findAllByTeacherIdAndStatusInOrderByScheduledStartAtAsc(
            UUID teacherId, List<OnlineClassStatus> statuses);

    /**
     * Classes a student may see: bound directly to them, or to a group in which
     * they hold an active membership. Membership is resolved in the query so a
     * client can never widen its own visibility.
     */
    @Query("""
            SELECT c FROM OnlineClass c
            WHERE (c.scheduledStartAt >= :from OR (
                    c.status IN :openStatuses AND (c.emptySince IS NULL OR EXISTS (
                        SELECT p.id FROM OnlineClassParticipant p
                        WHERE p.onlineClass.id = c.id AND (
                            (p.user.id = :studentId AND p.firstJoinedAt IS NOT NULL)
                            OR (p.user.id = c.teacher.id
                                AND p.classRole = com.mcschool.flashcard.liveclasses.ClassRole.HOST
                                AND p.lastJoinedAt IS NOT NULL
                                AND (p.lastLeftAt IS NULL OR p.lastLeftAt < p.lastJoinedAt))
                        )
                    ))
                  ))
              AND c.status IN :statuses
              AND NOT EXISTS (
                  SELECT h.eventId FROM LessonHistoryEntry h
                  WHERE h.teacher.id = c.teacher.id AND h.eventId = c.eventId
                    AND h.deletedAt IS NOT NULL
              )
              AND (
                    c.student.id = :studentId
                 OR c.group.id IN (
                        SELECT m.group.id FROM StudentGroupMember m WHERE m.student.id = :studentId
                    )
              )
            ORDER BY c.scheduledStartAt ASC
            """)
    List<OnlineClass> findVisibleToStudent(@Param("studentId") UUID studentId,
                                           @Param("from") Instant from,
                                           @Param("openStatuses") List<OnlineClassStatus> openStatuses,
                                           @Param("statuses") List<OnlineClassStatus> statuses);
}
