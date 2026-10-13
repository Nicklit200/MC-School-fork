package com.mcschool.flashcard.liveclasses;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.stereotype.Component;

/**
 * Shared-secret authentication for the transcription worker.
 *
 * <p>Deliberately narrow: it authorizes transcript ingestion only, never any
 * end-user operation, and is never accepted on a user-facing endpoint. The
 * worker holds this token; end users never see it.
 */
@Component
public class InternalWorkerAuth {

    private final OnlineClassProperties properties;

    public InternalWorkerAuth(OnlineClassProperties properties) {
        this.properties = properties;
    }

    public boolean isConfigured() {
        String token = properties.transcriptionInternalToken();
        return token != null && !token.isBlank();
    }

    /**
     * Constant-time comparison so a timing side channel cannot be used to
     * recover the token byte by byte.
     */
    public boolean matches(String presented) {
        if (!isConfigured() || presented == null) {
            return false;
        }
        byte[] expected = properties.transcriptionInternalToken().getBytes(StandardCharsets.UTF_8);
        byte[] actual = presented.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, actual);
    }
}
