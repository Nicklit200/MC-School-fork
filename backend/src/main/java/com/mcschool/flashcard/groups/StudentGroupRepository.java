package com.mcschool.flashcard.groups;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StudentGroupRepository extends JpaRepository<StudentGroup, UUID> {
    List<StudentGroup> findAllByTeacherIdOrderByNameAsc(UUID teacherId);
    List<StudentGroup> findAllByTeacherIdAndArchivedAtIsNullOrderByNameAsc(UUID teacherId);
    Optional<StudentGroup> findByIdAndTeacherId(UUID id, UUID teacherId);
    Optional<StudentGroup> findByIdAndTeacherIdAndArchivedAtIsNull(UUID id, UUID teacherId);
}
