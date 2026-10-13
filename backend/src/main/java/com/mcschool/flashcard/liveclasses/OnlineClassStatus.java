package com.mcschool.flashcard.liveclasses;

/** Lifecycle of a class. Transitions are validated in the service layer. */
public enum OnlineClassStatus {
    SCHEDULED,
    LOBBY_OPEN,
    LIVE,
    ENDED,
    CANCELLED
}
