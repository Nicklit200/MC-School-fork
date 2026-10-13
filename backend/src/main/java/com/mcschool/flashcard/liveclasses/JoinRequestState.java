package com.mcschool.flashcard.liveclasses;

/** Waiting-room request lifecycle. */
public enum JoinRequestState {
    PENDING,
    APPROVED,
    REJECTED,
    CANCELLED,
    EXPIRED
}
