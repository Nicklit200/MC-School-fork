package com.mcschool.flashcard.liveclasses.dto;

import jakarta.validation.constraints.Size;

/**
 * @param deviceId caller-supplied, opaque; keeps two tabs or devices of the same
 *                 user distinct. Never trusted for identity or authorization.
 */
public record ConnectionRequest(@Size(max = 64) String deviceId) {
}
