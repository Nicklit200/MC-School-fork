package com.mcschool.flashcard.liveclasses;

import java.util.Optional;
import java.util.UUID;

/**
 * Naming rule for a student's private board: the whiteboard surface whose
 * target id is {@code personal-<ownerUserId>}.
 *
 * <p>Privacy is enforced by the annotation service from this id, never from
 * anything the client claims: only the owner and the class's teacher may open,
 * read, write or list such a document.
 */
public final class PersonalBoard {

    static final String PREFIX = "personal-";

    private PersonalBoard() {
    }

    public static boolean isPersonal(String targetId) {
        return targetId != null && targetId.startsWith(PREFIX);
    }

    public static String targetIdFor(UUID ownerId) {
        return PREFIX + ownerId;
    }

    /** The owner, or empty when the id merely looks personal but is malformed. */
    public static Optional<UUID> ownerOf(String targetId) {
        if (!isPersonal(targetId)) {
            return Optional.empty();
        }
        try {
            return Optional.of(UUID.fromString(targetId.substring(PREFIX.length())));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
