package com.mcschool.flashcard.homeworks;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface HomeworkRepository extends JpaRepository<Homework, UUID> {

    List<Homework> findAllByStudentIdOrderByStartDateDescCreatedAtDesc(UUID studentId);

    Optional<Homework> findByIdAndStudentId(UUID id, UUID studentId);

    Optional<Homework> findFirstByStudentIdAndStartDateAndWorksheetPdfIsNullOrderByCreatedAtAsc(
            UUID studentId, LocalDate startDate);

    @Query("""
            SELECT new com.mcschool.flashcard.homeworks.HomeworkStats(
                h.id,
                COUNT(c.id),
                COALESCE(SUM(CASE
                    WHEN c.status = com.mcschool.flashcard.cards.CardStatus.ACTIVE
                     AND c.repetitionNumber = 0
                     AND c.dueDate = h.startDate THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE
                    WHEN c.status = com.mcschool.flashcard.cards.CardStatus.ACTIVE
                     AND (c.repetitionNumber > 0 OR c.dueDate > h.startDate) THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE
                    WHEN c.status = com.mcschool.flashcard.cards.CardStatus.LEARNED THEN 1 ELSE 0 END), 0)
            )
            FROM Homework h
            LEFT JOIN Card c ON c.homework = h AND c.archived = false
            WHERE h.student.id = :studentId
            GROUP BY h.id
            """)
    List<HomeworkStats> statsByStudentId(@Param("studentId") UUID studentId);

    @Query("""
            SELECT COUNT(h) > 0 FROM Homework h
            WHERE h.id = :homeworkId
              AND h.student.id = :studentId
              AND h.startDate <= :day
            """)
    boolean isStartedForStudent(@Param("homeworkId") UUID homeworkId,
                                @Param("studentId") UUID studentId,
                                @Param("day") LocalDate day);

    @Query("""
            SELECT COUNT(h) FROM Homework h
            WHERE h.student.id = :studentId
              AND h.startDate = :day
              AND h.worksheetPdf IS NOT NULL
              AND h.submittedAt IS NULL
            """)
    long countOpenWorksheetsForDay(@Param("studentId") UUID studentId,
                                   @Param("day") LocalDate day);

    @Query("""
            SELECT h FROM Homework h
            JOIN FETCH h.student s
            JOIN FETCH s.parent p
            WHERE h.startDate = :day
              AND h.worksheetPdf IS NOT NULL
              AND h.submittedAt IS NULL
              AND h.parentNotifiedAt IS NULL
              AND s.archived = false
              AND p.archived = false
              AND p.status = com.mcschool.flashcard.users.UserStatus.ACTIVE
            ORDER BY s.id, h.createdAt
            """)
    List<Homework> findOpenForParentNotification(@Param("day") LocalDate day);
}
