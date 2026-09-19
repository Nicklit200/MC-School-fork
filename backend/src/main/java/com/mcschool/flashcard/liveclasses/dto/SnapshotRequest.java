package com.mcschool.flashcard.liveclasses.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** A flattened whiteboard image, base64-encoded PNG, rendered client-side. */
public record SnapshotRequest(@NotBlank @Size(max = 6_000_000) String pngBase64) {
}
