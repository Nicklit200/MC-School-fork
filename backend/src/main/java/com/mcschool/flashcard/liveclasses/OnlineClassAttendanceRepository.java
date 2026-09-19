package com.mcschool.flashcard.liveclasses;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OnlineClassAttendanceRepository extends JpaRepository<OnlineClassAttendance, UUID> {
    Optional<OnlineClassAttendance> findByOnlineClassIdAndStudentId(UUID classId, UUID studentId);
    List<OnlineClassAttendance> findAllByOnlineClassIdOrderByStudentFullNameAsc(UUID classId);
}
