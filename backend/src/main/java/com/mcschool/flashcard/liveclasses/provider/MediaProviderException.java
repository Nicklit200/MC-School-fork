package com.mcschool.flashcard.liveclasses.provider;

/**
 * Raised when the realtime provider cannot satisfy a request. Callers translate
 * this into a teacher-facing "unavailable" state; messages must never carry
 * credentials or tokens.
 */
public class MediaProviderException extends RuntimeException {

    public MediaProviderException(String message) {
        super(message);
    }

    public MediaProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
