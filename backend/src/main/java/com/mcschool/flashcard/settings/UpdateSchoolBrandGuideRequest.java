package com.mcschool.flashcard.settings;

public record UpdateSchoolBrandGuideRequest(
        String guideText,
        String filename,
        String pdfBase64
) {
}
