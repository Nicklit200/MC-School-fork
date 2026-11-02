package com.mcschool.flashcard.users;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    Optional<User> findByUsernameIgnoreCase(String username);

    Optional<User> findByInvitationToken(String invitationToken);

    Optional<User> findByGoogleCalendarOauthState(String googleCalendarOauthState);

    boolean existsByEmail(String email);

    boolean existsByUsernameIgnoreCase(String username);

    boolean existsByRole(Role role);

    boolean existsByIdAndRoleAndStatusAndArchivedFalse(UUID id, Role role, UserStatus status);

    /** Scalar predicate stays current even when the User is already managed by a waiting transaction. */
    boolean existsByIdAndTeacherIdAndRoleAndStatusAndArchivedFalse(
            UUID id, UUID teacherId, Role role, UserStatus status);

    // Check both accounts in the database without dereferencing a detached teacher proxy.
    @Query("""
            select count(s) > 0 from User s join s.teacher t
            where s.id = :studentId
              and s.role = com.mcschool.flashcard.users.Role.STUDENT
              and s.status = com.mcschool.flashcard.users.UserStatus.ACTIVE
              and s.archived = false
              and t.role = com.mcschool.flashcard.users.Role.TEACHER
              and t.status = com.mcschool.flashcard.users.UserStatus.ACTIVE
              and t.archived = false
            """)
    boolean existsActiveStudentWithActiveTeacher(@Param("studentId") UUID studentId);

    List<User> findAllByRoleOrderByFullNameAsc(Role role);

    // Admin rows are mapped after this repository's session closes (open-in-view is off).
    // Fetch the optional teacher with the account so reading its name stays safe.
    @Query("""
            select u from User u left join fetch u.teacher
            where u.role = :role and u.archived = false
            order by u.fullName asc
            """)
    List<User> findAdminAccountsByRole(@Param("role") Role role);

    List<User> findAllByRoleAndStatusAndArchivedFalseOrderByFullNameAsc(Role role, UserStatus status);

    List<User> findAllByTeacherIdAndArchivedFalseOrderByFullNameAsc(UUID teacherId);

    List<User> findAllByTeacherIdAndRoleAndArchivedFalseOrderByFullNameAsc(UUID teacherId, Role role);

    List<User> findAllByParentIdAndArchivedFalseOrderByFullNameAsc(UUID parentId);
}
