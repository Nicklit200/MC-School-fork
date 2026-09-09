package com.mcschool.flashcard.trialleads.dto;

import jakarta.validation.constraints.Size;

public record UpdateTrialLeadRequest(
        @Size(max = 80) String grade,
        @Size(max = 120) String schoolType,
        @Size(max = 120) String subject,
        @Size(max = 500) String goal,
        @Size(max = 500) String priority,
        @Size(max = 100) String teacherId,
        @Size(max = 160) String teacherName,
        @Size(max = 40) String event
) {}
