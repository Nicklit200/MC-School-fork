package com.mcschool.flashcard.groups;

import com.mcschool.flashcard.users.UserStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StudentGroupMemberRepository extends JpaRepository<StudentGroupMember, UUID> {

    /**
     * Current group composition. Inactive students keep their membership record
     * for history/reactivation, but are excluded from current group work.
     */
    default List<StudentGroupMember> findAllByGroupIdOrderByStudentFullNameAsc(UUID groupId) {
        return findAllByGroupIdAndStudentStatusAndStudentArchivedFalseOrderByStudentFullNameAsc(
                groupId, UserStatus.ACTIVE);
    }

    List<StudentGroupMember> findAllByGroupIdAndStudentStatusAndStudentArchivedFalseOrderByStudentFullNameAsc(
            UUID groupId, UserStatus status);

    List<StudentGroupMember> findAllByStudentIdOrderByCreatedAtAsc(UUID studentId);

    boolean existsByGroupIdAndStudentId(UUID groupId, UUID studentId);
}
