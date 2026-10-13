package com.mcschool.flashcard.liveclasses.dto;

/**
 * Host-set publishing permissions. Null leaves that permission unchanged.
 *
 * <p>Note that disabling a microphone permission stops future publishing; it is
 * not the same as muting an already-published track.
 */
public record ParticipantPermissionRequest(
        Boolean cameraEnabled,
        Boolean microphoneEnabled,
        Boolean screenShareEnabled
) {
}
