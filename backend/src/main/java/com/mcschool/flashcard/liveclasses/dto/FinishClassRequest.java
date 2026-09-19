package com.mcschool.flashcard.liveclasses.dto;

import java.util.List;

public record FinishClassRequest(List<AttendanceDecisionRequest> attendance) {
}
