package com.mcschool.flashcard.groups;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StudentGroupMemberRepository extends JpaRepository<StudentGroupMember, UUID> {
    List<StudentGroupMember> findAllByGroupIdOrderByStudentFullNameAsc(UUID groupId);
    boolean existsByGroupIdAndStudentId(UUID groupId, UUID studentId);
}
