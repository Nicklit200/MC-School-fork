package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.users.Role;
import com.mcschool.flashcard.users.User;
import com.mcschool.flashcard.users.UserRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The single authorization choke point for online classes.
 *
 * <p>Membership is always derived from database ownership/binding — never from a
 * client-supplied role, room name or class id. Callers that need "can this user
 * touch this class" must come through here rather than re-implementing checks.
 *
 * <p>Unauthorized access is reported as {@link ResourceNotFoundException} so an
 * outsider cannot distinguish "exists but forbidden" from "does not exist".
 */
@Service
public class OnlineClassAccessService {

    private final OnlineClassRepository classRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;

    public OnlineClassAccessService(OnlineClassRepository classRepository,
                                    StudentGroupMemberRepository groupMemberRepository,
                                    UserRepository userRepository) {
        this.classRepository = classRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.userRepository = userRepository;
    }

    /** The class if the caller is its owning teacher, otherwise not-found. */
    @Transactional(readOnly = true)
    public OnlineClass requireHost(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = require(classId);
        if (!isHost(caller, onlineClass)) {
            throw new ResourceNotFoundException("Online class not found");
        }
        return onlineClass;
    }

    /**
     * The class if the caller may participate: the owning teacher, the directly
     * bound student, or an active member of the bound group.
     */
    @Transactional(readOnly = true)
    public OnlineClass requireParticipant(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = require(classId);
        if (!canParticipate(caller, onlineClass)) {
            throw new ResourceNotFoundException("Online class not found");
        }
        return onlineClass;
    }

    /** Host or participant; used for read-only class detail. */
    @Transactional(readOnly = true)
    public OnlineClass requireViewer(AuthenticatedUser caller, UUID classId) {
        return requireParticipant(caller, classId);
    }

    public boolean isHost(AuthenticatedUser caller, OnlineClass onlineClass) {
        return caller.role() == Role.TEACHER
                && onlineClass.getTeacher().getId().equals(caller.id())
                && !isArchived(caller.id());
    }

    /**
     * Parents do not join classes in this release, and admins do not silently
     * join, view recordings or read transcripts — they get metadata only, via a
     * separate audited path.
     */
    public boolean canParticipate(AuthenticatedUser caller, OnlineClass onlineClass) {
        if (isArchived(caller.id())) {
            return false;
        }
        if (isHost(caller, onlineClass)) {
            return true;
        }
        if (caller.role() != Role.STUDENT) {
            return false;
        }
        if (onlineClass.isGroupClass()) {
            return groupMemberRepository.existsByGroupIdAndStudentId(
                    onlineClass.getGroup().getId(), caller.id());
        }
        return onlineClass.getStudent() != null
                && onlineClass.getStudent().getId().equals(caller.id());
    }

    /** Resolves the caller to a persisted, non-archived user. */
    @Transactional(readOnly = true)
    public User requireActiveUser(UUID userId) {
        return userRepository.findById(userId)
                .filter(user -> !user.isArchived())
                .orElseThrow(() -> new ResourceNotFoundException("Account no longer exists"));
    }

    private OnlineClass require(UUID classId) {
        return classRepository.findById(classId)
                .orElseThrow(() -> new ResourceNotFoundException("Online class not found"));
    }

    private boolean isArchived(UUID userId) {
        return userRepository.findById(userId).map(User::isArchived).orElse(true);
    }
}
