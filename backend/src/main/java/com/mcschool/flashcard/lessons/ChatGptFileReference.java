package com.mcschool.flashcard.lessons;

import java.util.Map;
import java.util.Objects;

/** Runtime file capability. Signed download URLs must never become receipt identity or logs. */
public record ChatGptFileReference(String downloadUrl, String fileId, String mimeType, String filename) {
    public ChatGptFileReference {
        Objects.requireNonNull(downloadUrl, "downloadUrl");
        Objects.requireNonNull(fileId, "fileId");
    }

    public Map<String, Object> identity() {
        return Map.of("fileId", fileId, "mimeType", mimeType == null ? "" : mimeType,
                "filename", filename == null ? "" : filename);
    }

    /** Avoid exposing signed query parameters through incidental record logging. */
    @Override public String toString() { return "ChatGptFileReference[downloadUrl=REDACTED]"; }
}
