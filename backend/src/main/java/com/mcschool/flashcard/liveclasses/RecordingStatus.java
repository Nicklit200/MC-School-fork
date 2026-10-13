package com.mcschool.flashcard.liveclasses;

/** Lifecycle of one recording artifact; READY is only set from a verified webhook. */
public enum RecordingStatus {
    REQUESTED,
    STARTING,
    ACTIVE,
    PROCESSING,
    READY,
    FAILED,
    DELETED
}
