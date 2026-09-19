package com.mcschool.flashcard.liveclasses;

import java.util.Optional;
import java.util.UUID;

/**
 * Encoding of a provider participant identity: {@code <userUuid>|<deviceSuffix>}.
 *
 * <p>The application user id is embedded so provider webhooks can be attributed
 * back to a user, and the device suffix keeps two tabs or devices of the same
 * person distinct instead of evicting one another.
 *
 * <p>Contains no name or e-mail: identities are visible to other participants.
 */
public final class ParticipantIdentity {

    private static final String SEPARATOR = "|";

    private ParticipantIdentity() {
    }

    public static String of(UUID userId, String deviceSuffix) {
        String suffix = (deviceSuffix == null || deviceSuffix.isBlank())
                ? UUID.randomUUID().toString().substring(0, 8)
                : sanitize(deviceSuffix);
        return userId + SEPARATOR + suffix;
    }

    /** Recovers the user id from an identity, empty when it is not ours. */
    public static Optional<UUID> userId(String identity) {
        if (identity == null) {
            return Optional.empty();
        }
        int separator = identity.indexOf(SEPARATOR);
        String candidate = separator < 0 ? identity : identity.substring(0, separator);
        try {
            return Optional.of(UUID.fromString(candidate));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /** Keeps the suffix short and free of the separator or control characters. */
    private static String sanitize(String suffix) {
        String cleaned = suffix.replaceAll("[^A-Za-z0-9_-]", "");
        if (cleaned.isEmpty()) {
            return UUID.randomUUID().toString().substring(0, 8);
        }
        return cleaned.length() <= 32 ? cleaned : cleaned.substring(0, 32);
    }
}
