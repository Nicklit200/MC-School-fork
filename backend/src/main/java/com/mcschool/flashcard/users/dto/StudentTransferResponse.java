package com.mcschool.flashcard.users.dto;

import com.mcschool.flashcard.users.AdminAccountResponse;

public record StudentTransferResponse(
        AdminAccountResponse student,
        int copiedFutureLessons,
        int transferredGroups,
        int futureGroupLessonsNotTransferred
) {}
