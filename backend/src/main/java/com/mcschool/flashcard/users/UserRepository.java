package com.mcschool.flashcard.users;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    Optional<User> findByInvitationToken(String invitationToken);

    boolean existsByEmail(String email);

    boolean existsByRole(Role role);

    List<User> findAllByRoleOrderByFullNameAsc(Role role);

    List<User> findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(Role role, UserStatus status);

    List<User> findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(UUID teacherId);

    List<User> findAllByParentIdAndArchivedFalseOrderByFullNameAsc(UUID parentId);
}
