package com.mcschool.flashcard.liveclasses.dto;

import com.mcschool.flashcard.liveclasses.AttendanceStatus;
import java.util.UUID;

public record AttendanceDecisionRequest(UUID studentId, AttendanceStatus status) {
}
