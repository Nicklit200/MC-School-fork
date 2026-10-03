package com.mcschool.flashcard.settings;

import java.time.Instant;

public record SchoolBrandGuideResponse(
        String guideText,
        String filename,
        boolean hasPdf,
        int sizeBytes,
        Instant updatedAt
) {
}
