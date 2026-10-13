package com.mcschool.flashcard.liveclasses;

/** Raised when a provider webhook fails signature or body verification. */
public class WebhookVerificationException extends RuntimeException {

    public WebhookVerificationException(String message, Throwable cause) {
        super(message, cause);
    }

    public WebhookVerificationException(String message) {
        super(message);
    }
}
