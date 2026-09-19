package com.mcschool.flashcard.liveclasses;

import com.mcschool.flashcard.auth.AuthenticatedUser;
import com.mcschool.flashcard.common.ResourceNotFoundException;
import com.mcschool.flashcard.groups.StudentGroupMemberRepository;
import com.mcschool.flashcard.liveclasses.dto.AttendanceDecisionRequest;
import com.mcschool.flashcard.liveclasses.dto.AttendanceStudentResponse;
import com.mcschool.flashcard.users.User;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OnlineClassAttendanceService {

    private final OnlineClassAccessService accessService;
    private final OnlineClassParticipantRepository participantRepository;
    private final OnlineClassAttendanceRepository attendanceRepository;
    private final StudentGroupMemberRepository groupMemberRepository;
    private final Clock clock;

    public OnlineClassAttendanceService(
            OnlineClassAccessService accessService,
            OnlineClassParticipantRepository participantRepository,
            OnlineClassAttendanceRepository attendanceRepository,
            StudentGroupMemberRepository groupMemberRepository,
            Clock clock) {
        this.accessService = accessService;
        this.participantRepository = participantRepository;
        this.attendanceRepository = attendanceRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<AttendanceStudentResponse> roster(AuthenticatedUser caller, UUID classId) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        Map<UUID, User> roster = rosterFor(onlineClass);
        Map<UUID, OnlineClassParticipant> participants = new LinkedHashMap<>();
        participantRepository.findAllByOnlineClassIdOrderByCreatedAtAsc(classId).stream()
                .filter(participant -> !participant.isHost())
                .forEach(participant -> participants.put(participant.getUser().getId(), participant));

        Map<UUID, OnlineClassAttendance> confirmed = new LinkedHashMap<>();
        attendanceRepository.findAllByOnlineClassIdOrderByStudentFullNameAsc(classId)
                .forEach(item -> confirmed.put(item.getStudent().getId(), item));

        return roster.values().stream()
                .map(student -> {
                    OnlineClassParticipant participant = participants.get(student.getId());
                    OnlineClassAttendance saved = confirmed.get(student.getId());
                    long seconds = participant == null ? 0 : effectiveConnectedSeconds(participant);
                    AttendanceStatus status = saved != null
                            ? saved.getStatus()
                            : participant != null && participant.getFirstJoinedAt() != null
                                ? AttendanceStatus.PRESENT
                                : AttendanceStatus.ABSENT;
                    return new AttendanceStudentResponse(
                            student.getId(),
                            student.getFullName(),
                            status,
                            participant != null && participant.getFirstJoinedAt() != null,
                            participant == null ? null : participant.getFirstJoinedAt(),
                            saved != null ? saved.getConnectedSeconds() : seconds);
                })
                .toList();
    }

    @Transactional
    public void confirm(AuthenticatedUser caller, UUID classId,
                        List<AttendanceDecisionRequest> decisions) {
        OnlineClass onlineClass = accessService.requireHost(caller, classId);
        User teacher = accessService.requireActiveUser(caller.id());
        Map<UUID, User> roster = rosterFor(onlineClass);
        Map<UUID, AttendanceStatus> requested = new LinkedHashMap<>();
        if (decisions != null) {
            for (AttendanceDecisionRequest decision : decisions) {
                if (decision == null || decision.studentId() == null || decision.status() == null) continue;
                if (!roster.containsKey(decision.studentId())) {
                    throw new ResourceNotFoundException("Student not found in this lesson");
                }
                requested.put(decision.studentId(), decision.status());
            }
        }

        Instant now = clock.instant();
        for (User student : roster.values()) {
            OnlineClassParticipant participant = participantRepository
                    .findByOnlineClassIdAndUserId(classId, student.getId())
                    .orElse(null);
            long seconds = participant == null ? 0 : effectiveConnectedSeconds(participant);
            AttendanceStatus defaultStatus =
                    participant != null && participant.getFirstJoinedAt() != null
                            ? AttendanceStatus.PRESENT
                            : AttendanceStatus.ABSENT;
            AttendanceStatus status = requested.getOrDefault(student.getId(), defaultStatus);

            OnlineClassAttendance record = attendanceRepository
                    .findByOnlineClassIdAndStudentId(classId, student.getId())
                    .orElseGet(() -> OnlineClassAttendance.create(
                            onlineClass, student, status, seconds, now, teacher));
            record.confirm(status, seconds, now, teacher);
            attendanceRepository.save(record);
        }
    }

    private Map<UUID, User> rosterFor(OnlineClass onlineClass) {
        Map<UUID, User> result = new LinkedHashMap<>();
        if (onlineClass.getStudent() != null) {
            result.put(onlineClass.getStudent().getId(), onlineClass.getStudent());
        } else if (onlineClass.getGroup() != null) {
            groupMemberRepository
                    .findAllByGroupIdOrderByStudentFullNameAsc(onlineClass.getGroup().getId())
                    .forEach(member -> result.put(member.getStudent().getId(), member.getStudent()));
        }
        return result;
    }

    private long effectiveConnectedSeconds(OnlineClassParticipant participant) {
        long seconds = participant.getTotalConnectedSeconds();
        if (participant.isConnected() && participant.getLastJoinedAt() != null) {
            long live = java.time.Duration.between(participant.getLastJoinedAt(), clock.instant()).getSeconds();
            if (live > 0) seconds += live;
        }
        return Math.max(0, seconds);
    }
}
