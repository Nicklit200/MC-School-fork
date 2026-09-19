package com.mcschool.flashcard.liveclasses;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OnlineClassRepository extends JpaRepository<OnlineClass, UUID> {

    /** Guards duplicate materialization of the same calendar occurrence. */
    Optional<OnlineClass> findByTeacherIdAndEventIdAndScheduledStartAt(
            UUID teacherId, String eventId, Instant scheduledStartAt);

    Optional<OnlineClass> findByRoomName(String roomName);

    /** Retention sweep: classes that ended before a cutoff. */
    List<OnlineClass> findAllByStatusAndActualEndAtBefore(OnlineClassStatus status, Instant cutoff);

    /** Occurrences of one calendar event owned by this teacher, newest first. */
    List<OnlineClass> findAllByTeacherIdAndEventIdOrderByScheduledStartAtDesc(
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
            WHERE c.scheduledEndAt >= :from
              AND c.status IN :statuses
              AND (
                    c.student.id = :studentId
                 OR c.group.id IN (
                        SELECT m.group.id FROM StudentGroupMember m WHERE m.student.id = :studentId
                    )
                 OR c.id IN (
                        SELECT a.onlineClass.id FROM OnlineClassAttendance a WHERE a.student.id = :studentId
                    )
              )
            ORDER BY c.scheduledStartAt ASC
            """)
    List<OnlineClass> findVisibleToStudent(@Param("studentId") UUID studentId,
                                           @Param("from") Instant from,
                                           @Param("statuses") List<OnlineClassStatus> statuses);

    @Query("""
            SELECT c FROM OnlineClass c
            WHERE c.status = com.mcschool.flashcard.liveclasses.OnlineClassStatus.ENDED
              AND (
                    c.student.id = :studentId
                 OR c.group.id IN (
                        SELECT m.group.id FROM StudentGroupMember m WHERE m.student.id = :studentId
                    )
                 OR c.id IN (
                        SELECT a.onlineClass.id FROM OnlineClassAttendance a WHERE a.student.id = :studentId
                    )
              )
            ORDER BY c.actualEndAt DESC, c.scheduledStartAt DESC
            """)
    List<OnlineClass> findHistoryVisibleToStudent(@Param("studentId") UUID studentId);
}
