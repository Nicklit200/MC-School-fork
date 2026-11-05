package com.mcschool.flashcard.lessons;

import java.util.Objects;

/** A validated in-memory PDF. No local filesystem path is accepted or created. */
public record PdfInput(String filename, byte[] bytes, String fileId) {
    public PdfInput {
        Objects.requireNonNull(filename, "filename");
        Objects.requireNonNull(bytes, "bytes");
        Objects.requireNonNull(fileId, "fileId");
        bytes = bytes.clone();
    }

    @Override public byte[] bytes() { return bytes.clone(); }
}
