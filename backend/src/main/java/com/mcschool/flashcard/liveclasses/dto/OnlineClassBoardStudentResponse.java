package com.mcschool.flashcard.liveclasses.dto;

import java.util.UUID;

/** Minimal student identity used to build private classroom board tabs. */
public record OnlineClassBoardStudentResponse(
        UUID id,
        String fullName
) {}
